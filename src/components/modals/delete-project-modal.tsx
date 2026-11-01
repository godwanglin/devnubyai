"use client";

import React, { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n-provider";
import { Loader2 } from "lucide-react";

export interface DeleteProjectModalProps {
  isOpen: boolean;
  projectName: string;
  onClose: () => void;
  onConfirm: (cascade: boolean) => Promise<void | boolean>;
}

export function DeleteProjectModal({
  isOpen,
  projectName,
  onClose,
  onConfirm,
}: DeleteProjectModalProps) {
  const { t } = useI18n();
  const [cascade, setCascade] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleConfirm() {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await onConfirm(cascade);
      onClose();
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("projects.deleteProjectTitle")}
      maxWidth="sm"
    >
      <div className="space-y-4">
        <p className="text-xs text-[var(--muted)] leading-relaxed">
          {t("projects.deleteProjectDesc")} <strong>{projectName}</strong>
        </p>

        <div className="p-3 rounded-[10px] bg-[var(--panel-elevated)] border border-[var(--border)] space-y-2">
          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={cascade}
              onChange={(e) => setCascade(e.target.checked)}
              disabled={isDeleting}
              className="mt-0.5 rounded border-[var(--border)] text-[var(--accent)] focus:ring-0"
            />
            <span className="text-xs font-medium text-[var(--ink)]">
              {t("projects.deleteCascadeCheckbox")}
            </span>
          </label>
          <p className="text-[11px] text-[var(--muted)] pl-6 leading-tight">
            {t("projects.deleteSafeNote")}
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isDeleting}
            className="rounded-[8px] text-xs h-8"
          >
            Batal
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={handleConfirm}
            disabled={isDeleting}
            className="rounded-[8px] text-xs h-8 bg-red-600/20 text-red-400 hover:bg-red-600/30"
          >
            {isDeleting ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Menghapus...</span>
              </span>
            ) : (
              t("projects.deleteProject")
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
