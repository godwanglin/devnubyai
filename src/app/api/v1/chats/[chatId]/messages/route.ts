import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess, ApiError } from "@/lib/api/response";
import { getUnlockedChatSession, listChatMessages, getRecentMessagesForGateway } from "@/lib/chat/service";
import { assertUserQuota } from "@/lib/chat/quota";
import { claimGenerationSlot } from "@/lib/chat/concurrency";
import { assertUserModelAccess } from "@/lib/chat/model-access";
import { createChatGenerationStream, resolveCatalogModel } from "@/lib/chat/generate";
import { mapReasoningEffort } from "@/lib/chat/reasoning-mapper";
import { resolveClientTimeZone } from "@/lib/chat/timezone";
import { createUIMessageStreamResponse } from "ai";
import { downloadFromR2 } from "@/lib/storage/r2";
import { MAX_IMAGE_BYTES } from "@/lib/files/policy";
import { MAX_QUOTES_PER_MESSAGE, MAX_QUOTE_CHARS, withQuotedContext } from "@/lib/chat/quotes";
import { MAX_SOURCE_MENTIONS_PER_MESSAGE, withSourceMentionNote } from "@/lib/chat/source-mentions";
import type { ChatMessageInput, MultimodalContentPart } from "@/lib/gateways/types";
import { MAX_FILE_IDS_PER_MESSAGE, MAX_MESSAGE_CHARS, MAX_MODEL_ID_CHARS } from "@/lib/chat/service-types";

const sendMessageSchema = z.object({
  content: z.string().trim().min(1, "Message content cannot be empty").max(MAX_MESSAGE_CHARS),
  model: z.string().trim().max(MAX_MODEL_ID_CHARS).optional(),
  reasoningLevel: z.enum(["0", "1", "2", "3", "4"]).optional(),
  webSearch: z.boolean().optional(),
  extendedThinking: z.boolean().optional(),
  fileIds: z.array(z.string().trim().max(64)).max(MAX_FILE_IDS_PER_MESSAGE).optional(),
  quotes: z
    .array(z.string().trim().min(1).max(MAX_QUOTE_CHARS))
    .max(MAX_QUOTES_PER_MESSAGE)
    .optional(),
  /** Project sources @mentioned in this message (ProjectFile publicIds) */
  sourceIds: z.array(z.string().trim().min(1)).max(MAX_SOURCE_MENTIONS_PER_MESSAGE).optional(),
});

type RouteContext = { params: Promise<{ chatId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const { chatId } = await context.params;
    const url = new URL(request.url);
    const limit = url.searchParams.get("limit")
      ? parseInt(url.searchParams.get("limit")!, 10)
      : undefined;
    const cursor = url.searchParams.get("cursor") || undefined;

    const result = await listChatMessages(user.id, chatId, { limit, cursor });

    return jsonSuccess(result.messages, {
      requestId,
      meta: { nextCursor: result.nextCursor, session: result.session },
    });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  let releaseSlot: (() => Promise<void>) | null = null;

  try {
    const user = await requireUser();
    const { chatId } = await context.params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw ApiError.badRequest("Invalid JSON body");
    }

    const parsed = sendMessageSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid message payload", parsed.error.format());
    }

    // Verify session ownership
    const session = await getUnlockedChatSession(user.id, chatId);

    // Check user quota before generation
    const quota = await assertUserQuota(user.id);

    // Resolve target model early so we can record its ID and check status
    const resolvedModel = await resolveCatalogModel(
      parsed.data.model,
      session.catalogModelPublicId
    );
    await assertUserModelAccess(user.id, resolvedModel.id);

    // Cap concurrent generations per plan before anything is written
    releaseSlot = await claimGenerationSlot(user.id, quota.maxParallelRequests);

    // Atomically persist user message, assistant placeholder, link uploaded files, and update session metadata
    const autoTitle =
      session.title === "New chat"
        ? parsed.data.content.slice(0, 40).trim() || "New chat"
        : undefined;

    const fileIds = parsed.data.fileIds ?? [];
    const quotes = parsed.data.quotes ?? [];

    // Mentions must point at sources of this chat's own project
    const requestedSourceIds = [...new Set(parsed.data.sourceIds ?? [])];
    const mentionedSources =
      requestedSourceIds.length > 0 && session.projectInternalId
        ? await db.projectFile.findMany({
            where: { publicId: { in: requestedSourceIds }, projectId: session.projectInternalId },
            select: { publicId: true, filename: true },
          })
        : [];
    const mentions = mentionedSources.map((s) => ({ id: s.publicId, filename: s.filename }));
    const metaParts = [
      ...quotes.map((text) => ({ type: "quote" as const, text })),
      ...mentions.map((m) => ({ type: "source_mention" as const, ...m })),
    ];

    const [userMessage, assistantMessage] = await db.$transaction(async (tx) => {
      const uMsg = await tx.chatMessage.create({
        data: {
          sessionId: session.id,
          role: "user",
          content: parsed.data.content,
          status: "completed",
          ...(metaParts.length > 0 ? { parts: metaParts } : {}),
        },
      });

      const aMsg = await tx.chatMessage.create({
        data: {
          sessionId: session.id,
          role: "assistant",
          content: "",
          catalogModelId: resolvedModel.id,
          status: "streaming",
        },
      });

      if (fileIds.length > 0) {
        await tx.sessionFile.updateMany({
          where: {
            publicId: { in: fileIds },
            sessionId: session.id,
            userId: user.id,
          },
          data: {
            messageId: uMsg.id,
          },
        });
      }

      await tx.chatSession.update({
        where: { id: session.id },
        data: {
          lastMessageAt: new Date(),
          ...(autoTitle ? { title: autoTitle } : {}),
        },
      });

      return [uMsg, aMsg];
    });

    // 3. Prepare recent conversation context for gateway
    const history = await getRecentMessagesForGateway(session.id, 20);
    // Exclude the newly created empty assistant message from history
    const conversationMessages: ChatMessageInput[] = history.filter(
      (m) => !(m.role === "assistant" && m.content === "")
    );

    // If attachments exist and the resolved model supports vision, inject image multimodal parts into the user's turn
    if (fileIds.length > 0) {
      const attachedFiles = await db.sessionFile.findMany({
        where: {
          publicId: { in: fileIds },
          sessionId: session.id,
        },
        select: {
          publicId: true,
          filename: true,
          mimeType: true,
          sizeBytes: true,
        },
      });

      const imageFiles = attachedFiles.filter((f) => f.mimeType.startsWith("image/"));
      const docFiles = attachedFiles.filter((f) => !f.mimeType.startsWith("image/"));

      // Replace the last user message in conversationMessages with rich multimodal parts
      const lastUserIdx = conversationMessages.map((m) => m.role).lastIndexOf("user");
      if (lastUserIdx !== -1) {
        let textPrompt = withSourceMentionNote(withQuotedContext(parsed.data.content, quotes), mentions);
        if (docFiles.length > 0) {
          const docList = docFiles
            .map((d) => `- ${d.filename} (${d.mimeType})`)
            .join("\n");
          textPrompt += `\n\n[User attached documents to session storage]:\n${docList}\n(Use read_file with the exact filename above to inspect their contents.)`;
        }

        // Upstream providers cannot reach localhost or the private R2 bucket,
        // so images are read server-side and inlined as Base64 data URIs.
        const contentParts: MultimodalContentPart[] = [];
        const unreadableImages: string[] = [];
        if (resolvedModel.supportsVision) {
          for (const img of imageFiles) {
            try {
              const downloaded = await downloadFromR2({
                userId: user.publicId,
                sessionId: session.publicId,
                filename: img.filename,
                maxBytes: MAX_IMAGE_BYTES,
              });
              contentParts.push({
                type: "image_url",
                image_url: {
                  url: `data:${img.mimeType};base64,${downloaded.content.toString("base64")}`,
                },
              });
            } catch {
              unreadableImages.push(img.filename);
            }
          }
        } else if (imageFiles.length > 0) {
          const imgList = imageFiles.map((img) => `- ${img.filename}`).join("\n");
          textPrompt += `\n\n[User attached images, but the selected model cannot view images]:\n${imgList}\n(Tell the user to switch to a vision-capable model to analyze them.)`;
        }

        if (unreadableImages.length > 0) {
          textPrompt += `\n\n[These attached images could not be loaded]:\n${unreadableImages
            .map((name) => `- ${name}`)
            .join("\n")}`;
        }

        conversationMessages[lastUserIdx] = {
          ...conversationMessages[lastUserIdx],
          content:
            contentParts.length > 0
              ? [{ type: "text", text: textPrompt }, ...contentParts]
              : textPrompt,
        };
      }
    }

    const stream = createChatGenerationStream({
      userId: user.id,
      userPublicId: user.publicId,
      sessionId: session.id,
      sessionPublicId: session.publicId,
      assistantMessageId: assistantMessage.id,
      assistantMessagePublicId: assistantMessage.publicId,
      userMessagePublicId: userMessage.publicId,
      requestedModelPublicId: parsed.data.model,
      sessionModelPublicId: session.catalogModelPublicId,
      reasoningEffort: mapReasoningEffort(
        parsed.data.extendedThinking ? "4" : parsed.data.reasoningLevel
      ),
      forceWebSearch: parsed.data.webSearch,
      conversationHistory: conversationMessages,
      mentionedSourceIds: mentions.map((m) => m.id),
      clientTimeZone: resolveClientTimeZone(request),
      requestId,
      onSettled: releaseSlot,
    });
    releaseSlot = null; // owned by the stream now

    return createUIMessageStreamResponse({
      stream,
      headers: {
        "x-request-id": requestId,
      },
    });
  } catch (err) {
    await releaseSlot?.();
    return jsonError(err, { requestId });
  }
}
