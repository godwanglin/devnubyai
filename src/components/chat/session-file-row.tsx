"use client";

import React from "react";
import { BookOpen, Download, FileCode, FileText, Globe, Image as ImageIcon } from "lucide-react";
import { FaRegFileExcel, FaRegFilePdf, FaRegFilePowerpoint, FaRegFileWord } from "react-icons/fa6";
import { Tooltip } from "@/components/ui/tooltip";
import { classifyPreviewKind, formatFileSize } from "@/lib/files/policy";
import type { SessionFileItem } from "@/types";

/** File-type icon used by the files panel, file cards and the live view. */
export function renderSessionFileIcon(
  file: Pick<SessionFileItem, "extension" | "isImage" | "mimeType">
) {
  const ext = (file.extension || "").toLowerCase().replace(/^\./, "");
  const kind = classifyPreviewKind(file.extension, file.mimeType);
  if (file.isImage || kind === "image" || kind === "svg") {
    return <ImageIcon className="w-4 h-4 text-[var(--muted)] shrink-0" />;
  }
  if (kind === "pdf" || ext === "pdf") {
    return <FaRegFilePdf className="w-4 h-4 text-[var(--muted)] shrink-0" />;
  }
  if (kind === "docx" || ext === "docx" || ext === "doc" || ext === "dotx") {
    return <FaRegFileWord className="w-4 h-4 text-[var(--muted)] shrink-0" />;
  }
  if (kind === "spreadsheet" || ext === "xlsx" || ext === "xls" || ext === "xlsm") {
    return <FaRegFileExcel className="w-4 h-4 text-[var(--muted)] shrink-0" />;
  }
  if (kind === "pptx" || ext === "pptx" || ext === "ppt" || ext === "potx") {
    return <FaRegFilePowerpoint className="w-4 h-4 text-[var(--muted)] shrink-0" />;
  }
  if (kind === "html") {
    return <Globe className="w-4 h-4 text-[var(--muted)] shrink-0" />;
  }
  if (kind === "epub") {
    return <BookOpen className="w-4 h-4 text-[var(--muted)] shrink-0" />;
  }
  if (kind === "code" || kind === "json" || kind === "mermaid") {
    return <FileCode className="w-4 h-4 text-[var(--muted)] shrink-0" />;
  }
  return <FileText className="w-4 h-4 text-[var(--muted)] shrink-0" />;
}

/** One row of the files panel list: icon, name, type and size, download button. */
export function SessionFileRow({
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
