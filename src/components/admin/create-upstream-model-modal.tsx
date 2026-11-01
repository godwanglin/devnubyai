"use client";

import React, { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import type { SanitizedGatewaySummaryDto } from "@/lib/upstream-models/admin-service";

type GatewayOption = Pick<SanitizedGatewaySummaryDto, "id" | "name" | "slug">;

export interface CreateUpstreamModelModalProps {
  isOpen: boolean;
  onClose: () => void;
  gateways: GatewayOption[];
  defaultGatewayId?: string;
  onCreated: () => void;
}

export function CreateUpstreamModelModal({
  isOpen,
  onClose,
  gateways,
  defaultGatewayId = "",
  onCreated,
}: CreateUpstreamModelModalProps) {
  const { t } = useI18n();
  const { toast } = useToast();

  const [gatewayId, setGatewayId] = useState(defaultGatewayId || (gateways[0]?.id ?? ""));
  const [modelKey, setModelKey] = useState("");
  const [ownedBy, setOwnedBy] = useState("");
  const [isAvailable, setIsAvailable] = useState(true);
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setGatewayId(defaultGatewayId || (gateways[0]?.id ?? ""));
      setModelKey("");
      setOwnedBy("");
      setIsAvailable(true);
    }
  }, [isOpen, defaultGatewayId, gateways]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!gatewayId) {
      toast(t("admin.upstream.selectGateway"));
      return;
    }
    if (!modelKey.trim()) {
      toast("Model Key is required");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/v1/admin/upstream-models", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gatewayId,
          modelKey: modelKey.trim(),
          ownedBy: ownedBy.trim() || undefined,
          isAvailable,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message || "Failed to create upstream model");
      }

      toast(t("admin.upstream.createSuccess"));
      onCreated();
      onClose();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Failed to create upstream model");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!loading) onClose();
      }}
      title={t("admin.upstream.createTitle")}
      description={t("admin.upstream.createDesc")}
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4 pt-1">
        {/* Gateway Select */}
        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">
            {t("admin.upstream.gateway")} <span className="text-rose-500">*</span>
          </label>
          <CustomSelect
            options={gateways.map((g) => ({
              value: g.id,
              label: g.name,
              sublabel: `(${g.slug})`,
            }))}
            value={gatewayId}
            onChange={setGatewayId}
            searchable
            disabled={loading}
          />
        </div>

        {/* Model Key */}
        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">
            {t("admin.upstream.modelKey")} <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            required
            value={modelKey}
            onChange={(e) => setModelKey(e.target.value)}
            placeholder={t("admin.upstream.modelKeyPlaceholder")}
            disabled={loading}
            className="w-full px-3 py-2 rounded-[8px] border border-[var(--border)] bg-transparent text-xs text-[var(--ink)] placeholder:text-[var(--placeholder)] focus:border-[var(--accent)] outline-none font-mono"
          />
        </div>

        {/* Owner / Vendor */}
        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">
            {t("admin.upstream.owner")}
          </label>
          <input
            type="text"
            value={ownedBy}
            onChange={(e) => setOwnedBy(e.target.value)}
            placeholder={t("admin.upstream.ownerPlaceholder")}
            disabled={loading}
            className="w-full px-3 py-2 rounded-[8px] border border-[var(--border)] bg-transparent text-xs text-[var(--ink)] placeholder:text-[var(--placeholder)] focus:border-[var(--accent)] outline-none"
          />
        </div>

        {/* Availability Toggle */}
        <div className="flex items-center justify-between p-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
          <div>
            <div className="text-xs font-medium text-[var(--ink)]">
              {t("admin.upstream.isAvailable")}
            </div>
            <div className="text-[11px] text-[var(--muted)] mt-0.5">
              {t("admin.upstream.availableDesc")}
            </div>
          </div>
          <input
            type="checkbox"
            checked={isAvailable}
            onChange={(e) => setIsAvailable(e.target.checked)}
            disabled={loading}
            className="cursor-pointer accent-[var(--accent)] w-4 h-4"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={loading}>
            {loading ? "Menyimpan..." : t("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
