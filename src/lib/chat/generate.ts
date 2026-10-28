import { db } from "@/lib/db";
import { Prisma } from "@/generated/client";
import { ApiError } from "@/lib/api/response";
import { getRoutingSettings } from "@/lib/routing/settings";
import { executeWithFallback } from "@/lib/routing/executor";
import { devnubyTools, executeTool } from "@/lib/tools";
import { sanitizeToolOutputForStorage } from "@/lib/tools/compact-source";
import { recordUserUsage } from "@/lib/chat/quota";
import { registerStream, unregisterStream } from "@/lib/chat/active-streams";
import type {
  ChatMessageInput,
  ReasoningEffortVariant,
  ToolCallInput,
} from "@/lib/gateways/types";
import {
  createUIMessageStream,
  smoothStream,
  toUIMessageChunk,
  type TextStreamPart,
  type UIMessageChunk,
} from "ai";

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
  reasoningEffort?: ReasoningEffortVariant;
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
 * Adapts raw TextStreamParts into a smoothed word-by-word stream using AI SDK's smoothStream helper.
 * Buffers are flushed with a sentinel step finish chunk on completion.
 */
async function* createSmoothedTextPipeline(
  source: AsyncIterable<TextStreamPart<Record<string, never>>>
): AsyncIterable<TextStreamPart<Record<string, never>>> {
  const smoother = smoothStream<Record<string, never>>({
    delayInMs: 10,
    chunking: "word",
  })({ tools: {} });

  const writer = smoother.writable.getWriter();
  const reader = smoother.readable.getReader();

  const feeder = (async () => {
    try {
      for await (const chunk of source) {
        await writer.write(chunk);
      }
      await writer.close();
    } catch (err) {
      try {
        await writer.abort(err);
      } catch {}
    }
  })();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {}
    await feeder.catch(() => {});
  }
}

/**
 * Core AI SDK UI message stream generator. Runs the multi-turn tool loop against the
 * DB-driven smart routing executor (executeWithFallback), translates gateway events
 * to AI SDK UIMessageChunks with word smoothing, executes tools, persists final
 * state to DB, and tracks usage.
 */
export function createChatGenerationStream(
  options: StreamGenerationOptions
): ReadableStream<UIMessageChunk> {
  const {
    userId,
    userPublicId,
    sessionPublicId,
    assistantMessageId,
    assistantMessagePublicId,
    userMessagePublicId,
    requestedModelPublicId,
    sessionModelPublicId,
    reasoningEffort,
    conversationHistory,
    requestId,
    clientSignal,
  } = options;

  const streamController = registerStream(assistantMessagePublicId);
  const combinedSignal = AbortSignal.any([clientSignal, streamController.signal]);

  return createUIMessageStream({
    execute: async ({ writer }) => {
      let fullContent = "";
      let fullReasoning = "";
      let promptTokens = 0;
      let completionTokens = 0;

      const cleanup = () => {
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

        // 1. Emit start chunk with assistant messageId and meta
        writer.write({
          type: "start",
          messageId: assistantMessagePublicId,
          messageMetadata: {
            messageId: assistantMessagePublicId,
            userMessageId: userMessagePublicId,
            model: resolvedModel.publicId,
            requestId,
          },
        });

        // Collect executed tool call parts to persist to DB so widgets & tool outputs survive page reloads
        const currentMessages: ChatMessageInput[] = [...conversationHistory];
        const executedToolParts: Record<string, unknown>[] = [];
        let remainingToolRounds = resolvedModel.supportsTools ? 3 : 0;
        let stepIndex = 0;

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
              reasoningEffort,
              tools: resolvedModel.supportsTools ? devnubyTools : undefined,
              signal: combinedSignal,
            },
          });

          const toolCallsByIndex = new Map<number | string, AccumulatedToolCall>();
          let turnContent = "";

          const textPartId = `text_${assistantMessagePublicId}_${stepIndex}`;
          const reasoningPartId = `reasoning_${assistantMessagePublicId}_${stepIndex}`;
          let hasEmittedTextStart = false;
          let hasEmittedReasoningStart = false;
          let hasEndedReasoning = false;

          // Bridge gateway events to TextStreamParts for smoothStream
          async function* rawTextPartsGenerator(): AsyncIterable<
            TextStreamPart<Record<string, never>>
          > {
            for await (const event of gatewayStream) {
              if (combinedSignal.aborted) {
                throw new Error("CLIENT_ABORTED");
              }

              if (event.type === "delta") {
                turnContent += event.text;
                fullContent += event.text;
                // Jawaban mulai keluar → fase berpikir selesai, tutup reasoning part sekarang
                if (hasEmittedReasoningStart && !hasEndedReasoning) {
                  hasEndedReasoning = true;
                  yield { type: "reasoning-end", id: reasoningPartId };
                }
                if (!hasEmittedTextStart) {
                  hasEmittedTextStart = true;
                  yield { type: "text-start", id: textPartId };
                }
                yield { type: "text-delta", id: textPartId, text: event.text };
              } else if (event.type === "reasoning") {
                fullReasoning += event.text;
                if (!hasEmittedReasoningStart) {
                  hasEmittedReasoningStart = true;
                  yield { type: "reasoning-start", id: reasoningPartId };
                }
                yield {
                  type: "reasoning-delta",
                  id: reasoningPartId,
                  text: event.text,
                };
              } else if (event.type === "tool_call") {
                const key =
                  event.index !== undefined ? event.index : event.callId || "call_0";
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

            if (hasEmittedReasoningStart && !hasEndedReasoning) {
              yield { type: "reasoning-end", id: reasoningPartId };
            }
            if (hasEmittedTextStart) {
              yield { type: "text-end", id: textPartId };
            }
          }

          // Consume smoothed text/reasoning parts and emit AI SDK UI chunks
          for await (const smoothedPart of createSmoothedTextPipeline(
            rawTextPartsGenerator()
          )) {
            if (combinedSignal.aborted) {
              throw new Error("CLIENT_ABORTED");
            }
            const chunk = toUIMessageChunk(smoothedPart, { sendReasoning: true });
            if (chunk) {
              writer.write(chunk);
            }
          }

          const assembledCalls = Array.from(toolCallsByIndex.values()).filter(
            (c) => c.name.trim().length > 0
          );

          if (assembledCalls.length > 0 && remainingToolRounds > 0) {
            remainingToolRounds -= 1;
            stepIndex += 1;

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

              let parsedArgs: Record<string, unknown> = {};
              try {
                parsedArgs = tool.arguments ? JSON.parse(tool.arguments) : {};
              } catch {
                parsedArgs = {};
              }

              writer.write({
                type: "tool-input-available",
                toolCallId: effectiveCallId,
                toolName: tool.name,
                input: parsedArgs,
                dynamic: true,
              });

              const result = await executeTool(tool.name, parsedArgs, {
                userId: userPublicId,
                sessionId: sessionPublicId,
                signal: combinedSignal,
              });

              executedToolParts.push({
                type: "dynamic-tool",
                toolCallId: effectiveCallId,
                toolName: tool.name,
                state: result.success ? "output-available" : "output-error",
                input: parsedArgs,
                output: result.success
                  ? sanitizeToolOutputForStorage(tool.name, result.data)
                  : undefined,
                errorText: result.success ? undefined : result.error?.message,
              });

              if (result.success) {
                writer.write({
                  type: "tool-output-available",
                  toolCallId: effectiveCallId,
                  output: result.data ?? {},
                  dynamic: true,
                });
              } else {
                writer.write({
                  type: "tool-output-error",
                  toolCallId: effectiveCallId,
                  errorText: result.error?.message || "Tool execution failed",
                  dynamic: true,
                });
              }

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

        // Persist final completed message to DB
        await db.chatMessage.update({
          where: { id: assistantMessageId },
          data: {
            content: fullContent,
            reasoning: fullReasoning || null,
            parts:
              executedToolParts.length > 0
                ? (executedToolParts as unknown as Prisma.InputJsonValue)
                : Prisma.JsonNull,
            status: "completed",
            promptTokens: promptTokens || null,
            completionTokens: completionTokens || null,
          },
        });

        // Always record usage to increment requestCount even if token metrics were zero
        await recordUserUsage(userId, { promptTokens, completionTokens }).catch((err) => {
          console.error("[USAGE_RECORD_ERROR]", err);
        });

        writer.write({
          type: "finish",
          finishReason: "stop",
        });
        writer.setOutcome({ status: "completed" });
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
          writer.write({
            type: "abort",
            reason: "Client stopped generation",
          });
          writer.setOutcome({ status: "aborted" });
        } else {
          let publicMessage = "The model is temporarily unavailable.";

          if (streamErr instanceof ApiError) {
            publicMessage = streamErr.message;
          }

          writer.write({
            type: "error",
            errorText: publicMessage,
          });
          writer.setOutcome({ status: "failed", error: streamErr });
        }
      } finally {
        cleanup();
      }
    },
  });
}
