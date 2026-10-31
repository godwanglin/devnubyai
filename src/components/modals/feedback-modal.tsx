"use client";

import React, { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n-provider";
import { cn } from "@/lib/cn";

export interface FeedbackModalProps {
  isOpen: boolean;
  loading?: boolean;
  onClose: () => void;
  onSubmit: (payload: { reason?: string; comment?: string }) => Promise<void> | void;
}

const REASON_KEYS = [
  { id: "inaccurate", labelKey: "message.feedbackReasonInaccurate" },
  { id: "ignored_instructions", labelKey: "message.feedbackReasonInstructions" },
  { id: "too_verbose", labelKey: "message.feedbackReasonVerbose" },
  { id: "bad_format", labelKey: "message.feedbackReasonFormat" },
  { id: "other", labelKey: "message.feedbackReasonOther" },
] as const;

export function FeedbackModal({
  isOpen,
  loading = false,
  onClose,
  onSubmit,
}: FeedbackModalProps) {
  const { t } = useI18n();
  const [selectedReason, setSelectedReason] = useState<string>("");
  const [comment, setComment] = useState<string>("");

  function handleClose() {
    if (loading) return;
    setSelectedReason("");
    setComment("");
    onClose();
  }

  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    await onSubmit({
      reason: selectedReason || undefined,
      comment: comment.trim() || undefined,
    });
    setSelectedReason("");
    setComment("");
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t("message.feedbackModalTitle")}
      description={t("message.feedbackModalDesc")}
      maxWidth="md"
    >
      <form onSubmit={handleFormSubmit} className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {REASON_KEYS.map((item) => {
            const active = selectedReason === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedReason(active ? "" : item.id)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer",
                  active
                    ? "bg-[var(--accent)] text-[var(--accent-text)] border-[var(--accent)]"
                    : "bg-[var(--input-bg)] text-[var(--muted)] border-[var(--input-border)] hover:text-[var(--ink)] hover:bg-[var(--hover)]"
                )}
              >
                {t(item.labelKey)}
              </button>
            );
          })}
        </div>

        <textarea
          rows={3}
          maxLength={1000}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t("message.feedbackPlaceholder")}
          className="w-full px-3.5 py-2.5 rounded-[var(--radius-md)] border border-[var(--input-border)] bg-[var(--input-bg)] backdrop-blur-xs text-sm text-[var(--ink)] placeholder:text-[var(--muted)]/70 transition-[background-color,border-color] duration-150 focus:bg-[var(--input-bg-focus)] focus:border-[var(--accent)]/60 focus:outline-none resize-none"
        />

        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClose}
            disabled={loading}
          >
            {t("message.feedbackClose")}
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={loading}>
            {t("message.feedbackSubmit")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
