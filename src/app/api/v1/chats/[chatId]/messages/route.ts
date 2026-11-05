import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess, ApiError } from "@/lib/api/response";
import { uuidv7 } from "@/lib/api/uuidv7";
import { getUnlockedChatSession, listChatMessages, getRecentMessagesForGateway } from "@/lib/chat/service";
import { assertUserQuota } from "@/lib/chat/quota";
import { claimGenerationSlot } from "@/lib/chat/concurrency";
import { assertUserModelAccess } from "@/lib/chat/model-access";
import { createChatGenerationStream, resolveCatalogModel } from "@/lib/chat/generate";
import { userHistoryContent } from "@/lib/chat/gateway-history";
import { beginTurn, type PendingTurn } from "@/lib/chat/redis-chat-state";
import { mapReasoningEffort } from "@/lib/chat/reasoning-mapper";
import { resolveClientTimeZone } from "@/lib/chat/timezone";
import { TurnTimer } from "@/lib/chat/turn-timing";
import { createUIMessageStreamResponse } from "ai";
import { downloadFromR2 } from "@/lib/storage/r2";
import { MAX_IMAGE_BYTES } from "@/lib/files/policy";
import { MAX_QUOTES_PER_MESSAGE, MAX_QUOTE_CHARS } from "@/lib/chat/quotes";
import { MAX_SOURCE_MENTIONS_PER_MESSAGE } from "@/lib/chat/source-mentions";
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

/**
 * Sends a message. Nothing is written to Postgres before the model answers: the
 * turn (user message + assistant reply) is held in Redis while it streams and
 * stored with one transaction when it ends (see `redis-chat-state.ts`).
 */
export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  const timer = new TurnTimer(requestId, "send");
  let releaseSlot: (() => Promise<void>) | null = null;

  try {
    const user = await requireUser();
    timer.mark("auth");
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

    // Verify session ownership (Redis-cached)
    const session = await getUnlockedChatSession(user.id, chatId);
    timer.mark("session");

    // Quota (Redis live ledger) and model resolution (in-memory cache) are independent
    const [quota, resolvedModel] = await Promise.all([
      assertUserQuota(user.id, user.plan),
      resolveCatalogModel(parsed.data.model, session.catalogModelPublicId),
    ]);
    timer.mark("quota");
    await assertUserModelAccess(user.id, resolvedModel.id, user);
    timer.mark("access");

    // Cap concurrent generations per plan before the turn starts
    releaseSlot = await claimGenerationSlot(user.id, quota.maxParallelRequests);

    const fileIds = parsed.data.fileIds ?? [];
    const quotes = parsed.data.quotes ?? [];

    // Mentions must point at sources of this chat's own project; attachments are read
    // only when the message has some (both are skipped for a plain text message)
    const requestedSourceIds = [...new Set(parsed.data.sourceIds ?? [])];
    const [mentionedSources, attachedFiles, history] = await Promise.all([
      requestedSourceIds.length > 0 && session.projectInternalId
        ? db.projectFile.findMany({
            where: { publicId: { in: requestedSourceIds }, projectId: session.projectInternalId },
            select: { publicId: true, filename: true },
          })
        : Promise.resolve([]),
      fileIds.length > 0
        ? db.sessionFile.findMany({
            where: { publicId: { in: fileIds }, sessionId: session.id, userId: user.id },
            select: { publicId: true, filename: true, mimeType: true, sizeBytes: true },
          })
        : Promise.resolve([]),
      // Prior turns (this message is appended below); Redis-cached
      getRecentMessagesForGateway(session.id, 19),
    ]);
    timer.mark("history");

    const mentions = mentionedSources.map((s) => ({ id: s.publicId, filename: s.filename }));
    const metaParts = [
      ...quotes.map((text) => ({ type: "quote" as const, text })),
      ...mentions.map((m) => ({ type: "source_mention" as const, ...m })),
    ];
    const historyContent = userHistoryContent(parsed.data.content, metaParts);

    // A previous message whose reply failed leaves a trailing user turn; providers reject
    // back-to-back user turns, so it is merged into this one (as the stored history would be)
    const priorUserText = history.at(-1)?.role === "user" ? history.pop()!.content : null;
    const userText = priorUserText ? `${priorUserText}\n\n${historyContent}` : historyContent;

    // The user's turn for the gateway: quotes/mentions folded in, attachments described or inlined
    let gatewayUserContent: ChatMessageInput["content"] = userText;
    if (attachedFiles.length > 0) {
      const imageFiles = attachedFiles.filter((f) => f.mimeType.startsWith("image/"));
      const docFiles = attachedFiles.filter((f) => !f.mimeType.startsWith("image/"));
      let textPrompt = userText;
      if (docFiles.length > 0) {
        const docList = docFiles.map((d) => `- ${d.filename} (${d.mimeType})`).join("\n");
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

      gatewayUserContent =
        contentParts.length > 0 ? [{ type: "text", text: textPrompt }, ...contentParts] : textPrompt;
    }

    const conversationMessages: ChatMessageInput[] = [
      ...history,
      { role: "user", content: gatewayUserContent },
    ];

    const now = Date.now();
    const turn: PendingTurn = {
      kind: "send",
      requestId,
      userId: user.id.toString(),
      sessionId: session.id.toString(),
      sessionPublicId: session.publicId,
      autoTitle:
        session.title === "New chat" ? parsed.data.content.slice(0, 40).trim() || null : null,
      user: {
        publicId: uuidv7(),
        content: parsed.data.content,
        parts: metaParts.length > 0 ? metaParts : null,
        fileIds: attachedFiles.map((f) => f.publicId),
        attachments: attachedFiles.map((f) => ({
          publicId: f.publicId,
          filename: f.filename,
          mimeType: f.mimeType,
          sizeBytes: Number(f.sizeBytes),
        })),
        historyContent,
      },
      assistant: {
        publicId: uuidv7(),
        content: "",
        reasoning: null,
        parts: [],
        status: "streaming",
        errorCode: null,
        errorDetail: null,
        catalogModelId: resolvedModel.id.toString(),
        catalogModelPublicId: resolvedModel.publicId,
        promptTokens: 0,
        completionTokens: 0,
      },
      usage: null,
      startedAt: now,
      updatedAt: now,
      flushAttempts: 0,
    };
    await beginTurn(turn);
    timer.mark("turn");

    const stream = createChatGenerationStream({
      userId: user.id,
      userPublicId: user.publicId,
      userName: user.name,
      sessionId: session.id,
      sessionPublicId: session.publicId,
      projectInternalId: session.projectInternalId,
      turn,
      resolvedModel,
      planLimits: user.plan,
      reasoningEffort: mapReasoningEffort(
        parsed.data.extendedThinking ? "4" : parsed.data.reasoningLevel
      ),
      forceWebSearch: parsed.data.webSearch,
      conversationHistory: conversationMessages,
      mentionedSourceIds: mentions.map((m) => m.id),
      clientTimeZone: resolveClientTimeZone(request),
      requestId,
      onSettled: releaseSlot,
      onFirstModelToken: () => {
        timer.mark("first_token");
        timer.flush();
      },
    });
    releaseSlot = null; // owned by the stream now

    return createUIMessageStreamResponse({
      stream,
      headers: {
        "x-request-id": requestId,
      },
    });
  } catch (err) {
    timer.flush();
    await releaseSlot?.();
    return jsonError(err, { requestId });
  }
}
