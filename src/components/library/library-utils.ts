import { classifyPreviewKind } from "@/lib/files/policy";
import type { LibraryFileDto } from "@/lib/library/types";

export type LibraryTab = "all" | "generated" | "upload";
export type LibraryKind = "all" | "document" | "image" | "spreadsheet" | "presentation" | "code" | "other";
export type LibrarySort = "newest" | "oldest" | "name" | "size";
export type LibraryViewMode = "grid" | "list";
export type LibraryDateGroup = "today" | "yesterday" | "week" | "month" | "older";

export const LIBRARY_KINDS: Exclude<LibraryKind, "all">[] = [
  "document",
  "image",
  "spreadsheet",
  "presentation",
  "code",
  "other",
];

/** Which filter chip a file falls under */
export function libraryKindOf(file: Pick<LibraryFileDto, "extension" | "mimeType" | "isImage">): Exclude<LibraryKind, "all"> {
  if (file.isImage) return "image";
  const ext = file.extension.toLowerCase();
  const kind = classifyPreviewKind(ext, file.mimeType);
  switch (kind) {
    case "image":
    case "svg":
      return "image";
    case "spreadsheet":
      return "spreadsheet";
    case "pptx":
      return "presentation";
    case "pdf":
    case "docx":
    case "doc":
    case "rtf":
    case "odt":
    case "epub":
    case "markdown":
    case "text":
      return "document";
    case "html":
    case "code":
    case "json":
    case "mermaid":
      return "code";
    default:
      if (["ppt", "odp", "potx"].includes(ext)) return "presentation";
      return "other";
  }
}

/**
 * Tile colours per file type, so a grid of files reads at a glance. Muted tints that
 * sit on both the light and the dark theme.
 */
export function fileTone(file: Pick<LibraryFileDto, "extension" | "mimeType" | "isImage">): {
  tile: string;
  icon: string;
  badge: string;
} {
  const ext = file.extension.toLowerCase();
  if (ext === "pdf") {
    return { tile: "bg-red-500/[0.07]", icon: "text-red-500", badge: "bg-red-500/12 text-red-500" };
  }
  const kind = libraryKindOf(file);
  switch (kind) {
    case "document":
      return { tile: "bg-blue-500/[0.07]", icon: "text-blue-500", badge: "bg-blue-500/12 text-blue-500" };
    case "spreadsheet":
      return { tile: "bg-emerald-500/[0.07]", icon: "text-emerald-500", badge: "bg-emerald-500/12 text-emerald-500" };
    case "presentation":
      return { tile: "bg-orange-500/[0.07]", icon: "text-orange-500", badge: "bg-orange-500/12 text-orange-500" };
    case "code":
      return { tile: "bg-violet-500/[0.07]", icon: "text-violet-500", badge: "bg-violet-500/12 text-violet-500" };
    case "image":
      return { tile: "bg-pink-500/[0.07]", icon: "text-pink-500", badge: "bg-pink-500/12 text-pink-500" };
    default:
      return { tile: "bg-[var(--hover)]", icon: "text-[var(--muted)]", badge: "bg-[var(--hover)] text-[var(--muted)]" };
  }
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function dateGroupOf(iso: string, now = new Date()): LibraryDateGroup {
  const day = startOfDay(new Date(iso));
  const today = startOfDay(now);
  const dayMs = 86_400_000;
  if (day >= today) return "today";
  if (day >= today - dayMs) return "yesterday";
  if (day >= today - 6 * dayMs) return "week";
  if (day >= today - 29 * dayMs) return "month";
  return "older";
}

export const DATE_GROUP_ORDER: LibraryDateGroup[] = ["today", "yesterday", "week", "month", "older"];

export function formatShortDate(iso: string, locale: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(locale === "id" ? "id-ID" : "en-US", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function formatDateTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale === "id" ? "id-ID" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Where a file's chat lives: project chats open under their project */
export function chatHref(file: LibraryFileDto): string {
  return file.chat.projectId
    ? `/project/${file.chat.projectId}/c/${file.chat.id}`
    : `/c/${file.chat.id}`;
}

export function sortFiles(files: LibraryFileDto[], sort: LibrarySort): LibraryFileDto[] {
  const list = [...files];
  switch (sort) {
    case "oldest":
      return list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    case "name":
      return list.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
    case "size":
      return list.sort((a, b) => b.sizeBytes - a.sizeBytes);
    default:
      return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
