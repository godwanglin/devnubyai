import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, ApiError } from "@/lib/api/response";
import { getUnlockedChatSession } from "@/lib/chat/service";
import { assertUserQuota } from "@/lib/chat/quota";
import { claimGenerationSlot } from "@/lib/chat/concurrency";
import { assertUserModelAccess } from "@/lib/chat/model-access";
import { createChatGenerationStream, resolveCatalogModel } from "@/lib/chat/generate";
import { createUIMessageStreamResponse } from "ai";
import { mapReasoningEffort } from "@/lib/chat/reasoning-mapper";
import { resolveClientTimeZone } from "@/lib/chat/timezone";
import { extractSourceMentions } from "@/lib/chat/source-mentions";
import { beginTurn, ensureSessionFlushed, type PendingTurn } from "@/lib/chat/redis-chat-state";
import type { ChatMessageInput } from "@/lib/gateways/types";

const regenerateSchema = z.object({
  model: z.string().trim().max(128).optional(),
  reasoningLevel: z.enum(["0", "1", "2", "3", "4"]).optional(),
});

type RouteContext = { params: Promise<{ chatId: string; messageId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  let releaseSlot: (() => Promise<void>) | null = null;

  try {
    const user = await requireUser();
    const { chatId, messageId } = await context.params;

    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const parsed = regenerateSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid regenerate payload", parsed.error.format());
    }

    const session = await getUnlockedChatSession(user.id, chatId);
    const quota = await assertUserQuota(user.id, user.plan);

    // Regeneration reads the stored conversation: store any ended turn still in Redis first
    if (!(await ensureSessionFlushed(session.id))) {
      throw ApiError.conflict("Pesan sebelumnya masih disimpan. Coba lagi sebentar lagi.");
    }

    // Target assistant message
    const targetMessage = await db.chatMessage.findFirst({
      where: {
        publicId: messageId,
        sessionId: session.id,
        role: "assistant",
      },
    });

    if (!targetMessage) {
      throw ApiError.notFound("Assistant message to regenerate not found");
    }

    // Get the most recent completed messages strictly before target assistant message (last 30)
    const priorDbMessagesDesc = await db.chatMessage.findMany({
      where: {
        sessionId: session.id,
        id: { lt: targetMessage.id },
        status: { in: ["completed", "aborted"] },
      },
      orderBy: { id: "desc" },
      take: 30,
      select: {
        id: true,
        publicId: true,
        role: true,
        content: true,
        parts: true,
      },
    });

    if (priorDbMessagesDesc.length === 0) {
      throw ApiError.badRequest("Cannot regenerate without prior conversation context");
    }

    const priorDbMessages = priorDbMessagesDesc.reverse();
    const lastUserMsg = [...priorDbMessages].reverse().find((m) => m.role === "user");

    // Resolve target model early
    const resolvedModel = await resolveCatalogModel(
      parsed.data.model,
      session.catalogModelPublicId
    );
    await assertUserModelAccess(user.id, resolvedModel.id, user);

    // Cap concurrent generations per plan before the regeneration starts
    releaseSlot = await claimGenerationSlot(user.id, quota.maxParallelRequests);

    // The stored reply stays as is until the new one ends; readers see the Redis overlay
    const now = Date.now();
    const turn: PendingTurn = {
      kind: "regenerate",
      requestId,
      userId: user.id.toString(),
      sessionId: session.id.toString(),
      sessionPublicId: session.publicId,
      autoTitle: null,
      user: null,
      assistant: {
        publicId: targetMessage.publicId,
        content: "",
        reasoning: null,
        parts: [],
        status: "streaming",
        errorCode: null,
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

    const conversationMessages: ChatMessageInput[] = priorDbMessages
      .filter((m) => m.content.trim().length > 0)
      .map((m) => ({
        role: m.role as "system" | "user" | "assistant" | "tool",
        content: m.content,
      }));

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
      reasoningEffort: mapReasoningEffort(parsed.data.reasoningLevel),
      conversationHistory: conversationMessages,
      // Re-answering the same turn: the sources it mentioned are inlined again
      mentionedSourceIds: extractSourceMentions(lastUserMsg?.parts).map((m) => m.id),
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
