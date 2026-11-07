import { db } from "@/lib/db";
import {
  formatDisplayFilename,
  getExtensionLabel,
  isImageMimeType,
} from "@/lib/files/policy";
import { isHelperSkillArtifactName } from "@/lib/chat/turn-recovery";
import type { LibraryFileDto, LibraryResponseDto } from "./types";

/** Most recent files returned in one go; the page filters and searches them client-side */
export const LIBRARY_MAX_FILES = 1000;

/**
 * Every file the user uploaded or the AI generated across their chats, newest first.
 * Files of PIN-locked chats are left out (opening them would bypass the PIN), and so are
 * the AI's helper artifacts (verification previews, scratch and intermediate parts),
 * the same way the chat files panel hides them.
 */
export async function listLibraryFiles(userId: bigint): Promise<LibraryResponseDto> {
  const rows = await db.sessionFile.findMany({
    where: { userId, session: { isLocked: false } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LIBRARY_MAX_FILES + 1,
    select: {
      publicId: true,
      sessionId: true,
      filename: true,
      mimeType: true,
      sizeBytes: true,
      source: true,
      createdAt: true,
      session: {
        select: {
          publicId: true,
          title: true,
          isArchived: true,
          project: { select: { publicId: true, name: true } },
        },
      },
    },
  });

  const truncated = rows.length > LIBRARY_MAX_FILES;
  const page = truncated ? rows.slice(0, LIBRARY_MAX_FILES) : rows;

  // Helper-artifact detection compares a file against its chat's other files
  const namesBySession = new Map<bigint, string[]>();
  for (const row of page) {
    const list = namesBySession.get(row.sessionId) ?? [];
    list.push(formatDisplayFilename(row.filename));
    namesBySession.set(row.sessionId, list);
  }

  const files: LibraryFileDto[] = [];
  for (const row of page) {
    const displayName = formatDisplayFilename(row.filename);
    if (
      row.source !== "upload" &&
      isHelperSkillArtifactName(displayName, namesBySession.get(row.sessionId) ?? [])
    ) {
      continue;
    }
    files.push({
      id: row.publicId,
      filename: row.filename,
      displayName,
      extension: getExtensionLabel(displayName),
      mimeType: row.mimeType,
      sizeBytes: Number(row.sizeBytes),
      source: row.source === "upload" ? "upload" : "generated",
      isImage: isImageMimeType(row.mimeType),
      url: `/api/v1/chats/${row.session.publicId}/files/${row.publicId}`,
      createdAt: row.createdAt.toISOString(),
      chat: {
        id: row.session.publicId,
        title: row.session.title,
        isArchived: row.session.isArchived,
        projectId: row.session.project?.publicId ?? null,
        projectName: row.session.project?.name ?? null,
      },
    });
  }

  return { files, truncated };
}
