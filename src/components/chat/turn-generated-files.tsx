"use client";

import React, { useEffect, useState } from "react";
import { AlertCircle, Download, Loader2 } from "lucide-react";
import {
  ImagePreviewModal,
  type PreviewImageTarget,
} from "@/components/modals/image-preview-modal";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import {
  classifyPreviewKind,
  formatDisplayFilename,
  formatFileSize,
  getExtensionLabel,
  getMimeTypeForFilename,
  isImageMimeType,
} from "@/lib/files/policy";
import {
  AI_FILE_UPDATED_EVENT,
  type AIFileUpdatedPayload,
  openFileInRightPanel,
  withCacheBuster,
} from "@/lib/files/preview-events";
import { useI18n } from "@/providers/i18n-provider";
import type { ToolActivity } from "@/types";
import { renderSessionFileIcon } from "./chat-files-panel";

export interface TurnGeneratedFilesProps {
  tools?: ToolActivity[];
  chatId?: string;
}

export function TurnGeneratedFiles({ tools, chatId }: TurnGeneratedFilesProps) {
  const { t } = useI18n();
  const [previewImage, setPreviewImage] = useState<PreviewImageTarget | null>(null);

  const fileTools = React.useMemo(() => {
    const list = (tools ?? []).filter(
      (tool) =>
        (tool.name === "write_file" || tool.name === "edit_file") &&
        tool.state !== "error"
    );
    // Deduplicate by target filename or file id (keep the latest state)
    const seen = new Set<string>();
    const result: ToolActivity[] = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const tool = list[i];
      const inObj =
        tool.input && typeof tool.input === "object"
          ? (tool.input as Record<string, unknown>)
          : {};
      const outObj =
        tool.output && typeof tool.output === "object"
          ? (tool.output as Record<string, unknown>)
          : {};
      const key = String(outObj.id || outObj.filename || inObj.filename || tool.id);
      if (!seen.has(key)) {
        seen.add(key);
        result.unshift(tool);
      }
    }
    return result;
  }, [tools]);

  const completedCount = fileTools.filter((tool) => tool.state === "completed").length;

  useEffect(() => {
    if (completedCount > 0 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("devnuby:files-updated"));
      for (const tool of fileTools) {
        if (tool.state === "completed") {
          const outObj =
            tool.output && typeof tool.output === "object"
              ? (tool.output as Record<string, unknown>)
              : {};
          const inObj =
            tool.input && typeof tool.input === "object"
              ? (tool.input as Record<string, unknown>)
              : {};
          const fileId = String(outObj.id || tool.id || "");
          const filename = String(outObj.filename || inObj.filename || "");
          if (fileId || filename) {
            window.dispatchEvent(
              new CustomEvent<AIFileUpdatedPayload>(AI_FILE_UPDATED_EVENT, {
                detail: {
                  fileId,
                  filename,
                  reason: "ai-edit",
                },
              })
            );
          }
        }
      }
    }
  }, [completedCount, fileTools]);

  if (fileTools.length === 0) return null;

  return (
    <>
      <div className="mt-3.5 space-y-2">
        {fileTools.map((tool) => (
          <GeneratedFileArtifactCard
            key={tool.id}
            tool={tool}
            chatId={chatId}
            t={t}
            onPreviewImage={setPreviewImage}
          />
        ))}
      </div>

      <ImagePreviewModal
        image={previewImage}
        onClose={() => setPreviewImage(null)}
      />
    </>
  );
}

function GeneratedFileArtifactCard({
  tool,
  chatId,
  t,
  onPreviewImage,
}: {
  tool: ToolActivity;
  chatId?: string;
  t: (key: string, params?: Record<string, string | number>) => string;
  onPreviewImage: (target: PreviewImageTarget) => void;
}) {
  const isRunning = tool.state === "running" || tool.state === "streaming";
  const isError = tool.state === "error";

  const inObj =
    tool.input && typeof tool.input === "object"
      ? (tool.input as Record<string, unknown>)
      : {};
  const outObj =
    tool.output && typeof tool.output === "object"
      ? (tool.output as Record<string, unknown>)
      : {};

  const rawFilename = String(outObj.filename || inObj.filename || "document.txt");
  const displayName = String(
    outObj.displayName || formatDisplayFilename(rawFilename) || rawFilename
  );
  const extension = getExtensionLabel(displayName);
  const mimeType = String(outObj.mimeType || getMimeTypeForFilename(displayName));
  const sizeBytes = typeof outObj.sizeBytes === "number" ? outObj.sizeBytes : 0;
  const fileId = typeof outObj.id === "string" ? outObj.id : tool.id;
  const rawUrl = typeof outObj.url === "string" ? outObj.url : "";
  const resolvedUrl = rawUrl.startsWith("/api/v1/")
    ? rawUrl
    : chatId && typeof outObj.id === "string"
      ? `/api/v1/chats/${chatId}/files/${outObj.id}`
      : "";

  const isImg = isImageMimeType(mimeType);
  const kind = classifyPreviewKind(displayName || extension, mimeType);
  const categoryLabel =
    kind === "html"
      ? t("chatFiles.kindWeb")
      : kind === "spreadsheet"
        ? t("chatFiles.kindSpreadsheet")
        : kind === "code" || kind === "json" || kind === "mermaid" || kind === "svg"
          ? t("chatFiles.kindCode")
          : t("chatFiles.kindDocument");

  const canOpen = !isRunning && !isError && Boolean(resolvedUrl);

  function handleOpen() {
    if (!canOpen) return;
    const freshUrl = withCacheBuster(resolvedUrl);
    if (isImg || kind === "image") {
      onPreviewImage({ url: freshUrl, title: displayName });
      return;
    }
    openFileInRightPanel({
      id: fileId,
      filename: rawFilename,
      displayName,
      extension,
      mimeType,
      sizeBytes,
      source: "tool",
      isImage: false,
      url: freshUrl,
    });
  }

  return (
    <div
      role={canOpen ? "button" : undefined}
      tabIndex={canOpen ? 0 : undefined}
      onClick={canOpen ? handleOpen : undefined}
      onKeyDown={(e) => {
        if (canOpen && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          handleOpen();
        }
      }}
      className={cn(
        "group/file flex items-center justify-between gap-3 w-full max-w-[430px] px-3.5 py-2.5 rounded-[12px] border border-[var(--border)] bg-[var(--panel-elevated)] select-none transition-colors",
        canOpen && "hover:bg-[var(--hover)] cursor-pointer"
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="grid place-items-center w-9 h-9 rounded-[8px] bg-[var(--accent-soft)] border border-[var(--border)] shrink-0">
          {isRunning ? (
            <Loader2 className="w-4 h-4 animate-spin text-[var(--muted)]" />
          ) : isError ? (
            <AlertCircle className="w-4 h-4 text-red-400/90" />
          ) : (
            renderSessionFileIcon({
              extension,
              isImage: isImg,
              mimeType,
            })
          )}
        </span>

        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold text-[var(--ink)] truncate">
            {displayName}
          </p>
          <p className="text-[12px] text-[var(--muted)] truncate">
            {isRunning
              ? tool.name === "edit_file"
                ? t("chat.toolEditFile", { target: displayName }) || t("message.toolWriteFile", { target: displayName })
                : t("message.toolWriteFile", { target: displayName })
              : isError
                ? tool.error || t("message.toolFailed", { tool: tool.name })
                : `${categoryLabel} · ${extension.toUpperCase()}${sizeBytes ? ` · ${formatFileSize(sizeBytes)}` : ""}`}
          </p>
        </div>
      </div>

      {canOpen ? (
        <Tooltip content={t("chatFiles.download")} side="top" align="end">
          <a
            href={resolvedUrl}
            download={displayName}
            onClick={(e) => e.stopPropagation()}
            className="grid place-items-center w-7 h-7 rounded-[6px] text-[var(--muted)] hover:bg-[var(--panel)] hover:text-[var(--ink)] opacity-80 group-hover/file:opacity-100 transition-all shrink-0"
            aria-label={t("chatFiles.download")}
          >
            <Download className="w-3.5 h-3.5" />
          </a>
        </Tooltip>
      ) : null}
    </div>
  );
}
