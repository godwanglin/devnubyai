import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess, ApiError } from "@/lib/api/response";
import { getChatSession, listChatMessages, getRecentMessagesForGateway } from "@/lib/chat/service";
import { assertUserQuota } from "@/lib/chat/quota";
import { getSseResponseHeaders } from "@/lib/chat/sse";
import { createChatGenerationStream, resolveCatalogModel } from "@/lib/chat/generate";
import type { ChatMessageInput } from "@/lib/gateways/types";

const sendMessageSchema = z.object({
  content: z.string().trim().min(1, "Message content cannot be empty"),
  model: z.string().trim().optional(),
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
      meta: { nextCursor: result.nextCursor },
    });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

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
    const session = await getChatSession(user.id, chatId);

    // Check user quota before generation
    await assertUserQuota(user.id);

    // Resolve target model early so we can record its ID and check status
    const resolvedModel = await resolveCatalogModel(
      parsed.data.model,
      session.catalogModelPublicId
    );

    // 1. Persist user message in DB
    const userMessage = await db.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "user",
        content: parsed.data.content,
        status: "completed",
      },
    });

    // 2. Persist assistant message placeholder with status "streaming"
    const assistantMessage = await db.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "assistant",
        content: "",
        catalogModelId: resolvedModel.id,
        status: "streaming",
      },
    });

    // Update session lastMessageAt & title if it's the first message
    const messageCount = await db.chatMessage.count({ where: { sessionId: session.id } });
    const autoTitle =
      messageCount <= 2 && session.title === "New chat"
        ? parsed.data.content.slice(0, 40).trim() || "New chat"
        : undefined;

    await db.chatSession.update({
      where: { id: session.id },
      data: {
        lastMessageAt: new Date(),
        ...(autoTitle ? { title: autoTitle } : {}),
      },
    });

    // 3. Prepare recent conversation context for gateway
    const history = await getRecentMessagesForGateway(session.id, 20);
    // Exclude the newly created empty assistant message from history
    const conversationMessages: ChatMessageInput[] = history.filter(
      (m) => !(m.role === "assistant" && m.content === "")
    );

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
      conversationHistory: conversationMessages,
      requestId,
      clientSignal: request.signal,
    });

    return new Response(stream, {
      status: 200,
      headers: getSseResponseHeaders(requestId),
    });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
