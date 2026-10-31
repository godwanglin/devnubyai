import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";
import { uuidv7 } from "@/lib/api/uuidv7";
import {
  formatDisplayFilename,
  getExtensionLabel,
  isImageMimeType,
} from "@/lib/files/policy";
import { stripFeedbackParts } from "./feedback";
import { getChatSession, type ChatMessageDto } from "./service";

export interface SessionFileItemDto {
  id: string;
  filename: string;
  displayName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  source: string;
  isImage: boolean;
  url: string;
  createdAt: string;
}

export interface SharedChatDto {
  id: string;
  title: string;
  sharedAt: string | null;
  updatedAt: string;
  messages: ChatMessageDto[];
}

/**
 * Lists all files uploaded or generated within a chat session, newest first.
 */
export async function listSessionFiles(
  userId: bigint,
  sessionPublicId: string
): Promise<SessionFileItemDto[]> {
  const session = await getChatSession(userId, sessionPublicId);

  const files = await db.sessionFile.findMany({
    where: { sessionId: session.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  return files.map((f) => {
    const displayName = formatDisplayFilename(f.filename);
    return {
      id: f.publicId,
      filename: f.filename,
      displayName,
      extension: getExtensionLabel(displayName),
      mimeType: f.mimeType,
      sizeBytes: Number(f.sizeBytes),
      source: f.source,
      isImage: isImageMimeType(f.mimeType),
      url: `/api/v1/chats/${session.publicId}/files/${f.publicId}`,
      createdAt: f.createdAt.toISOString(),
    };
  });
}

/**
 * Enables public read-only sharing on a chat session (reusing existing token if already shared).
 */
export async function enableChatShare(
  userId: bigint,
  sessionPublicId: string
): Promise<{ shareToken: string; sharedAt: string }> {
  const existing = await getChatSession(userId, sessionPublicId);

  if (existing.shareToken && existing.sharedAt) {
    return {
      shareToken: existing.shareToken,
      sharedAt: existing.sharedAt.toISOString(),
    };
  }

  const token = uuidv7();
  const now = new Date();

  const updated = await db.chatSession.update({
    where: { id: existing.id },
    data: {
      shareToken: token,
      sharedAt: now,
    },
    select: {
      shareToken: true,
      sharedAt: true,
    },
  });

  return {
    shareToken: updated.shareToken!,
    sharedAt: (updated.sharedAt ?? now).toISOString(),
  };
}

/**
 * Revokes public read-only sharing on a chat session.
 */
export async function revokeChatShare(
  userId: bigint,
  sessionPublicId: string
): Promise<void> {
  const existing = await getChatSession(userId, sessionPublicId);

  await db.chatSession.update({
    where: { id: existing.id },
    data: {
      shareToken: null,
      sharedAt: null,
    },
  });
}

/**
 * Loads a publicly shared chat session and its messages by shareToken (no auth required).
 */
export async function getPublicSharedChat(shareToken: string): Promise<SharedChatDto> {
  const cleanToken = shareToken.trim();
  if (!cleanToken || cleanToken.length !== 36) {
    throw ApiError.notFound("Shared conversation not found");
  }

  const session = await db.chatSession.findUnique({
    where: { shareToken: cleanToken },
    select: {
      id: true,
      publicId: true,
      title: true,
      sharedAt: true,
      updatedAt: true,
    },
  });

  if (!session) {
    throw ApiError.notFound("Shared conversation not found");
  }

  const messages = await db.chatMessage.findMany({
    where: {
      sessionId: session.id,
      role: { in: ["user", "assistant"] },
      status: { in: ["completed", "aborted"] },
    },
    orderBy: { id: "asc" },
    take: 200,
    include: {
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

  const formattedMessages: ChatMessageDto[] = messages.map((m) => {
    const attachments = m.files.map((f) => ({
      id: f.publicId,
      filename: f.filename,
      displayName: formatDisplayFilename(f.filename),
      mimeType: f.mimeType,
      sizeBytes: Number(f.sizeBytes),
      isImage: isImageMimeType(f.mimeType),
      url: `/api/v1/share/${cleanToken}/files/${f.publicId}`,
    }));

    const sanitizedParts = m.parts ? stripFeedbackParts(m.parts) : m.parts;

    return {
      id: m.publicId,
      role: m.role as "user" | "assistant",
      content: m.content,
      reasoning: m.reasoning,
      parts: rewriteSharedPartsUrls(sanitizedParts, session.publicId, cleanToken),
      status: m.status,
      attachments: attachments.length > 0 ? attachments : undefined,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    };
  });

  return {
    id: session.publicId,
    title: session.title,
    sharedAt: session.sharedAt ? session.sharedAt.toISOString() : null,
    updatedAt: session.updatedAt.toISOString(),
    messages: formattedMessages,
  };
}

function rewriteSharedPartsUrls(
  parts: unknown,
  sessionPublicId: string,
  shareToken: string
): unknown {
  if (!parts) return parts;
  const privatePrefix = `/api/v1/chats/${sessionPublicId}/files/`;
  const publicPrefix = `/api/v1/share/${shareToken}/files/`;
  const serialized = typeof parts === "string" ? parts : JSON.stringify(parts);
  if (!serialized.includes(privatePrefix)) return parts;
  const rewritten = serialized.split(privatePrefix).join(publicPrefix);
  try {
    return JSON.parse(rewritten);
  } catch {
    return parts;
  }
}
