"use client";

import React, { useEffect, useState } from "react";
import {
  ArrowLeft, BookOpen, Download, FileCode, Files, FileSpreadsheet, FileText,
  Folder, Globe, Image as ImageIcon, Maximize2, Minimize2, PanelLeft, Paperclip,
  Presentation, X,
} from "lucide-react";
import {
  ImagePreviewModal,
  type PreviewImageTarget,
} from "@/components/modals/image-preview-modal";
import { CollapsibleGroup } from "@/components/sidebar/collapsible-group";
import { PanelResizeHandle } from "@/components/ui/panel-resize-handle";
import { Tooltip } from "@/components/ui/tooltip";
import { useResizablePanel } from "@/hooks/use-resizable-panel";
import { cn } from "@/lib/cn";
import { classifyPreviewKind, formatFileSize } from "@/lib/files/policy";
import {
  AI_HIGHLIGHT_EVENT, type AIHighlightPayload, withCacheBuster,
} from "@/lib/files/preview-events";
import { useI18n } from "@/providers/i18n-provider";
import type { SessionFileItem } from "@/types";
import { FilePreviewSurface } from "./previews/file-preview-surface";

export interface ChatFilesPanelProps {
  isOpen: boolean;
  chatId: string | null;
  refreshKey?: number;
  activeFile?: SessionFileItem | null;
  onSelectFile?: (file: SessionFileItem | null) => void;
  readOnly?: boolean;
  isFullscreen?: boolean;
  showSidebarToggle?: boolean;
  onToggleFullscreen?: () => void;
  onToggleSidebar?: () => void;
  onClose: () => void;
}

const DEFAULT_WIDTH = 460;
const MIN_WIDTH = 300;
const MAX_WIDTH = 920;

export function renderSessionFileIcon(
  file: Pick<SessionFileItem, "extension" | "isImage" | "mimeType">
) {
  const kind = classifyPreviewKind(file.extension, file.mimeType);
  if (file.isImage || kind === "image" || kind === "svg") {
    return <ImageIcon className="w-4 h-4 text-[var(--muted)] shrink-0" />;
  }
  if (kind === "html") {
    return <Globe className="w-4 h-4 text-[var(--muted)] shrink-0" />;
  }
  if (kind === "spreadsheet") {
    return <FileSpreadsheet className="w-4 h-4 text-[var(--muted)] shrink-0" />;
  }
  if (kind === "pptx") {
    return <Presentation className="w-4 h-4 text-[var(--muted)] shrink-0" />;
  }
  if (kind === "epub") {
    return <BookOpen className="w-4 h-4 text-[var(--muted)] shrink-0" />;
  }
  if (kind === "code" || kind === "json" || kind === "mermaid") {
    return <FileCode className="w-4 h-4 text-[var(--muted)] shrink-0" />;
  }
  return <FileText className="w-4 h-4 text-[var(--muted)] shrink-0" />;
}

function isAiArtifact(file: SessionFileItem): boolean {
  return Boolean(file.source && file.source !== "upload");
}

function SessionFileRow({
  file,
  downloadLabel,
  onClick,
}: {
  file: SessionFileItem;
  downloadLabel: string;
  onClick: (file: SessionFileItem) => void;
}) {
  return (
    <div
      onClick={() => onClick(file)}
      className="group flex items-center gap-3 px-2 py-2.5 rounded-[8px] hover:bg-[var(--hover)]/60 transition-colors cursor-pointer"
    >
      {renderSessionFileIcon(file)}

      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-[var(--ink)] truncate">
          {file.displayName}
        </p>
        <p className="text-[11.5px] text-[var(--muted)] mt-0.5">
          {file.extension.toUpperCase()} · {formatFileSize(file.sizeBytes)}
        </p>
      </div>

      <Tooltip
        content={downloadLabel}
        side="top"
        align="end"
        className="shrink-0"
      >
        <a
          href={file.url}
          download={file.displayName}
          onClick={(e) => e.stopPropagation()}
          className="grid place-items-center w-7 h-7 rounded-[6px] text-[var(--muted)] hover:bg-[var(--panel-elevated)] hover:text-[var(--ink)] opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
          aria-label={downloadLabel}
        >
          <Download className="w-3.5 h-3.5" />
        </a>
      </Tooltip>
    </div>
  );
}

export function ChatFilesPanel({
  isOpen,
  chatId,
  refreshKey = 0,
  activeFile: controlledActiveFile,
  onSelectFile,
  readOnly = false,
  isFullscreen = false,
  showSidebarToggle = false,
  onToggleFullscreen,
  onToggleSidebar,
  onClose,
}: ChatFilesPanelProps) {
  const { t } = useI18n();
  const [files, setFiles] = useState<SessionFileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [eventRefreshTick, setEventRefreshTick] = useState(0);
  const [internalActiveFile, setInternalActiveFile] = useState<SessionFileItem | null>(null);
  const [previewImage, setPreviewImage] = useState<PreviewImageTarget | null>(null);
  const [openGroups, setOpenGroups] = useState({ artifacts: true, content: true });
  const [highlightTarget, setHighlightTarget] = useState<{ text: string; charOffset?: number } | null>(null);

  const effectiveOpen = isOpen && Boolean(chatId || readOnly);
  const selectedFile =
    controlledActiveFile !== undefined ? controlledActiveFile : internalActiveFile;

  function setSelectedFile(next: SessionFileItem | null) {
    if (onSelectFile) {
      onSelectFile(next);
    } else {
      setInternalActiveFile(next);
    }
  }

  const {
    panelRef: filesPanelRef,
    width,
    isDragging,
    handlePointerDown: handleResizePointerDown,
    resetWidth,
  } = useResizablePanel({
    defaultWidth: DEFAULT_WIDTH,
    minWidth: MIN_WIDTH,
    maxWidth: MAX_WIDTH,
    maxViewportRatio: 0.68,
    edge: "left",
    storageKey: "devnuby-files-panel-width",
    cssVar: "--files-panel-w",
  });

  const [prevChatId, setPrevChatId] = useState(chatId);
  if (prevChatId !== chatId) {
    setPrevChatId(chatId);
    setFiles([]);
    setInternalActiveFile(null);
    setPreviewImage(null);
  }

  useEffect(() => {
    if (!effectiveOpen || !chatId || readOnly) return;
    const handleFilesUpdated = () => setEventRefreshTick((n) => n + 1);
    window.addEventListener("devnuby:files-updated", handleFilesUpdated);
    return () => {
      window.removeEventListener("devnuby:files-updated", handleFilesUpdated);
    };
  }, [effectiveOpen, chatId, readOnly]);

  // AI live edit: listen for highlight requests (e.g. "teks ini ada di halaman 2")
  useEffect(() => {
    let dismissTimer: number | null = null;
    function onHighlight(e: Event) {
      const detail = (e as CustomEvent<AIHighlightPayload>).detail;
      if (!detail || !detail.text) return;
      setHighlightTarget({ text: detail.text });
      // Auto-scroll to the matching text after the preview re-renders
      window.requestAnimationFrame(() => {
        const el = document.querySelector(".ai-highlight");
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      // Clear the highlight after 5s so it doesn't linger forever
      if (dismissTimer) window.clearTimeout(dismissTimer);
      dismissTimer = window.setTimeout(() => setHighlightTarget(null), 5000);
    }
    window.addEventListener(AI_HIGHLIGHT_EVENT, onHighlight);
    return () => {
      window.removeEventListener(AI_HIGHLIGHT_EVENT, onHighlight);
      if (dismissTimer) window.clearTimeout(dismissTimer);
    };
  }, []);

  useEffect(() => {
    if (!effectiveOpen || !chatId || readOnly) return;

    let active = true;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/v1/chats/${chatId}/files`, {
          credentials: "same-origin",
        });
        if (!res.ok) return;
        const json = await res.json();
        if (active && Array.isArray(json?.data)) {
          setFiles(json.data);
        }
      } catch {
        // Ignore transient fetch errors
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [effectiveOpen, chatId, refreshKey, eventRefreshTick, readOnly]);

  function handleFileRowClick(file: SessionFileItem) {
    const item = { ...file, url: withCacheBuster(file.url) };
    const kind = classifyPreviewKind(item.displayName || item.extension, item.mimeType);
    if (item.isImage || kind === "image") {
      setPreviewImage({ url: item.url, title: item.displayName });
      return;
    }
    setSelectedFile(item);
  }

  const artifactFiles = files.filter(isAiArtifact);
  const contentFiles = files.filter((f) => !isAiArtifact(f));
  const fileGroups = [
    {
      key: "artifacts" as const,
      label: `${t("chatFiles.groupArtifacts")} (${artifactFiles.length})`,
      icon: <Folder className="w-3 h-3" />,
      items: artifactFiles,
    },
    {
      key: "content" as const,
      label: `${t("chatFiles.groupContent")} (${contentFiles.length})`,
      icon: <Paperclip className="w-3 h-3" />,
      items: contentFiles,
    },
  ];

  return (
    <>
      {/* Smooth mobile scrim backdrop matching left Sidebar */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-[90] bg-black/40 backdrop-blur-xs transition-opacity duration-300 ease-out md:hidden",
          effectiveOpen ? "visible opacity-100" : "invisible opacity-0 pointer-events-none"
        )}
      />

      {/* Unified right sidebar (smooth slide on mobile + smooth width glide on desktop) */}
      <aside
        ref={filesPanelRef}
        style={{ "--files-panel-w": `${width}px` } as React.CSSProperties}
        className={cn(
          "fixed inset-y-0 right-0 z-[95] flex w-full max-w-[420px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--panel)] shadow-2xl md:z-[40] md:max-w-none md:shadow-none md:translate-x-0",
          !isDragging &&
            "transition-[translate,width] duration-300 ease-[var(--ease-out)] motion-reduce:transition-none",
          !effectiveOpen
            ? "translate-x-full pointer-events-none invisible md:static md:w-0 md:border-l-0 md:overflow-hidden"
            : isFullscreen
              ? "translate-x-0 visible md:relative md:flex-1 md:min-w-0 md:w-auto"
              : "translate-x-0 visible md:relative md:w-[min(var(--files-panel-w),45vw)]",
          isDragging && "select-none"
        )}
      >
        {effectiveOpen && !isFullscreen && (
          <PanelResizeHandle
            edge="left"
            isDragging={isDragging}
            onPointerDown={handleResizePointerDown}
            onDoubleClick={resetWidth}
          />
        )}

        {/* Inner responsive frame follows panel width so right-aligned controls never overflow on <=1200px */}
        <div
          className={cn(
            "flex flex-col h-full min-h-0",
            isFullscreen ? "w-full" : "w-full min-w-[280px]"
          )}
        >
          {/* Topbar matching ChatTopbar height (h-14) */}
          <div className="flex items-center justify-between gap-2 h-14 px-4 sm:px-5 border-b border-[var(--border)] select-none shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              {isFullscreen && onToggleSidebar ? (
                <Tooltip
                  content={t("nav.showSidebar")}
                  side="bottom"
                  align="start"
                  className={cn(!showSidebarToggle && "md:hidden")}
                >
                  <button
                    type="button"
                    onClick={onToggleSidebar}
                    className="grid place-items-center w-8 h-8 -ml-1 rounded-[8px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer shrink-0"
                    aria-label={t("nav.showSidebar")}
                  >
                    <PanelLeft className="w-4 h-4" />
                  </button>
                </Tooltip>
              ) : null}

              {selectedFile && !readOnly ? (
                <Tooltip content={t("chatFiles.backToList")} side="bottom" align="start">
                  <button
                    type="button"
                    onClick={() => setSelectedFile(null)}
                    className="grid place-items-center w-8 h-8 -ml-1 rounded-[8px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer shrink-0"
                    aria-label={t("chatFiles.backToList")}
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                </Tooltip>
              ) : null}

              {selectedFile ? (
                <>
                  {renderSessionFileIcon(selectedFile)}
                  <h2 className="text-[14px] font-semibold text-[var(--ink)] truncate">
                    {selectedFile.displayName}
                  </h2>
                  <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded-[5px] bg-[var(--hover)] border border-[var(--border)] font-mono text-[10.5px] uppercase text-[var(--muted)] shrink-0">
                    {selectedFile.extension}
                  </span>
                </>
              ) : (
                <>
                  <Files className="w-4 h-4 text-[var(--muted)] shrink-0" />
                  <h2 className="text-[14.5px] font-semibold text-[var(--ink)] truncate">
                    {t("chatFiles.title")}
                  </h2>
                </>
              )}
            </div>

            <div className="flex items-center gap-0.5 shrink-0">
              {selectedFile ? (
                <Tooltip content={t("chatFiles.download")} side="bottom">
                  <a
                    href={selectedFile.url}
                    download={selectedFile.displayName}
                    className="grid place-items-center w-8 h-8 rounded-[8px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                    aria-label={t("chatFiles.download")}
                  >
                    <Download className="w-3.5 h-3.5" />
                  </a>
                </Tooltip>
              ) : null}

              {onToggleFullscreen ? (
                <Tooltip
                  content={isFullscreen ? t("chatFiles.shrink") : t("chatFiles.expand")}
                  side="bottom"
                  align="end"
                  className="hidden md:inline-flex"
                >
                  <button
                    type="button"
                    onClick={onToggleFullscreen}
                    className="grid place-items-center w-8 h-8 rounded-[8px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                    aria-label={isFullscreen ? t("chatFiles.shrink") : t("chatFiles.expand")}
                  >
                    {isFullscreen ? (
                      <Minimize2 className="w-3.5 h-3.5" />
                    ) : (
                      <Maximize2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                </Tooltip>
              ) : null}

              <Tooltip content={t("chatFiles.close")} side="bottom" align="end">
                <button
                  type="button"
                  onClick={onClose}
                  className="grid place-items-center w-8 h-8 rounded-[8px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                  aria-label={t("chatFiles.close")}
                >
                  <X className="w-4 h-4" />
                </button>
              </Tooltip>
            </div>
          </div>

          {/* Body: Either Rich Preview View (selectable for "Tanya Devnuby") OR Session File List */}
          {effectiveOpen && selectedFile ? (
            <div
              data-ask-selectable="true"
              className="flex-1 min-h-0 flex flex-col overflow-hidden"
            >
              <FilePreviewSurface
                key={`${selectedFile.id}-${selectedFile.url}`}
                file={selectedFile}
                highlightTarget={highlightTarget ?? undefined}
              />
            </div>
          ) : (
            <div
              className={cn(
                "flex-1 overflow-y-auto min-h-0 select-none",
                isFullscreen ? "px-4 sm:px-8" : "px-3"
              )}
            >
              <div className={cn(isFullscreen && "max-w-4xl mx-auto w-full")}>
                {loading && files.length === 0 ? (
                  <div className="divide-y divide-[var(--divider)] px-1 animate-pulse">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="py-4 flex items-center gap-3.5">
                        <span className="w-4 h-4 rounded bg-[var(--hover)] shrink-0" />
                        <div className="flex-1 space-y-2">
                          <span className="block h-3.5 w-3/4 rounded bg-[var(--hover)]" />
                          <span className="block h-2.5 w-10 rounded bg-[var(--hover)]" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : files.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-center py-16 px-4">
                    <span className="grid place-items-center w-10 h-10 rounded-full bg-[var(--hover)] text-[var(--muted)] mb-3">
                      <Files className="w-4 h-4" />
                    </span>
                    <p className="text-sm font-medium text-[var(--ink)]">
                      {t("chatFiles.emptyTitle")}
                    </p>
                    <p className="text-xs text-[var(--muted)] mt-1 max-w-[240px]">
                      {t("chatFiles.emptyHint")}
                    </p>
                  </div>
                ) : (
                  <div className="py-3 space-y-4">
                    {fileGroups.map(
                      (grp) =>
                        grp.items.length > 0 && (
                          <CollapsibleGroup
                            key={grp.key}
                            label={grp.label}
                            icon={grp.icon}
                            isOpen={openGroups[grp.key]}
                            onToggle={() =>
                              setOpenGroups((prev) => ({
                                ...prev,
                                [grp.key]: !prev[grp.key],
                              }))
                            }
                          >
                            {grp.items.map((file) => (
                              <SessionFileRow
                                key={file.id}
                                file={file}
                                downloadLabel={t("chatFiles.download")}
                                onClick={handleFileRowClick}
                              />
                            ))}
                          </CollapsibleGroup>
                        )
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </aside>

      <ImagePreviewModal
        image={previewImage}
        onClose={() => setPreviewImage(null)}
      />
    </>
  );
}
