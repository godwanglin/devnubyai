import { formatDisplayFilename } from "@/lib/files/policy";
import type { SessionWithMeta, ChatMessageDto } from "./service-types";

/**
 * Format a DB chat session into public DTO.
 */
export function toSessionDto(
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
    requestId?: string | null;
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
    requestId: message.requestId ?? null,
    promptTokens: message.promptTokens,
    completionTokens: message.completionTokens,
    catalogModelId: message.catalogModel?.publicId ?? null,
    attachments: attachments && attachments.length > 0 ? attachments : undefined,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
  };
}
