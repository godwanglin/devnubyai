"use client";

import React, { useState } from "react";
import {
  Archive,
  BookOpen,
  Download,
  Eye,
  FileCode,
  FileText,
  Folder,
  Globe,
  Image as ImageIcon,
  MessageSquare,
  MoreHorizontal,
  Shapes,
  Upload,
} from "lucide-react";
import { FaRegFileExcel, FaRegFilePdf, FaRegFilePowerpoint, FaRegFileWord } from "react-icons/fa6";
import { Popover } from "@/components/ui/popover";
import { DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
import { classifyPreviewKind, formatFileSize } from "@/lib/files/policy";
import { useI18n } from "@/providers/i18n-provider";
import { cn } from "@/lib/cn";
import type { LibraryFileDto } from "@/lib/library/types";
import { fileTone, formatDateTime, formatShortDate } from "./library-utils";

export interface LibraryFileActions {
  onOpen: (file: LibraryFileDto) => void;
  onOpenChat: (file: LibraryFileDto) => void;
}

/** File-type icon at any size, coloured by the caller */
export function LibraryFileIcon({
  file,
  className,
}: {
  file: Pick<LibraryFileDto, "extension" | "mimeType" | "isImage">;
  className?: string;
}) {
  const ext = file.extension.toLowerCase();
  const kind = classifyPreviewKind(ext, file.mimeType);
  const cls = cn("shrink-0", className);
  if (file.isImage || kind === "image" || kind === "svg") return <ImageIcon className={cls} />;
  if (kind === "pdf") return <FaRegFilePdf className={cls} />;
  if (kind === "docx" || kind === "doc" || ext === "dotx") return <FaRegFileWord className={cls} />;
  if (kind === "spreadsheet" || ext === "xlsm") return <FaRegFileExcel className={cls} />;
  if (kind === "pptx" || ext === "ppt" || ext === "potx") return <FaRegFilePowerpoint className={cls} />;
  if (kind === "html") return <Globe className={cls} />;
  if (kind === "epub") return <BookOpen className={cls} />;
  if (kind === "code" || kind === "json" || kind === "mermaid") return <FileCode className={cls} />;
  return <FileText className={cls} />;
}

function downloadFile(file: LibraryFileDto) {
  const a = document.createElement("a");
  a.href = file.url;
  a.download = file.displayName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function SourceBadge({ source, compact = false }: { source: LibraryFileDto["source"]; compact?: boolean }) {
  const { t } = useI18n();
  const generated = source === "generated";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium shrink-0",
        compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[10.5px]",
        generated
          ? "bg-[var(--accent)] text-[var(--accent-text)]"
          : "bg-[var(--panel)]/90 text-[var(--muted)] border border-[var(--border)] backdrop-blur-sm"
      )}
    >
      {generated ? <Shapes className="w-2.5 h-2.5" /> : <Upload className="w-2.5 h-2.5" />}
      {generated ? t("library.badgeGenerated") : t("library.badgeUploaded")}
    </span>
  );
}

function ChatOrigin({ file, onOpenChat }: { file: LibraryFileDto; onOpenChat: LibraryFileActions["onOpenChat"] }) {
  const { t } = useI18n();
  const label = `${file.chat.projectName ? `${file.chat.projectName} / ` : ""}${file.chat.title}`;
  return (
    // A plain block button so the chat name can shrink and end in "..."
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpenChat(file);
      }}
      title={`${t("library.openChat")}: ${label}`}
      className="flex w-full items-center gap-1.5 min-w-0 overflow-hidden text-left text-[11.5px] text-[var(--muted)] hover:text-[var(--ink)] transition-colors cursor-pointer"
    >
        {file.chat.projectName ? (
          <Folder className="w-3 h-3 shrink-0" />
        ) : (
          <MessageSquare className="w-3 h-3 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {file.chat.isArchived && <Archive className="w-3 h-3 shrink-0 text-[var(--placeholder)]" />}
    </button>
  );
}

function FileMenu({
  file,
  actions,
  triggerClassName,
}: {
  file: LibraryFileDto;
  actions: LibraryFileActions;
  triggerClassName?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    // Stops the click here (not on the trigger button, which the Popover must still
    // see) so opening the menu doesn't also open the file underneath
    <div className="inline-flex" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
    <Popover
      isOpen={open}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      className="w-[200px]"
      trigger={
        <button
          type="button"
          aria-label={t("library.moreActions")}
          className={cn(
            "grid place-items-center w-8 h-8 rounded-[8px] text-[var(--muted)] hover:text-[var(--ink)] transition-colors cursor-pointer",
            triggerClassName
          )}
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      }
    >
      <div className="space-y-0.5" onClick={(e) => e.stopPropagation()}>
        <DropdownItem
          icon={<Eye className="w-3.5 h-3.5" />}
          onClick={() => {
            setOpen(false);
            actions.onOpen(file);
          }}
        >
          {t("library.preview")}
        </DropdownItem>
        <DropdownItem
          icon={<MessageSquare className="w-3.5 h-3.5" />}
          onClick={() => {
            setOpen(false);
            actions.onOpenChat(file);
          }}
        >
          {t("library.openChat")}
        </DropdownItem>
        <DropdownSeparator />
        <DropdownItem
          icon={<Download className="w-3.5 h-3.5" />}
          onClick={() => {
            setOpen(false);
            downloadFile(file);
          }}
        >
          {t("library.download")}
        </DropdownItem>
      </div>
    </Popover>
    </div>
  );
}

function handleCardKey(e: React.KeyboardEvent, run: () => void) {
  if (e.target !== e.currentTarget) return;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    run();
  }
}

/** Grid card: a large preview tile (the image itself, or the file type), name and origin */
export function LibraryFileCard({ file, actions }: { file: LibraryFileDto; actions: LibraryFileActions }) {
  const { locale } = useI18n();
  const tone = fileTone(file);
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = file.isImage && !imageFailed;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => actions.onOpen(file)}
      onKeyDown={(e) => handleCardKey(e, () => actions.onOpen(file))}
      className="group relative flex flex-col min-w-0 rounded-[14px] border border-[var(--border)] bg-[var(--panel)] overflow-hidden cursor-pointer transition-[border-color,box-shadow] duration-200 ease-[var(--ease-out)] hover:shadow-[0_12px_28px_-14px_rgba(16,24,40,0.28)] hover:border-[color-mix(in_srgb,var(--muted)_35%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
    >
      <div className={cn("relative aspect-[4/3] overflow-hidden border-b border-[var(--border)]", tone.tile)}>
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={file.url}
            alt={file.displayName}
            loading="lazy"
            decoding="async"
            onError={() => setImageFailed(true)}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 ease-[var(--ease-out)] group-hover:scale-[1.04]"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center">
            <div className="grid place-items-center w-16 h-16 rounded-[16px] bg-[var(--panel)] border border-[var(--border)] shadow-[0_6px_18px_-10px_rgba(16,24,40,0.35)] transition-transform duration-300 ease-[var(--ease-out)] group-hover:scale-105">
              <LibraryFileIcon file={file} className={cn("w-7 h-7", tone.icon)} />
            </div>
          </div>
        )}

        <div className="absolute top-2 left-2 right-2 flex items-start justify-between gap-2 pointer-events-none">
          <SourceBadge source={file.source} compact />
        </div>

        <span
          className={cn(
            "absolute bottom-2 left-2 px-1.5 py-0.5 rounded-[5px] text-[10px] font-bold uppercase tracking-wide",
            showImage ? "bg-black/55 text-white backdrop-blur-sm" : tone.badge
          )}
        >
          {file.extension}
        </span>

        <div className="absolute top-1.5 right-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity">
          <FileMenu
            file={file}
            actions={actions}
            triggerClassName="w-7 h-7 bg-[var(--panel)]/90 border border-[var(--border)] backdrop-blur-sm hover:bg-[var(--panel)]"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1 p-3 min-w-0">
        <p className="text-[13px] font-semibold text-[var(--ink)] truncate leading-snug" title={file.displayName}>
          {file.displayName}
        </p>
        <p className="text-[11.5px] text-[var(--placeholder)] truncate" title={formatDateTime(file.createdAt, locale)}>
          {formatFileSize(file.sizeBytes)} · {formatShortDate(file.createdAt, locale)}
        </p>
        <div className="pt-1 min-w-0">
          <ChatOrigin file={file} onOpenChat={actions.onOpenChat} />
        </div>
      </div>
    </div>
  );
}

/** List row: compact on phones (icon, name, meta), full columns from md up */
export function LibraryFileRow({ file, actions }: { file: LibraryFileDto; actions: LibraryFileActions }) {
  const { t, locale } = useI18n();
  const tone = fileTone(file);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => actions.onOpen(file)}
      onKeyDown={(e) => handleCardKey(e, () => actions.onOpen(file))}
      className="group grid items-center gap-3 px-2.5 sm:px-3 py-2.5 rounded-[10px] cursor-pointer transition-colors hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,2.4fr)_minmax(0,1.5fr)_84px_96px_40px]"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className={cn("relative grid place-items-center w-10 h-10 rounded-[10px] overflow-hidden shrink-0 border border-[var(--border)]", tone.tile)}>
          {file.isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={file.url} alt="" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <LibraryFileIcon file={file} className={cn("w-[18px] h-[18px]", tone.icon)} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-[13.5px] font-medium text-[var(--ink)] truncate" title={file.displayName}>
              {file.displayName}
            </p>
            <span className="hidden sm:inline-flex">
              <SourceBadge source={file.source} compact />
            </span>
          </div>
          {/* Phones: everything else folds into one meta line */}
          <p className="md:hidden text-[11.5px] text-[var(--placeholder)] truncate mt-0.5">
            <span className="uppercase font-semibold">{file.extension}</span> · {formatFileSize(file.sizeBytes)} ·{" "}
            {formatShortDate(file.createdAt, locale)}
            <span className="sm:hidden"> · {file.source === "generated" ? t("library.badgeGenerated") : t("library.badgeUploaded")}</span>
          </p>
          <div className="md:hidden mt-0.5 min-w-0">
            <ChatOrigin file={file} onOpenChat={actions.onOpenChat} />
          </div>
        </div>
      </div>

      <div className="hidden md:block min-w-0">
        <ChatOrigin file={file} onOpenChat={actions.onOpenChat} />
      </div>
      <span className="hidden md:block text-[12px] text-[var(--muted)] tabular-nums">{formatFileSize(file.sizeBytes)}</span>
      <span className="hidden md:block text-[12px] text-[var(--muted)]" title={formatDateTime(file.createdAt, locale)}>
        {formatShortDate(file.createdAt, locale)}
      </span>

      <div className="flex justify-end">
        <FileMenu
          file={file}
          actions={actions}
          triggerClassName="hover:bg-[var(--panel-elevated)] md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
        />
      </div>
    </div>
  );
}

export function LibraryCardSkeleton() {
  return (
    <div className="rounded-[14px] border border-[var(--border)] bg-[var(--panel)] overflow-hidden animate-pulse">
      <div className="aspect-[4/3] bg-[var(--hover)]" />
      <div className="p-3 space-y-2">
        <div className="h-3.5 w-3/4 rounded bg-[var(--hover)]" />
        <div className="h-3 w-1/2 rounded bg-[var(--hover)]" />
        <div className="h-3 w-2/3 rounded bg-[var(--hover)]" />
      </div>
    </div>
  );
}
