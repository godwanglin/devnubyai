import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";
import type { Prisma } from "@/generated/client";
import { deleteKeyFromR2 } from "@/lib/storage/r2";
import { formatDisplayFilename } from "@/lib/files/policy";
import { extractQuotes, withQuotedContext } from "./quotes";
import { assertUserModelAccess } from "./model-access";

export { duplicateChatSession } from "./duplicate";

export interface SessionWithMeta {
  id: string; // publicId
  title: string;
  isPinned: boolean;
  isArchived: boolean;
  shareToken: string | null;
  catalogModelId: string | null;
  projectId?: string | null;
  isLocked?: boolean;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface MessageAttachmentDto {
  id: string; // SessionFile publicId
  filename: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  isImage: boolean;
  url: string;
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
  attachments?: MessageAttachmentDto[];
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
    isArchived: boolean;
    isLocked?: boolean;
    shareToken: string | null;
    lastMessageAt: Date;
    createdAt: Date;
    updatedAt: Date;
    catalogModel?: { publicId: string } | null;
    project?: { publicId: string } | null;
    _count?: { messages: number };
  }
): SessionWithMeta {
  return {
    id: session.publicId,
    title: session.title,
    isPinned: session.isPinned,
    isArchived: session.isArchived,
    isLocked: Boolean(session.isLocked),
    shareToken: session.shareToken,
    catalogModelId: session.catalogModel?.publicId ?? null,
    projectId: session.project?.publicId ?? null,
    lastMessageAt: session.lastMessageAt.toISOString(),
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    messageCount: session._count?.messages ?? 0,
  };
}

/**
 * Format a DB chat message into public DTO.
 */
export function toMessageDto(
  message: {
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
    files?: Array<{
      publicId: string;
      filename: string;
      mimeType: string;
      sizeBytes: bigint;
    }>;
    createdAt: Date;
    updatedAt: Date;
  },
  sessionPublicId?: string
): ChatMessageDto {
  const attachments = message.files?.map((f) => {
    const displayName = formatDisplayFilename(f.filename);
    const fileUrl = sessionPublicId
      ? `/api/v1/chats/${sessionPublicId}/files/${f.publicId}`
      : "";
    return {
      id: f.publicId,
      filename: f.filename,
      displayName,
      mimeType: f.mimeType,
      sizeBytes: Number(f.sizeBytes),
      isImage: f.mimeType.startsWith("image/"),
      url: fileUrl,
    };
  });

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
    attachments: attachments && attachments.length > 0 ? attachments : undefined,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
  };
}

/**
 * List user chat sessions with cursor pagination (based on lastMessageAt / id DESC).
 */
export async function listUserChatSessions(
  userId: bigint,
  options: { limit?: number; cursor?: string; archived?: boolean } = {}
): Promise<{ sessions: SessionWithMeta[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(1, options.limit ?? 30), 100);
  const archived = Boolean(options.archived);

  let cursorCondition: Prisma.ChatSessionWhereInput | undefined;
  if (options.cursor) {
    const cursorSession = await db.chatSession.findFirst({
      where: { publicId: options.cursor, userId, isArchived: archived },
      select: { id: true, isPinned: true, lastMessageAt: true },
    });

    if (cursorSession) {
      cursorCondition = archived
        ? {
            OR: [
              { lastMessageAt: { lt: cursorSession.lastMessageAt } },
              {
                lastMessageAt: cursorSession.lastMessageAt,
                id: { lt: cursorSession.id },
              },
            ],
          }
        : {
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
      isArchived: archived,
      ...(cursorCondition ? cursorCondition : {}),
    },
    orderBy: archived
      ? [{ lastMessageAt: "desc" }, { id: "desc" }]
      : [{ isPinned: "desc" }, { lastMessageAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    include: {
      catalogModel: { select: { publicId: true } },
      project: { select: { publicId: true } },
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
  data: { title?: string; modelPublicId?: string; projectId?: string }
): Promise<SessionWithMeta> {
  let catalogModelId: bigint | null = null;
  let projectInternalId: bigint | null = null;

  if (data.projectId) {
    const proj = await db.project.findFirst({
      where: { publicId: data.projectId, userId },
      select: { id: true },
    });
    if (proj) projectInternalId = proj.id;
  }

  if (data.modelPublicId) {
    const model = await db.catalogModel.findUnique({
      where: { publicId: data.modelPublicId },
      select: { id: true },
    });
    if (model) {
      await assertUserModelAccess(userId, model.id);
      catalogModelId = model.id;
    }
  }

  const session = await db.chatSession.create({
    data: {
      userId,
      title: data.title?.trim() || "New chat",
      catalogModelId,
      projectId: projectInternalId,
      lastMessageAt: new Date(),
    },
    include: {
      catalogModel: { select: { publicId: true } },
      project: { select: { publicId: true } },
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
  isArchived: boolean;
  shareToken: string | null;
  sharedAt: Date | null;
  catalogModelId: bigint | null;
  catalogModelPublicId: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt: Date;
  projectId: string | null;
  projectInternalId: bigint | null;
  isLocked: boolean;
}> {
  const session = await db.chatSession.findFirst({
    where: { publicId: sessionPublicId, userId },
    include: {
      catalogModel: { select: { id: true, publicId: true } },
      project: { select: { id: true, publicId: true } },
    },
  });

  if (!session) {
    throw ApiError.notFound("Chat session not found");
  }

  return {
    id: session.id,
    publicId: session.publicId,
    title: session.title,
    isPinned: session.isPinned,
    isArchived: session.isArchived,
    isLocked: session.isLocked,
    shareToken: session.shareToken,
    sharedAt: session.sharedAt,
    catalogModelId: session.catalogModelId,
    catalogModelPublicId: session.catalogModel?.publicId ?? null,
    projectId: session.project?.publicId ?? null,
    projectInternalId: session.projectId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastMessageAt: session.lastMessageAt,
  };
}

/**
 * Update chat session (title, isPinned, isArchived, or default model).
 */
export async function updateChatSession(
  userId: bigint,
  sessionPublicId: string,
  data: {
    title?: string;
    isPinned?: boolean;
    isArchived?: boolean;
    modelPublicId?: string;
    projectId?: string | null;
    isLocked?: boolean;
  }
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

  let projectInternalId: bigint | null | undefined = undefined;
  if (data.projectId !== undefined) {
    if (data.projectId === null) {
      projectInternalId = null;
    } else {
      const proj = await db.project.findFirst({
        where: { publicId: data.projectId, userId },
        select: { id: true },
      });
      if (!proj) {
        throw ApiError.notFound("Proyek tujuan tidak ditemukan");
      }
      projectInternalId = proj.id;
    }
  }

  const nextPinned =
    data.isPinned !== undefined
      ? data.isPinned
      : data.isArchived === true
        ? false
        : undefined;

  const updated = await db.chatSession.update({
    where: { id: existing.id },
    data: {
      ...(data.title !== undefined ? { title: data.title.trim() } : {}),
      ...(nextPinned !== undefined ? { isPinned: nextPinned } : {}),
      ...(data.isArchived !== undefined ? { isArchived: data.isArchived } : {}),
      ...(catalogModelId !== undefined ? { catalogModelId } : {}),
      ...(projectInternalId !== undefined ? { projectId: projectInternalId } : {}),
      ...(data.isLocked !== undefined ? { isLocked: data.isLocked } : {}),
    },
    include: {
      catalogModel: { select: { publicId: true } },
      project: { select: { publicId: true } },
    },
  });

  return toSessionDto(updated);
}

/**
 * Delete chat session and its cascaded messages/files (including R2 cleanup).
 */
export async function deleteChatSession(
  userId: bigint,
  sessionPublicId: string
): Promise<void> {
  const session = await getChatSession(userId, sessionPublicId);

  const attachedFiles = await db.sessionFile.findMany({
    where: { sessionId: session.id },
    select: { storageKey: true },
  });

  await db.chatSession.delete({
    where: { id: session.id },
  });

  // Best-effort cleanup of R2 storage objects outside DB transaction
  await Promise.allSettled(
    attachedFiles.map((f) => deleteKeyFromR2(f.storageKey))
  );
}

export interface ListChatMessagesResult {
  session: {
    id: string;
    title: string;
    isPinned: boolean;
    isArchived: boolean;
    shareToken: string | null;
    catalogModelId: string | null;
  projectId?: string | null;
  isLocked?: boolean;
    lastMessageAt: string;
    createdAt: string;
    updatedAt: string;
  };
  messages: ChatMessageDto[];
  nextCursor: string | null;
}

/**
 * List messages in a session with cursor pagination.
 */
export async function listChatMessages(
  userId: bigint,
  sessionPublicId: string,
  options: { limit?: number; cursor?: string } = {}
): Promise<ListChatMessagesResult> {
  const session = await getChatSession(userId, sessionPublicId);
  const limit = Math.min(Math.max(1, options.limit ?? 10), 500);

  let cursorCondition: Prisma.ChatMessageWhereInput | undefined;
  if (options.cursor) {
    const cursorMsg = await db.chatMessage.findFirst({
      where: { publicId: options.cursor, sessionId: session.id },
      select: { id: true },
    });
    if (cursorMsg) {
      cursorCondition = { id: { lte: cursorMsg.id } };
    }
  }

  // Load latest messages in reverse order (id DESC) so initial fetch grabs the latest turns
  const messagesDesc = await db.chatMessage.findMany({
    where: {
      sessionId: session.id,
      ...(cursorCondition ? cursorCondition : {}),
    },
    orderBy: { id: "desc" },
    take: limit + 1,
    include: {
      catalogModel: { select: { publicId: true } },
      files: {
        select: {
          publicId: true,
          filename: true,
          mimeType: true,
          sizeBytes: true,
        },
      },
    },
  });

  // When more items exist, the extra item at index `limit` is popped and its publicId becomes nextCursor
  let nextCursor: string | null = null;
  if (messagesDesc.length > limit) {
    const overflowItem = messagesDesc.pop()!;
    nextCursor = overflowItem.publicId;
  }

  // Reverse back to chronological order (asc) for UI display
  const messages = messagesDesc.reverse();

  return {
    session: {
      id: session.publicId,
      title: session.title,
      isPinned: session.isPinned,
      isArchived: session.isArchived,
      shareToken: session.shareToken,
      catalogModelId: session.catalogModelPublicId,
      lastMessageAt: session.lastMessageAt.toISOString(),
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    },
    messages: messages.map((m) => toMessageDto(m, session.publicId)),
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
      parts: true,
    },
  });

  return messages.reverse().map((m) => ({
    role: m.role as "system" | "user" | "assistant" | "tool",
    content: m.role === "user" ? withQuotedContext(m.content, extractQuotes(m.parts)) : m.content,
  }));
}
