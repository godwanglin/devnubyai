"use client";

import React from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n-provider";
import type { SanitizedCatalogModelDto } from "@/lib/catalog-models/admin-service";

interface DeleteCatalogModalProps {
  model: SanitizedCatalogModelDto | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  loading: boolean;
}

export function DeleteCatalogModal({
  model,
  onClose,
  onConfirm,
  loading,
}: DeleteCatalogModalProps) {
  const { t } = useI18n();

  return (
    <Modal
      isOpen={!!model}
      onClose={onClose}
      title={t("admin.catalog.deleteConfirmTitle")}
      maxWidth="md"
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--muted)]">
          {t("admin.catalog.deleteConfirmDesc", { name: model?.displayName ?? "" })}
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            {t("admin.catalog.cancel")}
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm} disabled={loading}>
            {loading ? "..." : t("admin.catalog.delete")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
