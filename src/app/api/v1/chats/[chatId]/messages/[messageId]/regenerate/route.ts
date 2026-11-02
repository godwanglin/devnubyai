import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, ApiError } from "@/lib/api/response";
import { getChatSession } from "@/lib/chat/service";
import { assertUserQuota } from "@/lib/chat/quota";
import { assertUserModelAccess } from "@/lib/chat/model-access";
import { createChatGenerationStream, resolveCatalogModel } from "@/lib/chat/generate";
import { createUIMessageStreamResponse } from "ai";
import { mapReasoningEffort } from "@/lib/chat/reasoning-mapper";
import { resolveClientTimeZone } from "@/lib/chat/timezone";
import { extractSourceMentions } from "@/lib/chat/source-mentions";
import type { ChatMessageInput } from "@/lib/gateways/types";

const regenerateSchema = z.object({
  model: z.string().trim().optional(),
  reasoningLevel: z.enum(["0", "1", "2", "3", "4"]).optional(),
});

type RouteContext = { params: Promise<{ chatId: string; messageId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

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

    const session = await getChatSession(user.id, chatId);
    await assertUserQuota(user.id);

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
    await assertUserModelAccess(user.id, resolvedModel.id);

    // Reset target assistant message to status "streaming"
    await db.chatMessage.update({
      where: { id: targetMessage.id },
      data: {
        content: "",
        reasoning: null,
        catalogModelId: resolvedModel.id,
        status: "streaming",
        errorCode: null,
        promptTokens: null,
        completionTokens: null,
      },
    });

    const conversationMessages: ChatMessageInput[] = priorDbMessages
      .filter((m) => m.content.trim().length > 0)
      .map((m) => ({
        role: m.role as "system" | "user" | "assistant" | "tool",
        content: m.content,
      }));

    const stream = createChatGenerationStream({
      userId: user.id,
      userPublicId: user.publicId,
      sessionId: session.id,
      sessionPublicId: session.publicId,
      assistantMessageId: targetMessage.id,
      assistantMessagePublicId: targetMessage.publicId,
      userMessagePublicId: lastUserMsg?.publicId || "",
      requestedModelPublicId: parsed.data.model,
      sessionModelPublicId: session.catalogModelPublicId,
      reasoningEffort: mapReasoningEffort(parsed.data.reasoningLevel),
      conversationHistory: conversationMessages,
      // Re-answering the same turn: the sources it mentioned are inlined again
      mentionedSourceIds: extractSourceMentions(lastUserMsg?.parts).map((m) => m.id),
      clientTimeZone: resolveClientTimeZone(request),
      requestId,
    });

    return createUIMessageStreamResponse({
      stream,
      headers: {
        "x-request-id": requestId,
      },
    });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
