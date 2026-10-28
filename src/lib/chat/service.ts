import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";
import type { Prisma } from "@/generated/client";

export interface SessionWithMeta {
  id: string; // publicId
  title: string;
  isPinned: boolean;
  catalogModelId: string | null;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ChatMessageDto {
  id: string; // publicId
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  reasoning?: string | null;
  parts?: unknown;
  status: string;
  errorCode?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  catalogModelId?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Format a DB chat session into public DTO.
 */
function toSessionDto(
  session: {
    publicId: string;
    title: string;
    isPinned: boolean;
    lastMessageAt: Date;
    createdAt: Date;
    updatedAt: Date;
    catalogModel?: { publicId: string } | null;
    _count?: { messages: number };
  }
): SessionWithMeta {
  return {
    id: session.publicId,
    title: session.title,
    isPinned: session.isPinned,
    catalogModelId: session.catalogModel?.publicId ?? null,
    lastMessageAt: session.lastMessageAt.toISOString(),
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    messageCount: session._count?.messages ?? 0,
  };
}

/**
 * Format a DB chat message into public DTO.
 */
export function toMessageDto(message: {
  publicId: string;
  role: string;
  content: string;
  reasoning: string | null;
  parts: unknown;
  status: string;
  errorCode: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  catalogModel?: { publicId: string } | null;
  createdAt: Date;
  updatedAt: Date;
}): ChatMessageDto {
  return {
    id: message.publicId,
    role: message.role as ChatMessageDto["role"],
    content: message.content,
    reasoning: message.reasoning,
    parts: message.parts,
    status: message.status,
    errorCode: message.errorCode,
    promptTokens: message.promptTokens,
    completionTokens: message.completionTokens,
    catalogModelId: message.catalogModel?.publicId ?? null,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
  };
}

/**
 * List user chat sessions with cursor pagination (based on lastMessageAt / id DESC).
 */
export async function listUserChatSessions(
  userId: bigint,
  options: { limit?: number; cursor?: string } = {}
): Promise<{ sessions: SessionWithMeta[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(1, options.limit ?? 30), 100);

  let cursorCondition: Prisma.ChatSessionWhereInput | undefined;
  if (options.cursor) {
    const cursorSession = await db.chatSession.findFirst({
      where: { publicId: options.cursor, userId },
      select: { id: true, isPinned: true, lastMessageAt: true },
    });

    if (cursorSession) {
      cursorCondition = {
        OR: [
          { isPinned: false, lastMessageAt: { lt: cursorSession.lastMessageAt } },
          {
            isPinned: false,
            lastMessageAt: cursorSession.lastMessageAt,
            id: { lt: cursorSession.id },
          },
        ],
      };
    }
  }

  const sessions = await db.chatSession.findMany({
    where: {
      userId,
      ...(cursorCondition ? cursorCondition : {}),
    },
    orderBy: [
      { isPinned: "desc" },
      { lastMessageAt: "desc" },
      { id: "desc" },
    ],
    take: limit + 1,
    include: {
      catalogModel: { select: { publicId: true } },
      _count: { select: { messages: true } },
    },
  });

  let nextCursor: string | null = null;
  if (sessions.length > limit) {
    const nextItem = sessions.pop()!;
    nextCursor = nextItem.publicId;
  }

  return {
    sessions: sessions.map(toSessionDto),
    nextCursor,
  };
}

/**
 * Create a new chat session for user.
 */
export async function createChatSession(
  userId: bigint,
  data: { title?: string; modelPublicId?: string }
): Promise<SessionWithMeta> {
  let catalogModelId: bigint | null = null;

  if (data.modelPublicId) {
    const model = await db.catalogModel.findUnique({
      where: { publicId: data.modelPublicId },
      select: { id: true },
    });
    if (model) catalogModelId = model.id;
  }

  const session = await db.chatSession.create({
    data: {
      userId,
      title: data.title?.trim() || "New chat",
      catalogModelId,
      lastMessageAt: new Date(),
    },
    include: {
      catalogModel: { select: { publicId: true } },
      _count: { select: { messages: true } },
    },
  });

  return toSessionDto(session);
}

/**
 * Get single chat session ensuring user ownership.
 */
export async function getChatSession(
  userId: bigint,
  sessionPublicId: string
): Promise<{
  id: bigint;
  publicId: string;
  title: string;
  isPinned: boolean;
  catalogModelId: bigint | null;
  catalogModelPublicId: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt: Date;
}> {
  const session = await db.chatSession.findFirst({
    where: { publicId: sessionPublicId, userId },
    include: { catalogModel: { select: { id: true, publicId: true } } },
  });

  if (!session) {
    throw ApiError.notFound("Chat session not found");
  }

  return {
    id: session.id,
    publicId: session.publicId,
    title: session.title,
    isPinned: session.isPinned,
    catalogModelId: session.catalogModelId,
    catalogModelPublicId: session.catalogModel?.publicId ?? null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastMessageAt: session.lastMessageAt,
  };
}

/**
 * Update chat session (title, isPinned, or default model).
 */
export async function updateChatSession(
  userId: bigint,
  sessionPublicId: string,
  data: { title?: string; isPinned?: boolean; modelPublicId?: string }
): Promise<SessionWithMeta> {
  const existing = await getChatSession(userId, sessionPublicId);

  let catalogModelId: bigint | undefined = undefined;
  if (data.modelPublicId !== undefined) {
    if (data.modelPublicId) {
      const model = await db.catalogModel.findUnique({
        where: { publicId: data.modelPublicId },
        select: { id: true },
      });
      if (model) catalogModelId = model.id;
    } else {
      catalogModelId = undefined;
    }
  }

  const updated = await db.chatSession.update({
    where: { id: existing.id },
    data: {
      ...(data.title !== undefined ? { title: data.title.trim() } : {}),
      ...(data.isPinned !== undefined ? { isPinned: data.isPinned } : {}),
      ...(catalogModelId !== undefined ? { catalogModelId } : {}),
    },
    include: {
      catalogModel: { select: { publicId: true } },
      _count: { select: { messages: true } },
    },
  });

  return toSessionDto(updated);
}

/**
 * Delete chat session and its cascaded messages/files.
 */
export async function deleteChatSession(
  userId: bigint,
  sessionPublicId: string
): Promise<void> {
  const session = await getChatSession(userId, sessionPublicId);
  await db.chatSession.delete({
    where: { id: session.id },
  });
}

/**
 * List messages in a session with cursor pagination.
 */
export async function listChatMessages(
  userId: bigint,
  sessionPublicId: string,
  options: { limit?: number; cursor?: string } = {}
): Promise<{ messages: ChatMessageDto[]; nextCursor: string | null }> {
  const session = await getChatSession(userId, sessionPublicId);
  const limit = Math.min(Math.max(1, options.limit ?? 50), 100);

  let cursorCondition: Prisma.ChatMessageWhereInput | undefined;
  if (options.cursor) {
    const cursorMsg = await db.chatMessage.findFirst({
      where: { publicId: options.cursor, sessionId: session.id },
      select: { id: true },
    });
    if (cursorMsg) {
      cursorCondition = { id: { gt: cursorMsg.id } };
    }
  }

  const messages = await db.chatMessage.findMany({
    where: {
      sessionId: session.id,
      ...(cursorCondition ? cursorCondition : {}),
    },
    orderBy: { id: "asc" },
    take: limit + 1,
    include: {
      catalogModel: { select: { publicId: true } },
    },
  });

  let nextCursor: string | null = null;
  if (messages.length > limit) {
    const nextItem = messages.pop()!;
    nextCursor = nextItem.publicId;
  }

  return {
    messages: messages.map(toMessageDto),
    nextCursor,
  };
}

/**
 * Retrieve recent message history formatted for LLM gateway execution.
 */
export async function getRecentMessagesForGateway(
  sessionId: bigint,
  takeCount = 20
): Promise<Array<{ role: "system" | "user" | "assistant" | "tool"; content: string }>> {
  const messages = await db.chatMessage.findMany({
    where: {
      sessionId,
      status: { in: ["completed", "aborted"] },
    },
    orderBy: { id: "desc" },
    take: takeCount,
    select: {
      role: true,
      content: true,
    },
  });

  return messages.reverse().map((m) => ({
    role: m.role as "system" | "user" | "assistant" | "tool",
    content: m.content,
  }));
}
