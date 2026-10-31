"use client";

import React, { useRef, useState, useEffect, useCallback } from "react";
import {
  ArrowUp,
  Mic,
  Plus,
  Paperclip,
  Globe,
  Brain,
  ImageIcon,
  Check,
  X,
  FileText,
  Loader2,
  MessageSquareQuote,
} from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { Popover } from "@/components/ui/popover";
import { ModelSelector } from "./model-selector";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { cn } from "@/lib/cn";
import {
  validateUploadCandidate,
  formatFileSize,
  MIME_BY_EXTENSION,
} from "@/lib/files/policy";
import type { EditRequestChip } from "@/lib/files/preview-events";
import type { MessageAttachment, ReasoningLevel } from "@/types";

interface PendingAttachment {
  localId: string;
  file: File;
  name: string;
  size: number;
  isImage: boolean;
  previewUrl?: string;
  isUploading: boolean;
  uploadedAttachment?: MessageAttachment;
  error?: string;
}

interface ComposerProps {
  chatId?: string | null;
  onSend: (
    text: string,
    options?: {
      webSearch?: boolean;
      extendedThinking?: boolean;
      fileIds?: string[];
      attachments?: MessageAttachment[];
      quotes?: string[];
      editChips?: EditRequestChip[];
    }
  ) => void;
  onStop?: () => void;
  disabled?: boolean;
  currentModelId: string;
  onModelChange: (modelId: string) => void;
  reasoningLevel: ReasoningLevel;
  onReasoningChange: (level: ReasoningLevel) => void;
  /** Excerpts picked via "Tanya Devnuby", sent along with the next message */
  quotes?: string[];
  onRemoveQuote?: (index: number) => void;
  /** Edit target chips picked from file previews (multi-selection) */
  editChips?: EditRequestChip[];
  onRemoveEditChip?: (chipId: string) => void;
  /** Shown just above the input, e.g. the quota banner */
  notice?: React.ReactNode;
  /** Blocks sending (e.g. quota reached) without switching to the stop button like `disabled` */
  sendBlocked?: boolean;
}

export function Composer({
  chatId,
  onSend,
  onStop,
  disabled,
  currentModelId,
  onModelChange,
  reasoningLevel,
  onReasoningChange,
  quotes = [],
  onRemoveQuote,
  editChips = [],
  onRemoveEditChip,
  notice,
  sendBlocked,
}: ComposerProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [value, setValue] = useState("");
  const [webActive, setWebActive] = useState(false);
  const [thinkingActive, setThinkingActive] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  // Opening a chat (new or existing) puts the cursor in the input right away.
  // Skipped on touch devices, where focusing would pop the on-screen keyboard
  // over the conversation.
  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    const frame = requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      // Don't steal focus from another field the user is already typing in
      const active = document.activeElement;
      if (
        active &&
        active !== document.body &&
        active !== el &&
        (active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement ||
          (active as HTMLElement).isContentEditable)
      ) {
        return;
      }
      el.focus({ preventScroll: true });
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
    return () => cancelAnimationFrame(frame);
  }, [chatId]);

  // Picking a new excerpt moves focus to the input so the user can type the question
  const quoteCount = quotes.length;
  const prevQuoteCountRef = useRef(quoteCount);
  useEffect(() => {
    if (quoteCount > prevQuoteCountRef.current) textareaRef.current?.focus();
    prevQuoteCountRef.current = quoteCount;
  }, [quoteCount]);

  // Picking a new edit chip moves focus to the input
  const editChipCount = editChips.length;
  const prevEditChipCountRef = useRef(editChipCount);
  useEffect(() => {
    if (editChipCount > prevEditChipCountRef.current) textareaRef.current?.focus();
    prevEditChipCountRef.current = editChipCount;
  }, [editChipCount]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [value]);

  // Allowed file extensions string for file picker dialog
  const allowedExtensionsString = Object.keys(MIME_BY_EXTENSION).join(",");

  /**
   * Uploads a validated file to the active chat session's storage.
   * If there is no active chat session yet, the file stays staged and is uploaded
   * once the session is provisioned on send.
   */
  const uploadFile = useCallback(
    async (pending: PendingAttachment, targetChatId: string) => {
      try {
        const formData = new FormData();
        formData.append("file", pending.file, pending.name);

        const res = await fetch(`/api/v1/chats/${targetChatId}/files`, {
          method: "POST",
          body: formData,
          credentials: "same-origin",
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson?.error?.message || "Upload failed");
        }

        const json = await res.json();
        const uploaded: MessageAttachment = {
          id: json.data.id,
          filename: json.data.filename,
          displayName: json.data.displayName || pending.name,
          mimeType: json.data.mimeType,
          sizeBytes: json.data.sizeBytes,
          isImage: json.data.isImage,
          url: json.data.url,
        };

        setAttachments((prev) =>
          prev.map((item) =>
            item.localId === pending.localId
              ? { ...item, isUploading: false, uploadedAttachment: uploaded }
              : item
          )
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to upload file";
        setAttachments((prev) =>
          prev.map((item) =>
            item.localId === pending.localId
              ? { ...item, isUploading: false, error: message }
              : item
          )
        );
        toast(message);
      }
    },
    [toast]
  );

  /**
   * Adds new files from paste, drop, or input picker, performing security check
   * and initiating upload immediately if a chatId exists.
   */
  const handleAddFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      if (fileArray.length === 0) return;

      const newPendingItems: PendingAttachment[] = [];

      for (const file of fileArray) {
        const validation = validateUploadCandidate(file);
        if (!validation.valid) {
          toast(validation.error || "File rejected");
          continue;
        }

        const localId = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const isImg = validation.isImage;
        const previewUrl = isImg ? URL.createObjectURL(file) : undefined;

        const item: PendingAttachment = {
          localId,
          file,
          name: file.name,
          size: file.size,
          isImage: isImg,
          previewUrl,
          isUploading: Boolean(chatId),
        };

        newPendingItems.push(item);

        if (chatId) {
          uploadFile(item, chatId);
        }
      }

      if (newPendingItems.length > 0) {
        setAttachments((prev) => [...prev, ...newPendingItems]);
      }
    },
    [chatId, uploadFile, toast]
  );

  /**
   * Clipboard paste listener: captures screenshots or copied files.
   */
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const filesToAdd: File[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
            // If pasted from clipboard without a distinct filename, provide a meaningful timestamped name
            let filename = file.name;
            if (!filename || filename === "image.png" || filename === "blob") {
              const now = new Date();
              const dateStr = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
              filename = `screenshot-${dateStr}.png`;
            }

            const namedFile =
              filename !== file.name
                ? new File([file], filename, { type: file.type || "image/png" })
                : file;

            filesToAdd.push(namedFile);
          }
        }
      }

      if (filesToAdd.length > 0) {
        e.preventDefault();
        handleAddFiles(filesToAdd);
      }
    },
    [handleAddFiles]
  );

  /**
   * Drag & drop handlers for attaching files directly onto composer.
   */
  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      setIsDragging(false);
      dragCounterRef.current = 0;
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleAddFiles(e.dataTransfer.files);
    }
  }

  function removeAttachment(localId: string) {
    setAttachments((prev) => {
      const item = prev.find((a) => a.localId === localId);
      if (item?.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
      }
      return prev.filter((a) => a.localId !== localId);
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    const hasAttachments = attachments.length > 0;
    const hasEditChips = editChips.length > 0;
    if ((!trimmed && !hasAttachments && !hasEditChips) || disabled || sendBlocked) return;

    // Check if any attachment is currently in flight
    const stillUploading = attachments.some((a) => a.isUploading);
    if (stillUploading) {
      toast(t("composer.uploading") || "Please wait for files to finish uploading.");
      return;
    }

    // If on initial page without a chatId, create session first to upload pending files
    let effectiveChatId = chatId;
    if (!effectiveChatId && hasAttachments) {
      try {
        const createRes = await fetch("/api/v1/chats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: trimmed.slice(0, 40).trim() || attachments[0]?.name || "New chat",
            model: currentModelId || undefined,
          }),
          credentials: "same-origin",
        });

        if (!createRes.ok) {
          throw new Error("Failed to create chat session for attachments");
        }

        const createData = await createRes.json();
        effectiveChatId = createData.data.id;
        window.history.pushState(null, "", `/c/${effectiveChatId}`);
      } catch (err: unknown) {
        toast(err instanceof Error ? err.message : "Failed to initialize chat");
        return;
      }
    }

    // Upload any un-uploaded attachments sequentially now that effectiveChatId exists
    const uploadedResults: MessageAttachment[] = [];
    const fileIds: string[] = [];

    for (const pending of attachments) {
      if (pending.uploadedAttachment) {
        uploadedResults.push(pending.uploadedAttachment);
        fileIds.push(pending.uploadedAttachment.id);
      } else if (effectiveChatId) {
        try {
          const formData = new FormData();
          formData.append("file", pending.file, pending.name);

          const res = await fetch(`/api/v1/chats/${effectiveChatId}/files`, {
            method: "POST",
            body: formData,
            credentials: "same-origin",
          });

          if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            throw new Error(errJson?.error?.message || "Upload failed");
          }

          const json = await res.json();
          const uploaded: MessageAttachment = {
            id: json.data.id,
            filename: json.data.filename,
            displayName: json.data.displayName || pending.name,
            mimeType: json.data.mimeType,
            sizeBytes: json.data.sizeBytes,
            isImage: json.data.isImage,
            url: json.data.url,
          };
          uploadedResults.push(uploaded);
          fileIds.push(uploaded.id);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Upload error";
          toast(`Failed to upload ${pending.name}: ${msg}`);
          return;
        }
      }
    }

    onSend(trimmed, {
      webSearch: webActive,
      extendedThinking: thinkingActive,
      fileIds: fileIds.length > 0 ? fileIds : undefined,
      attachments: uploadedResults.length > 0 ? uploadedResults : undefined,
      quotes: quotes.length > 0 ? quotes : undefined,
      editChips: editChips.length > 0 ? editChips : undefined,
    });

    setValue("");
    setAttachments([]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  const isSendDisabled =
    (!value.trim() && attachments.length === 0 && editChips.length === 0) ||
    disabled ||
    sendBlocked ||
    attachments.some((a) => a.isUploading);

  return (
    <div className="relative z-10 px-4 sm:px-5 pb-5 bg-gradient-to-t from-[var(--surface)] via-[var(--surface)]/80 to-transparent pointer-events-none">
      {/* Hidden file pickers */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleAddFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept={allowedExtensionsString}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleAddFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {notice ? <div className="max-w-[768px] mx-auto mb-2 pointer-events-auto">{notice}</div> : null}

      <form
        onSubmit={handleSubmit}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={cn(
          "max-w-[768px] mx-auto rounded-[16px] border border-[var(--border)] bg-[var(--panel)]",
          "shadow-sm transition-all pointer-events-auto relative",
          isDragging ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/15" : "focus-within:border-[var(--border)] focus-within:shadow-md"
        )}
      >
        {/* Drop zone overlay indicator */}
        {isDragging ? (
          <div className="absolute inset-0 z-20 rounded-[16px] bg-[var(--surface)]/90 backdrop-blur-xs flex flex-col items-center justify-center gap-1.5 pointer-events-none border-2 border-dashed border-[var(--accent)]">
            <ImageIcon className="w-6 h-6 text-[var(--accent)] animate-bounce" />
            <span className="text-xs font-semibold text-[var(--ink)]">
              {t("composer.dropFilesHere") || "Drop files to attach"}
            </span>
          </div>
        ) : null}

        {/* Selected excerpts ("Tanya Devnuby") */}
        {quotes.length > 0 ? (
          <div className="flex items-center gap-2 p-2.5 pb-1 overflow-x-auto">
            {quotes.map((quote, index) => (
              <Popover
                key={`${index}-${quote.slice(0, 16)}`}
                side="top"
                align="start"
                openOnHover
                triggerClassName="flex min-w-0 max-w-[260px] sm:max-w-[340px] shrink-0"
                className="p-3 max-w-[360px] w-[min(360px,calc(100vw-32px))] space-y-2 rounded-[12px] shadow-xl border border-[var(--border)]"
                trigger={
                  <div className="flex items-center gap-2 pl-2.5 pr-1.5 py-1.5 rounded-[10px] border-l-2 border-[var(--primary)] bg-[var(--hover)] hover:bg-[var(--surface-accent)] transition-colors cursor-pointer select-none w-full min-w-0">
                    <MessageSquareQuote className="w-3.5 h-3.5 shrink-0 text-[var(--primary)]" />
                    <span className="flex-1 min-w-0 truncate text-xs text-[var(--muted)]">
                      {quote}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveQuote?.(index);
                      }}
                      className="grid place-items-center w-5 h-5 shrink-0 rounded-full text-[var(--muted)] hover:bg-[var(--border)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                      aria-label={t("selection.removeQuote")}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                }
              >
                <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-[var(--divider)]">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--ink)]">
                    <MessageSquareQuote className="w-3.5 h-3.5 text-[var(--primary)]" />
                    {t("selection.askDevnuby") || "Kutipan"}
                  </span>
                  <span className="text-[11px] text-[var(--placeholder)]">
                    {quote.length} {t("composer.characters")}
                  </span>
                </div>
                <p className="max-h-[220px] overflow-y-auto text-xs leading-relaxed text-[var(--ink)] whitespace-pre-wrap break-words select-text pr-1">
                  &ldquo;{quote}&rdquo;
                </p>
              </Popover>
            ))}
          </div>
        ) : null}

        {/* Edit Request Chips (Multi-Selection from Previews) */}
        {editChips && editChips.length > 0 ? (
          <div className="flex items-center gap-2 p-2.5 pb-1 overflow-x-auto border-b border-[var(--border)]/60">
            {editChips.map((chip, idx) => {
              const locationLabel = chip.lineNumber
                ? chip.lineEndNumber && chip.lineEndNumber !== chip.lineNumber
                  ? `Line ${chip.lineNumber}-${chip.lineEndNumber}`
                  : `Line ${chip.lineNumber}`
                : chip.cellRange || (chip.tagName ? `<${chip.tagName}>` : "");

              return (
                <div
                  key={chip.id}
                  className="group relative flex items-center gap-2 pl-2.5 pr-2 py-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--panel)] text-[var(--ink)] shadow-xs shrink-0 max-w-[280px] sm:max-w-[340px] select-none transition-all"
                  title={`${chip.filename}${locationLabel ? ` (${locationLabel})` : ""}${chip.instruction ? `\nInstruksi: ${chip.instruction}` : ""}\n"${chip.selectedText}"`}
                >
                  <span className="grid place-items-center w-4 h-4 rounded-full bg-[var(--hover)] border border-[var(--border)] text-[10px] font-semibold text-[var(--muted)] shrink-0">
                    {idx + 1}
                  </span>

                  <div className="flex items-center gap-1.5 min-w-0 pr-4">
                    <span className="font-semibold text-[var(--ink)] text-xs truncate shrink-0 max-w-[130px]">
                      {chip.filename}
                    </span>
                    {locationLabel ? (
                      <span className="text-[11px] font-mono text-[var(--muted)] shrink-0">
                        {locationLabel}
                      </span>
                    ) : null}
                    <span className="text-[11px] text-[var(--placeholder)] truncate">
                      {chip.instruction || chip.selectedText}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => onRemoveEditChip?.(chip.id)}
                    className="absolute top-1.5 right-1.5 grid place-items-center w-4 h-4 rounded-full hover:bg-[var(--hover)] text-[var(--muted)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                    aria-label="Remove edit target"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Attachment Previews Bar */}
        {attachments.length > 0 ? (
          <div className="flex items-center gap-2 p-2.5 pb-1 overflow-x-auto border-b border-[var(--border)]/60">
            {attachments.map((item) => (
              <div
                key={item.localId}
                className={cn(
                  "relative group flex items-center gap-2 px-2.5 py-1.5 rounded-[10px] border border-[var(--border)]",
                  "bg-[var(--surface)] shrink-0 max-w-[220px] transition-all select-none",
                  item.error && "border-red-500/50 bg-red-500/5"
                )}
              >
                {item.isImage && item.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.previewUrl}
                    alt={item.name}
                    className="w-8 h-8 rounded-[6px] object-cover shrink-0 border border-[var(--border)]"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-[6px] bg-[var(--surface-accent)] grid place-items-center shrink-0 text-[var(--muted)]">
                    <FileText className="w-4 h-4" />
                  </div>
                )}

                <div className="flex flex-col min-w-0 pr-4">
                  <span className="text-xs font-medium text-[var(--ink)] truncate leading-tight">
                    {item.name}
                  </span>
                  <span className="text-[10px] text-[var(--muted)]">
                    {item.isUploading ? (
                      <span className="inline-flex items-center gap-1 text-[var(--accent)]">
                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
                        {t("composer.uploading") || "Uploading..."}
                      </span>
                    ) : item.error ? (
                      <span className="text-red-500 truncate">{item.error}</span>
                    ) : (
                      formatFileSize(item.size)
                    )}
                  </span>
                </div>

                {/* Remove button */}
                <button
                  type="button"
                  onClick={() => removeAttachment(item.localId)}
                  className="absolute top-1 right-1 grid place-items-center w-5 h-5 rounded-full bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--hover)] border border-[var(--border)] transition-colors cursor-pointer"
                  aria-label="Remove attachment"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          rows={1}
          placeholder={t("composer.inputPlaceholder")}
          className="w-full max-h-[240px] px-4 pt-3.5 pb-2 bg-transparent resize-none outline-none text-[15px] leading-relaxed text-[var(--ink)] placeholder:text-[var(--placeholder)]"
        />

        <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1">
          {/* Left Plus Popover */}
          <div className="flex items-center gap-1">
            <Popover
              side="top"
              align="start"
              className="w-[180px]"
              trigger={
                <button
                  type="button"
                  className="grid place-items-center w-7 h-7 rounded-[6px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                  aria-label={t("composer.attach")}
                >
                  <Plus className="w-4 h-4" />
                </button>
              }
            >
              <div className="space-y-0.5">
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="glass-hover flex items-center gap-2 w-full px-2.5 py-1.5 rounded-[6px] text-xs font-medium text-[var(--ink)] cursor-pointer"
                >
                  <ImageIcon className="w-3.5 h-3.5 text-[var(--muted)]" />
                  <span>{t("composer.photo")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="glass-hover flex items-center gap-2 w-full px-2.5 py-1.5 rounded-[6px] text-xs font-medium text-[var(--ink)] cursor-pointer"
                >
                  <Paperclip className="w-3.5 h-3.5 text-[var(--muted)]" />
                  <span>{t("composer.attachFile")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = !webActive;
                    setWebActive(next);
                    toast(
                      t(next ? "toast.toolActive" : "toast.toolInactive", {
                        tool: t("composer.webSearch"),
                      })
                    );
                  }}
                  className={cn(
                    "glass-hover flex items-center justify-between w-full px-2.5 py-1.5 rounded-[6px] text-xs font-medium cursor-pointer transition-colors",
                    webActive ? "text-[var(--accent)]" : "text-[var(--ink)]"
                  )}
                >
                  <span className="flex items-center gap-2">
                    <Globe className="w-3.5 h-3.5" />
                    <span>{t("composer.webSearch")}</span>
                  </span>
                  {webActive ? <Check className="w-3.5 h-3.5 stroke-[2.5]" /> : null}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = !thinkingActive;
                    setThinkingActive(next);
                    toast(
                      t(next ? "toast.toolActive" : "toast.toolInactive", {
                        tool: t("composer.extendedThinking"),
                      })
                    );
                  }}
                  className={cn(
                    "glass-hover flex items-center justify-between w-full px-2.5 py-1.5 rounded-[6px] text-xs font-medium cursor-pointer transition-colors",
                    thinkingActive ? "text-[var(--accent)]" : "text-[var(--ink)]"
                  )}
                >
                  <span className="flex items-center gap-2">
                    <Brain className="w-3.5 h-3.5" />
                    <span>{t("composer.extendedThinking")}</span>
                  </span>
                  {thinkingActive ? <Check className="w-3.5 h-3.5 stroke-[2.5]" /> : null}
                </button>
              </div>
            </Popover>
          </div>

          {/* Right Controls: Model -> Mic -> Send */}
          <div className="flex items-center gap-1 ml-auto">
            <ModelSelector
              currentModelId={currentModelId}
              onModelChange={(id) => {
                onModelChange(id);
                toast(t("toast.modelChanged", { model: id }));
              }}
              reasoningLevel={reasoningLevel}
              onReasoningChange={(lvl) => {
                onReasoningChange(lvl);
                toast(t("toast.reasoningChanged", { level: lvl }));
              }}
            />

            <button
              type="button"
              onClick={() => toast(t("toast.featureUnavailable"))}
              className="grid place-items-center w-7 h-7 rounded-[6px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
              aria-label={t("composer.voice")}
            >
              <Mic className="w-4 h-4" />
            </button>

            {disabled && onStop ? (
              <Tooltip content="Stop generation" side="top" align="end">
                <button
                  type="button"
                  onClick={onStop}
                  className="grid place-items-center w-8 h-8 rounded-[10px] text-[var(--accent-text)] bg-[var(--accent)] hover:bg-[var(--accent-hover)] active:scale-95 transition-all cursor-pointer"
                  aria-label="Stop generation"
                >
                  <span className="w-3 h-3 rounded-[2px] bg-current" />
                </button>
              </Tooltip>
            ) : (
              <Tooltip content={t("composer.enterToSend")} side="top" align="end">
                <button
                  type="submit"
                  disabled={isSendDisabled}
                  className={cn(
                    "grid place-items-center w-8 h-8 rounded-[10px] text-[var(--accent-text)] bg-[var(--accent)]",
                    "hover:bg-[var(--accent-hover)] active:scale-95 transition-all cursor-pointer",
                    "disabled:bg-[var(--border)] disabled:text-[var(--placeholder)] disabled:cursor-not-allowed disabled:active:scale-100"
                  )}
                  aria-label={t("composer.send")}
                >
                  <ArrowUp className="w-4 h-4 stroke-[2.5]" />
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      </form>

      <p className="text-center text-[11.5px] text-[var(--placeholder)] mt-2">
        {t("composer.disclaimer")}
      </p>
    </div>
  );
}
