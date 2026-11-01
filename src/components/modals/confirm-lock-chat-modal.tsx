"use client";

import React from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n-provider";

export interface ConfirmLockChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmLockChatModal({
  isOpen,
  onClose,
  onConfirm,
}: ConfirmLockChatModalProps) {
  const { t } = useI18n();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("lockChat.confirmTitle")}
      maxWidth="sm"
    >
      <div className="space-y-5 pt-1">
        <p className="text-xs text-[var(--muted)] leading-relaxed">
          {t("lockChat.confirmBody")}
        </p>

        <div className="flex items-center justify-end gap-2.5 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="rounded-[10px] text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--hover)] px-3.5 h-8"
          >
            {t("chatModals.cancel")}
          </Button>

          <button
            type="button"
            onClick={() => {
              onClose();
              onConfirm();
            }}
            className="rounded-full text-xs font-semibold px-4 h-8 bg-white text-black hover:bg-white/90 active:scale-[0.98] transition-all cursor-pointer shadow-xs select-none"
          >
            {t("lockChat.confirmButton")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
