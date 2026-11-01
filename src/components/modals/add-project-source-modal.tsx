"use client";

import React, { useRef, useState } from "react";
import {
  FilePlus,
  Upload,
  ScanText,
  Loader2,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { cn } from "@/lib/cn";

export interface AddProjectSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  onSuccess?: () => void;
}

export function AddProjectSourceModal({
  isOpen,
  onClose,
  projectId,
  onSuccess,
}: AddProjectSourceModalProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [mode, setMode] = useState<"dropzone" | "paste-text">("dropzone");

  // Paste text state
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteContent, setPasteContent] = useState("");

  async function uploadFile(file: File) {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`/api/v1/projects/${projectId}/files`, {
        method: "POST",
        body: formData,
        credentials: "same-origin",
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.error?.message || "Gagal mengunggah file");
      }

      toast(t("projects.sourceAddedSuccess"));
      onSuccess?.();
      onClose();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : t("toast.actionFailed"));
    } finally {
      setIsUploading(false);
    }
  }

  async function handlePasteSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pasteContent.trim() || isUploading) return;

    setIsUploading(true);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: pasteTitle.trim() || "Catatan Teks",
          text: pasteContent.trim(),
        }),
        credentials: "same-origin",
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.error?.message || "Gagal menyimpan teks");
      }

      toast(t("projects.sourceAddedSuccess"));
      setPasteTitle("");
      setPasteContent("");
      setMode("dropzone");
      onSuccess?.();
      onClose();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : t("toast.actionFailed"));
    } finally {
      setIsUploading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      void uploadFile(files[0]);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!isUploading) {
          setMode("dropzone");
          onClose();
        }
      }}
      title={t("projects.addSourceModalTitle")}
      maxWidth="md"
    >
      <div className="space-y-4 pt-1">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) {
              void uploadFile(files[0]);
            }
          }}
        />

        {mode === "paste-text" ? (
          /* Mode 2: Tempel teks form */
          <form onSubmit={handlePasteSubmit} className="space-y-3">
            <input
              type="text"
              value={pasteTitle}
              onChange={(e) => setPasteTitle(e.target.value)}
              placeholder={t("projects.pasteTitlePlaceholder")}
              className="w-full h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--panel-elevated)] text-xs text-[var(--ink)] placeholder:text-[var(--placeholder)] outline-none focus:border-[var(--accent)]"
            />
            <textarea
              rows={6}
              value={pasteContent}
              onChange={(e) => setPasteContent(e.target.value)}
              placeholder={t("projects.pasteContentPlaceholder")}
              className="w-full p-3 rounded-[10px] border border-[var(--border)] bg-[var(--panel-elevated)] text-xs text-[var(--ink)] placeholder:text-[var(--placeholder)] outline-none focus:border-[var(--accent)] resize-none"
            />
            <div className="flex items-center justify-between pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setMode("dropzone")}
                disabled={isUploading}
                className="text-xs text-[var(--muted)] hover:text-[var(--ink)]"
              >
                {t("chatModals.cancel")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={!pasteContent.trim() || isUploading}
                className="rounded-[10px] px-4 text-xs font-semibold"
              >
                {isUploading ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Menyimpan...</span>
                  </span>
                ) : (
                  <span>{t("chatModals.save")}</span>
                )}
              </Button>
            </div>
          </form>
        ) : (
          /* Mode 1: Drag & Drop Zone (Gambar 3) */
          <>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "relative flex flex-col items-center justify-center p-12 rounded-[14px] border-2 border-dashed transition-all cursor-pointer select-none text-center min-h-[190px]",
                isDragging
                  ? "border-[var(--accent)] bg-[var(--accent)]/5 scale-[0.99]"
                  : "border-[var(--border)] bg-[var(--panel-elevated)]/40 hover:bg-[var(--panel-elevated)] hover:border-[var(--border-strong)]"
              )}
            >
              {isUploading ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="w-8 h-8 text-[var(--accent)] animate-spin" />
                  <p className="text-xs text-[var(--muted)] font-medium">
                    {t("projects.uploadingSource")}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <div className="grid place-items-center w-10 h-10 rounded-full bg-[var(--panel-elevated)] text-[var(--placeholder)]">
                    <FilePlus className="w-5 h-5" />
                  </div>
                  <p className="text-xs font-medium text-[var(--ink)]">
                    {t("projects.dragSourceHere")}
                  </p>
                </div>
              )}
            </div>

            {/* 3 Action Cards below the dropzone */}
            <div className="grid grid-cols-3 gap-2.5 pt-1">
              {/* Card 1: Unggah */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="flex flex-col items-center justify-center gap-2 p-3.5 rounded-[12px] bg-[var(--panel-elevated)] border border-[var(--border)] hover:bg-[var(--hover)] hover:border-[var(--border-strong)] transition-all cursor-pointer group select-none text-center"
              >
                <Upload className="w-4 h-4 text-[var(--muted)] group-hover:text-[var(--ink)] transition-colors" />
                <span className="text-xs font-semibold text-[var(--ink)]">
                  {t("projects.uploadSourceCard")}
                </span>
              </button>

              {/* Card 2: Tempel teks */}
              <button
                type="button"
                onClick={() => setMode("paste-text")}
                disabled={isUploading}
                className="flex flex-col items-center justify-center gap-2 p-3.5 rounded-[12px] bg-[var(--panel-elevated)] border border-[var(--border)] hover:bg-[var(--hover)] hover:border-[var(--border-strong)] transition-all cursor-pointer group select-none text-center"
              >
                <ScanText className="w-4 h-4 text-[var(--muted)] group-hover:text-[var(--ink)] transition-colors" />
                <span className="text-xs font-semibold text-[var(--ink)]">
                  {t("projects.pasteTextCard")}
                </span>
              </button>

              {/* Card 3: Slack (abaikan dlu kasi tanda segera hadir) */}
              <button
                type="button"
                onClick={() => toast(t("projects.slackComingSoon"))}
                className="flex flex-col items-center justify-center gap-2 p-3.5 rounded-[12px] bg-[var(--panel-elevated)] border border-[var(--border)] hover:bg-[var(--hover)] hover:border-[var(--border-strong)] transition-all cursor-pointer group select-none text-center relative"
              >
                {/* Slack SVG Icon */}
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#E01E5A" d="M5.04 15.24a2.52 2.52 0 1 0-2.52 2.52h2.52zm1.26 0a2.52 2.52 0 1 0 5.04 0v-5.04H6.3z" />
                  <path fill="#36C5F0" d="M8.76 5.04a2.52 2.52 0 1 0-2.52-2.52v2.52zm0 1.26a2.52 2.52 0 1 0 0 5.04h5.04V6.3z" />
                  <path fill="#2EB67D" d="M18.96 8.76a2.52 2.52 0 1 0 2.52-2.52h-2.52zm-1.26 0a2.52 2.52 0 1 0-5.04 0v5.04h5.04z" />
                  <path fill="#ECB22E" d="M15.24 18.96a2.52 2.52 0 1 0 2.52 2.52v-2.52zm0-1.26a2.52 2.52 0 1 0 0-5.04h-5.04v5.04z" />
                </svg>
                <span className="text-xs font-semibold text-[var(--ink)]">
                  Slack
                </span>
                <span className="text-[9px] font-medium text-[var(--placeholder)]">
                  ({t("projects.comingSoon")})
                </span>
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
