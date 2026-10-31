import { getExtensionLabel, isImageMimeType } from "./policy";
import type { SessionFileItem } from "@/types";

export const OPEN_FILE_PREVIEW_EVENT = "devnuby:open-file-preview";
export const EXTERNAL_TEXT_SELECTION_EVENT = "devnuby:external-text-selection";
export const AI_EDIT_REQUEST_EVENT = "devnuby:ai-edit-request";
export const AI_FILE_UPDATED_EVENT = "devnuby:file-updated";
export const AI_HIGHLIGHT_EVENT = "devnuby:ai-highlight";
export const ADD_EDIT_CHIP_EVENT = "devnuby:add-edit-chip";
export const REMOVE_EDIT_CHIP_EVENT = "devnuby:remove-edit-chip";
export const CLEAR_EDIT_CHIPS_EVENT = "devnuby:clear-edit-chips";

export interface EditRequestChip {
  id: string;
  fileId: string;
  filename: string;
  selectedText: string;
  instruction?: string;
  lineNumber?: number;
  lineEndNumber?: number;
  page?: number;
  cellRange?: string;
  tagName?: string;
  rect?: { x: number; y: number; width: number; height: number };
}

export function dispatchAddEditChip(chip: EditRequestChip): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<EditRequestChip>(ADD_EDIT_CHIP_EVENT, { detail: chip }));
}

export function dispatchRemoveEditChip(chipId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<{ id: string }>(REMOVE_EDIT_CHIP_EVENT, { detail: { id: chipId } }));
}

export function dispatchClearEditChips(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CLEAR_EDIT_CHIPS_EVENT));
}

export interface ExternalTextSelectionPayload {
  text: string;
  top: number;
  left: number;
  surfaceTone?: "light" | "dark";
}

export interface AIEditRequestPayload {
  fileId: string;
  filename: string;
  selectedText: string;
  instruction: string;
  lineNumber?: number;
  lineEndNumber?: number;
  page?: number;
  cellRange?: string;
  mode?: "ai" | "instant";
}

export interface AIFileUpdatedPayload {
  fileId: string;
  filename: string;
  reason: "ai-edit";
  highlightTarget?: {
    text: string;
    charOffset?: number;
  };
}

export interface AIHighlightPayload {
  fileId: string;
  text: string;
  scrollIntoView?: boolean;
}

export function dispatchAIEditRequest(payload: AIEditRequestPayload): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AIEditRequestPayload>(AI_EDIT_REQUEST_EVENT, { detail: payload }));
}

export function dispatchAIFileUpdated(payload: AIFileUpdatedPayload): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AIFileUpdatedPayload>(AI_FILE_UPDATED_EVENT, { detail: payload }));
}

export function dispatchAIHighlight(payload: AIHighlightPayload): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AIHighlightPayload>(AI_HIGHLIGHT_EVENT, { detail: payload }));
}

export interface PreviewableFileTarget {
  id: string;
  filename: string;
  displayName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  source?: string;
  isImage: boolean;
  url: string;
  createdAt?: string;
}

export function toSessionFileItem(target: PreviewableFileTarget): SessionFileItem {
  const displayName = target.displayName || target.filename;
  const extension = target.extension || getExtensionLabel(displayName);
  return {
    id: target.id,
    filename: target.filename || displayName,
    displayName,
    extension,
    mimeType: target.mimeType || "application/octet-stream",
    sizeBytes: target.sizeBytes ?? 0,
    source: target.source || "upload",
    isImage: target.isImage ?? isImageMimeType(target.mimeType || ""),
    url: target.url,
    createdAt: target.createdAt || new Date().toISOString(),
  };
}

/**
 * Appends or updates a cache-busting timestamp `?t=...` on a file URL.
 */
export function withCacheBuster(rawUrl: string, timestamp = Date.now()): string {
  if (!rawUrl) return rawUrl;
  try {
    const isRelative = rawUrl.startsWith("/");
    const url = new URL(rawUrl, "http://localhost");
    url.searchParams.set("t", String(timestamp));
    return isRelative ? `${url.pathname}${url.search}` : url.toString();
  } catch {
    const [base] = rawUrl.split("?");
    return `${base}?t=${timestamp}`;
  }
}

/**
 * Dispatches a request to open a non-image file inside the right-hand `ChatFilesPanel`.
 */
export function openFileInRightPanel(target: PreviewableFileTarget): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SessionFileItem>(OPEN_FILE_PREVIEW_EVENT, {
      detail: toSessionFileItem(target),
    })
  );
}

/**
 * Emits or clears text selection coordinates originating inside a sandboxed preview iframe.
 */
export function emitExternalTextSelection(
  payload: ExternalTextSelectionPayload | null
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ExternalTextSelectionPayload | null>(
      EXTERNAL_TEXT_SELECTION_EVENT,
      { detail: payload }
    )
  );
}
