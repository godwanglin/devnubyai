"use client";

import React from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n-provider";
import type { SanitizedGatewayDto } from "@/lib/gateways/admin-service";

interface DeleteGatewayModalProps {
  gateway: SanitizedGatewayDto | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  loading?: boolean;
}

export function DeleteGatewayModal({
  gateway,
  isOpen,
  onClose,
  onConfirm,
  loading,
}: DeleteGatewayModalProps) {
  const { t } = useI18n();

  if (!gateway) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("admin.gateways.deleteConfirmTitle")}
      description={t("admin.gateways.deleteConfirmDesc", { name: gateway.name })}
      maxWidth="md"
    >
      <div className="flex items-center justify-end gap-2 mt-6">
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          {t("admin.gateways.cancel")}
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={loading}>
          {loading ? "..." : t("admin.gateways.delete")}
        </Button>
      </div>
    </Modal>
  );
}

interface SetPrimaryGatewayModalProps {
  gateway: SanitizedGatewayDto | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  loading?: boolean;
}

export function SetPrimaryGatewayModal({
  gateway,
  isOpen,
  onClose,
  onConfirm,
  loading,
}: SetPrimaryGatewayModalProps) {
  const { t } = useI18n();

  if (!gateway) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("admin.gateways.primaryConfirmTitle")}
      description={t("admin.gateways.primaryConfirmDesc", { name: gateway.name })}
      maxWidth="md"
    >
      <div className="flex items-center justify-end gap-2 mt-6">
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          {t("admin.gateways.cancel")}
        </Button>
        <Button variant="primary" onClick={onConfirm} disabled={loading}>
          {loading ? "..." : t("admin.gateways.setPrimary")}
        </Button>
      </div>
    </Modal>
  );
}
