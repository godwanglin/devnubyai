"use client";

import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, Download, Loader2 } from "lucide-react";
import {
  ImagePreviewModal,
  type PreviewImageTarget,
} from "@/components/modals/image-preview-modal";
import { Tooltip } from "@/components/ui/tooltip";
import {
  GENERATED_FILES_TOOL_NAMES,
  isHelperSkillArtifactName,
  isScratchFileName,
} from "@/lib/chat/turn-recovery";
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
import { generatedImageUrl } from "./tool-visuals";

/** Tools whose output is a session file, rendered as a card under the reply. */
const FILE_TOOLS = new Set([
  "write_file",
  "edit_file",
  "create_document",
  "create_spreadsheet",
  "create_presentation",
  "generate_image",
  "run_skill_script",
  "exec_command",
]);

/** Running-state label per tool; keys match the ones in tool-activity.tsx. */
const RUNNING_LABEL_KEY: Record<string, string> = {
  edit_file: "message.toolEditFile",
  create_document: "message.toolCreateDocument",
  create_spreadsheet: "message.toolCreateSpreadsheet",
  create_presentation: "message.toolCreatePresentation",
  generate_image: "message.toolGenerateImage",
};

export interface TurnGeneratedFilesProps {
  tools?: ToolActivity[];
  chatId?: string;
}

export function TurnGeneratedFiles({ tools, chatId }: TurnGeneratedFilesProps) {
  const { t } = useI18n();
  const [previewImage, setPreviewImage] = useState<PreviewImageTarget | null>(null);

  const fileTools = React.useMemo(() => {
    const rawList = (tools ?? []).filter(
      (tool) => FILE_TOOLS.has(tool.name) && tool.state !== "error"
    );

    const allTurnFilenames: string[] = [];
    let lastDocSkillToolIdx = -1;

    for (let tIdx = 0; tIdx < rawList.length; tIdx++) {
      const tool = rawList[tIdx];
      if (GENERATED_FILES_TOOL_NAMES.has(tool.name)) {
        const outObj =
          tool.output && typeof tool.output === "object"
            ? (tool.output as Record<string, unknown>)
            : {};
        const dataObj =
          outObj.data && typeof outObj.data === "object"
            ? (outObj.data as Record<string, unknown>)
            : outObj;
        const genFiles = Array.isArray(dataObj.generatedFiles)
          ? (dataObj.generatedFiles as Array<Record<string, unknown>>)
          : [];
        for (const gf of genFiles) {
          const fn = String(gf.displayName || gf.filename || "");
          if (fn) {
            allTurnFilenames.push(fn);
            if (/\.(?:pdf|docx|dotx|xlsx|xlsm|pptx|potx)$/i.test(fn) && !isScratchFileName(fn)) {
              lastDocSkillToolIdx = tIdx;
            }
          }
        }
      }
    }

    // Expand `run_skill_script` / `exec_command` generatedFiles into individual file items,
    // hiding intermediate modular build files from earlier steps in the same turn.
    const list: ToolActivity[] = [];
    for (let tIdx = 0; tIdx < rawList.length; tIdx++) {
      const tool = rawList[tIdx];
      if (GENERATED_FILES_TOOL_NAMES.has(tool.name)) {
        const outObj =
          tool.output && typeof tool.output === "object"
            ? (tool.output as Record<string, unknown>)
            : {};
        const dataObj =
          outObj.data && typeof outObj.data === "object"
            ? (outObj.data as Record<string, unknown>)
            : outObj;
        const genFiles = Array.isArray(dataObj.generatedFiles)
          ? (dataObj.generatedFiles as Array<Record<string, unknown>>)
          : [];
        for (let idx = 0; idx < genFiles.length; idx++) {
          const gf = genFiles[idx];
          const fname = String(gf.displayName || gf.filename || "");
          if (!fname || isHelperSkillArtifactName(fname, allTurnFilenames)) continue;
          // If a later `run_skill_script` in this turn produced the final merged document,
          // hide raw/partial documents produced by earlier `run_skill_script` calls.
          if (
            lastDocSkillToolIdx >= 0 &&
            tIdx < lastDocSkillToolIdx &&
            /\.(?:pdf|docx|dotx|xlsx|xlsm|pptx|potx)$/i.test(fname)
          ) {
            continue;
          }
          list.push({
            ...tool,
            id: String(gf.id || `${tool.id}-gf-${idx}`),
            output: gf,
          });
        }
      } else {
        list.push(tool);
      }
    }
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
      // While arguments are just starting to stream, wait until filename is parsed so we never flash "document.txt"
      if (tool.state === "streaming" && !outObj.filename && !inObj.filename) {
        continue;
      }
      // Working files (`_buat_data.py`, `_cek_preview.png`) stay out of the chat
      const shownName = String(outObj.displayName || outObj.filename || inObj.filename || "");
      if (shownName && isScratchFileName(shownName)) {
        continue;
      }
      const key = String(outObj.id || outObj.filename || inObj.filename || tool.id);
      if (!seen.has(key)) {
        seen.add(key);
        result.unshift(tool);
      }
    }
    return result;
  }, [tools]);

  // Track which tool IDs have already been completed/notified.
  // Seeded on initial mount with any tools that were ALREADY completed in history
  // so opening an existing chat never spams /api/v1/chats/:id/files.
  const notifiedCompletedIdsRef = useRef<Set<string> | null>(null);
  if (notifiedCompletedIdsRef.current === null) {
    notifiedCompletedIdsRef.current = new Set(
      fileTools.filter((t) => t.state === "completed").map((t) => t.id)
    );
  }

  useEffect(() => {
    if (typeof window === "undefined" || !notifiedCompletedIdsRef.current) return;

    const newlyCompleted = fileTools.filter(
      (tool) =>
        tool.state === "completed" && !notifiedCompletedIdsRef.current!.has(tool.id)
    );

    if (newlyCompleted.length === 0) return;

    for (const tool of newlyCompleted) {
      notifiedCompletedIdsRef.current.add(tool.id);
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

    window.dispatchEvent(new CustomEvent("devnuby:files-updated"));
  }, [fileTools]);

  // Completed generated images are already shown inline (ToolVisualGallery); skip their card.
  const cardTools = fileTools.filter((tool) => !generatedImageUrl(tool, chatId));
  if (cardTools.length === 0) return null;

  return (
    <>
      <div className="mt-3.5 space-y-2">
        {cardTools.map((tool) => (
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
        : kind === "pptx"
          ? t("chatFiles.kindPresentation")
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
              ? t(RUNNING_LABEL_KEY[tool.name] ?? "message.toolWriteFile", { target: displayName })
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
