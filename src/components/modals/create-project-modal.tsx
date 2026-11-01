"use client";

import React, { useEffect, useRef, useState } from "react";
import { Folder, Lightbulb, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/providers/i18n-provider";
import { cn } from "@/lib/cn";

export interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string) => Promise<boolean | void>;
}

function CreateProjectForm({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (name: string) => Promise<boolean | void>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !isSubmitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      const ok = await onSubmit(trimmed);
      if (ok !== false) {
        onClose();
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label
          htmlFor="project-name-input"
          className="block text-xs font-medium text-[var(--muted)]"
        >
          {t("projects.newProjectName")}
        </label>

        {/* Input with Folder icon prefix inside */}
        <div className="relative flex items-center">
          <Folder className="absolute left-3 w-4 h-4 text-[var(--muted)] pointer-events-none" />
          <input
            id="project-name-input"
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("projects.projectNamePlaceholder")}
            maxLength={120}
            disabled={isSubmitting}
            className={cn(
              "w-full h-10 pl-9 pr-3.5 rounded-[var(--radius-md)] border bg-[var(--input-bg)] backdrop-blur-xs text-sm text-[var(--ink)] placeholder:text-[var(--muted)]/60 transition-[background-color,border-color] duration-150 focus:bg-[var(--input-bg-focus)] border-[var(--input-border)] focus:border-[var(--accent)]/60",
              "disabled:opacity-50 disabled:pointer-events-none"
            )}
          />
        </div>
      </div>

      {/* Info Callout Box (Gambar 3) */}
      <div className="flex items-start gap-3 p-3.5 rounded-[12px] bg-[var(--panel-elevated)] border border-[var(--border)] text-xs text-[var(--muted)] leading-relaxed">
        <Lightbulb className="w-4 h-4 shrink-0 text-[var(--placeholder)] mt-0.5" />
        <p className="flex-1">{t("projects.projectInfoCallout")}</p>
      </div>

      {/* Action Button Row */}
      <div className="flex items-center justify-end pt-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            "rounded-full font-semibold text-xs px-5 h-9 transition-all cursor-pointer select-none",
            canSubmit
              ? "bg-white text-black hover:bg-white/90 active:scale-[0.98] shadow-xs"
              : "bg-white/20 text-[var(--placeholder)] cursor-not-allowed opacity-50"
          )}
        >
          {isSubmitting ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Membuat...</span>
            </span>
          ) : (
            t("projects.createProject")
          )}
        </button>
      </div>
    </form>
  );
}

export function CreateProjectModal({
  isOpen,
  onClose,
  onSubmit,
}: CreateProjectModalProps) {
  const { t } = useI18n();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("projects.createProject")}
      maxWidth="md"
    >
      <CreateProjectForm onClose={onClose} onSubmit={onSubmit} />
    </Modal>
  );
}
