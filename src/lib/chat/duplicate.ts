import { db } from "@/lib/db";
import { Prisma } from "@/generated/client";
import { copyInR2 } from "@/lib/storage/r2";
import { getChatSession, type SessionWithMeta } from "./service";

/**
 * Duplicate an existing chat session along with its persisted messages and files.
 */
export async function duplicateChatSession(
  userId: bigint,
  userPublicId: string,
  sessionPublicId: string,
  options: { title?: string } = {}
): Promise<SessionWithMeta> {
  const source = await getChatSession(userId, sessionPublicId);

  const sourceMessages = await db.chatMessage.findMany({
    where: {
      sessionId: source.id,
      status: { in: ["completed", "aborted"] },
    },
    orderBy: { id: "asc" },
    include: {
      files: true,
    },
  });

  const resolvedTitle = (
    options.title?.trim() || `${source.title.slice(0, 191)} (Copy)`
  ).slice(0, 200);

  const pendingFileCopies: Array<{
    newMessageId: bigint;
    filename: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: bigint;
    source: string;
  }> = [];

  const createdSession = await db.$transaction(async (tx) => {
    const newSession = await tx.chatSession.create({
      data: {
        userId,
        title: resolvedTitle,
        catalogModelId: source.catalogModelId,
        isPinned: false,
        lastMessageAt: new Date(),
      },
      include: {
        catalogModel: { select: { publicId: true } },
      },
    });

    for (const msg of sourceMessages) {
      const newMsg = await tx.chatMessage.create({
        data: {
          sessionId: newSession.id,
          role: msg.role,
          content: msg.content,
          reasoning: msg.reasoning,
          parts:
            msg.parts !== null && msg.parts !== undefined
              ? (msg.parts as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          catalogModelId: msg.catalogModelId,
          status: msg.status,
          promptTokens: msg.promptTokens,
          completionTokens: msg.completionTokens,
        },
        select: { id: true },
      });

      for (const file of msg.files) {
        pendingFileCopies.push({
          newMessageId: newMsg.id,
          filename: file.filename,
          storageKey: file.storageKey,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          source: file.source,
        });
      }
    }

    return newSession;
  });

  // Copy R2 objects outside DB transaction so network I/O never holds locks
  for (const fileItem of pendingFileCopies) {
    try {
      const newStorageKey = await copyInR2({
        sourceKey: fileItem.storageKey,
        userId: userPublicId,
        targetSessionId: createdSession.publicId,
        filename: fileItem.filename,
      });

      await db.sessionFile.create({
        data: {
          userId,
          sessionId: createdSession.id,
          messageId: fileItem.newMessageId,
          filename: fileItem.filename,
          storageKey: newStorageKey,
          mimeType: fileItem.mimeType,
          sizeBytes: fileItem.sizeBytes,
          source: fileItem.source,
        },
      });
    } catch {
      // Skip individual file if storage object is unavailable
    }
  }

  return {
    id: createdSession.publicId,
    title: createdSession.title,
    isPinned: createdSession.isPinned,
    isArchived: createdSession.isArchived,
    shareToken: createdSession.shareToken,
    catalogModelId: createdSession.catalogModel?.publicId ?? null,
    lastMessageAt: createdSession.lastMessageAt.toISOString(),
    createdAt: createdSession.createdAt.toISOString(),
    updatedAt: createdSession.updatedAt.toISOString(),
    messageCount: sourceMessages.length,
  };
}
