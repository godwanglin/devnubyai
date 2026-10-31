"use client";

import React from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  variant?: "danger" | "primary";
  loading?: boolean;
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = "danger",
  loading = false,
}: ConfirmModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!loading) onClose();
      }}
      title={title}
      maxWidth="sm"
    >
      <div className="space-y-4">
        {description && (
          <p className="text-sm leading-relaxed text-[var(--muted)]">{description}</p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant === "danger" ? "danger" : "primary"}
            size="sm"
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              variant === "danger" &&
                "bg-red-500/12 border border-red-500/25 hover:bg-red-500/20 font-semibold"
            )}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
