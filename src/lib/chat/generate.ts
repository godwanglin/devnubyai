import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";
import { getRoutingSettings } from "@/lib/routing/settings";
import { executeWithFallback } from "@/lib/routing/executor";
import { devnubyTools, executeTool } from "@/lib/tools";
import { formatSseChunk } from "@/lib/chat/sse";
import { recordUserUsage } from "@/lib/chat/quota";
import { registerStream, unregisterStream } from "@/lib/chat/active-streams";
import type { ChatMessageInput, ToolCallInput } from "@/lib/gateways/types";

export interface StreamGenerationOptions {
  userId: bigint;
  userPublicId: string;
  sessionId: bigint;
  sessionPublicId: string;
  assistantMessageId: bigint;
  assistantMessagePublicId: string;
  userMessagePublicId: string;
  requestedModelPublicId?: string;
  sessionModelPublicId?: string | null;
  conversationHistory: ChatMessageInput[];
  requestId: string;
  clientSignal: AbortSignal;
}

interface AccumulatedToolCall {
  callId: string;
  name: string;
  args: string;
}

/**
 * Resolves the catalog model to use for generation:
 * 1. Explicitly requested model (validated active)
 * 2. Session's bound model (if active)
 * 3. Default model from admin-managed `app_settings` (validated active)
 * Returns the resolved publicId, DB internal id, and whether tools are supported.
 */
export async function resolveCatalogModel(
  requested?: string,
  sessionFallback?: string | null
): Promise<{ id: bigint; publicId: string; supportsTools: boolean }> {
  const candidatePublicId =
    requested?.trim() ||
    sessionFallback?.trim() ||
    (await getRoutingSettings()).defaultModel;

  let model = await db.catalogModel.findFirst({
    where: { publicId: candidatePublicId, status: "active" },
    select: { id: true, publicId: true, supportsTools: true },
  });

  if (!model && candidatePublicId !== (await getRoutingSettings()).defaultModel) {
    const defaultPublicId = (await getRoutingSettings()).defaultModel;
    model = await db.catalogModel.findFirst({
      where: { publicId: defaultPublicId, status: "active" },
      select: { id: true, publicId: true, supportsTools: true },
    });
  }

  if (!model) {
    throw ApiError.modelUnavailable("No active AI model is currently available.");
  }

  return model;
}

/**
 * Core SSE streaming generator. Runs the multi-turn tool loop against the
 * Phase 3 smart routing executor, writes intermediate tokens to the client,
 * executes tools locally, persists final state to DB, and tracks usage.
 */
export function createChatGenerationStream(
  options: StreamGenerationOptions
): ReadableStream<Uint8Array> {
  const {
    userId,
    userPublicId,
    sessionPublicId,
    assistantMessageId,
    assistantMessagePublicId,
    userMessagePublicId,
    requestedModelPublicId,
    sessionModelPublicId,
    conversationHistory,
    requestId,
    clientSignal,
  } = options;

  const streamController = registerStream(assistantMessagePublicId);
  const combinedSignal = AbortSignal.any([clientSignal, streamController.signal]);
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      let fullContent = "";
      let fullReasoning = "";
      let promptTokens = 0;
      let completionTokens = 0;
      let isDone = false;
      let pingInterval: NodeJS.Timeout | null = null;

      const safeSend = (chunk: string) => {
        if (!isDone && controller.desiredSize !== null) {
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            // Client closed connection
          }
        }
      };

      pingInterval = setInterval(() => {
        safeSend(formatSseChunk({ event: "ping", data: {} }));
      }, 15000);

      const cleanup = () => {
        if (pingInterval) {
          clearInterval(pingInterval);
          pingInterval = null;
        }
        unregisterStream(assistantMessagePublicId, streamController);
      };

      try {
        const resolvedModel = await resolveCatalogModel(
          requestedModelPublicId,
          sessionModelPublicId
        );

        // Bind the resolved catalog model to the assistant message record
        await db.chatMessage.update({
          where: { id: assistantMessageId },
          data: { catalogModelId: resolvedModel.id },
        });

        // Emit meta event with the resolved model's public id
        safeSend(
          formatSseChunk({
            event: "meta",
            data: {
              messageId: assistantMessagePublicId,
              userMessageId: userMessagePublicId,
              model: resolvedModel.publicId,
            },
          })
        );

        const currentMessages: ChatMessageInput[] = [...conversationHistory];
        let remainingToolRounds = resolvedModel.supportsTools ? 3 : 0;

        while (true) {
          if (combinedSignal.aborted) {
            throw new Error("CLIENT_ABORTED");
          }

          const gatewayStream = executeWithFallback({
            publicModelId: resolvedModel.publicId,
            requestId,
            userId,
            messageId: assistantMessageId,
            request: {
              messages: currentMessages,
              tools: resolvedModel.supportsTools ? devnubyTools : undefined,
              signal: combinedSignal,
            },
          });

          // Join tool call fragments by stable output index (or callId fallback)
          const toolCallsByIndex = new Map<number | string, AccumulatedToolCall>();
          let turnContent = "";

          for await (const event of gatewayStream) {
            if (combinedSignal.aborted) {
              throw new Error("CLIENT_ABORTED");
            }

            if (event.type === "delta") {
              turnContent += event.text;
              fullContent += event.text;
              safeSend(
                formatSseChunk({
                  event: "delta",
                  data: { delta: event.text },
                })
              );
            } else if (event.type === "reasoning") {
              fullReasoning += event.text;
              safeSend(
                formatSseChunk({
                  event: "reasoning",
                  data: { delta: event.text },
                })
              );
            } else if (event.type === "tool_call") {
              const key = event.index !== undefined ? event.index : event.callId || "call_0";
              const existing = toolCallsByIndex.get(key) || {
                callId: event.callId || "",
                name: event.name || "",
                args: "",
              };
              if (event.callId && !existing.callId) existing.callId = event.callId;
              if (event.name && !existing.name) existing.name = event.name;
              existing.args += event.argumentsDelta;
              toolCallsByIndex.set(key, existing);
            } else if (event.type === "usage") {
              promptTokens += event.promptTokens;
              completionTokens += event.completionTokens;
            }
          }

          const assembledCalls = Array.from(toolCallsByIndex.values()).filter(
            (c) => c.name.trim().length > 0
          );

          if (assembledCalls.length > 0 && remainingToolRounds > 0) {
            remainingToolRounds -= 1;

            const toolInputs: ToolCallInput[] = assembledCalls.map((c, idx) => ({
              id: c.callId || `call_${idx}`,
              name: c.name,
              arguments: c.args,
            }));

            // Push assistant turn with its toolCalls before the tool results
            currentMessages.push({
              role: "assistant",
              content: turnContent,
              toolCalls: toolInputs,
            });

            for (const tool of toolInputs) {
              const effectiveCallId = tool.id;

              safeSend(
                formatSseChunk({
                  event: "tool",
                  data: {
                    id: effectiveCallId,
                    name: tool.name,
                    status: "running",
                  },
                })
              );

              let parsedArgs: Record<string, unknown> = {};
              try {
                parsedArgs = tool.arguments ? JSON.parse(tool.arguments) : {};
              } catch {
                parsedArgs = {};
              }

              const result = await executeTool(tool.name, parsedArgs, {
                userId: userPublicId,
                sessionId: sessionPublicId,
                signal: combinedSignal,
              });

              safeSend(
                formatSseChunk({
                  event: "tool",
                  data: {
                    id: effectiveCallId,
                    name: tool.name,
                    status: result.success ? "completed" : "failed",
                    output: result.data,
                    error: result.error?.message,
                  },
                })
              );

              currentMessages.push({
                role: "tool",
                toolCallId: effectiveCallId,
                content: JSON.stringify(result.data ?? result.error ?? {}),
              });
            }

            continue;
          }

          break;
        }

        // Persist final completed message
        await db.chatMessage.update({
          where: { id: assistantMessageId },
          data: {
            content: fullContent,
            reasoning: fullReasoning || null,
            status: "completed",
            promptTokens: promptTokens || null,
            completionTokens: completionTokens || null,
          },
        });

        // Always record usage to increment requestCount even if token metrics were zero
        await recordUserUsage(userId, { promptTokens, completionTokens }).catch((err) => {
          console.error("[USAGE_RECORD_ERROR]", err);
        });

        safeSend(
          formatSseChunk({
            event: "done",
            data: {
              finishReason: "stop",
              usage: {
                promptTokens,
                completionTokens,
                totalTokens: promptTokens + completionTokens,
              },
            },
          })
        );
      } catch (streamErr: unknown) {
        const errAny = streamErr as Record<string, unknown>;
        const isAbort =
          combinedSignal.aborted ||
          errAny?.message === "CLIENT_ABORTED" ||
          errAny?.errorClass === "client_aborted";

        const finalStatus = isAbort ? "aborted" : "failed";
        const errorCode = isAbort
          ? "CLIENT_ABORTED"
          : (errAny?.code as string) || (errAny?.errorClass as string) || "STREAM_ERROR";

        await db.chatMessage
          .update({
            where: { id: assistantMessageId },
            data: {
              content: fullContent,
              reasoning: fullReasoning || null,
              status: finalStatus,
              errorCode,
              promptTokens: promptTokens || null,
              completionTokens: completionTokens || null,
            },
          })
          .catch(() => {});

        if (isAbort) {
          safeSend(
            formatSseChunk({
              event: "done",
              data: {
                finishReason: "abort",
                usage: { promptTokens, completionTokens },
              },
            })
          );
        } else {
          // Normalize public error: never leak raw gateway URLs or internal details
          let publicMessage = "The model is temporarily unavailable.";
          let publicCode = "MODEL_UNAVAILABLE";

          if (streamErr instanceof ApiError) {
            publicMessage = streamErr.message;
            publicCode = streamErr.code;
          }

          safeSend(
            formatSseChunk({
              event: "error",
              data: {
                code: publicCode,
                message: publicMessage,
                requestId,
              },
            })
          );
        }
      } finally {
        cleanup();
        isDone = true;
        try {
          controller.close();
        } catch {
          // Stream already closed
        }
      }
    },
  });
}
