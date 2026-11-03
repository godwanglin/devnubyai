"use client";

import React, { useState } from "react";
import { History, RotateCcw } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/providers/toast-provider";
import { ResetCreditsModal } from "./reset-credits-modal";
import { ConfirmDialog } from "./confirm-dialog";
import type { ProviderQuotaResult } from "@/lib/oauth/quota";

interface ResetCreditsControlProps {
  providerId: string;
  connectionId: string;
  accountLabel: string;
  availableCount: number;
  onQuotaUpdated: (quota: ProviderQuotaResult | null) => void;
}

/** OpenAI and Claude account controls: reset-credit badge, history modal, and the irreversible "use credit" action. */
export function ResetCreditsControl({
  providerId,
  connectionId,
  accountLabel,
  availableCount,
  onQuotaUpdated,
}: ResetCreditsControlProps) {
  const { toast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [consuming, setConsuming] = useState(false);

  const isClaude = providerId === "claude";
  const creditUnit = isClaude ? "limit reset" : "reset credit";

  async function consume() {
    setConsuming(true);
    try {
      const res = await fetch(
        `/api/v1/admin/gateway/providers/${providerId}/connections/${connectionId}/reset-credits`,
        { method: "POST", credentials: "same-origin" }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || `Gagal menggunakan ${creditUnit}`);
      onQuotaUpdated((json.data?.quota as ProviderQuotaResult | null) ?? null);
      toast(isClaude ? "Claude limit reset berhasil dipakai, kuota sudah direset" : "Reset credit dipakai, limit akun sudah direset");
      setConfirmOpen(false);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : `Gagal menggunakan ${creditUnit}`);
    } finally {
      setConsuming(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-1">
        <Tooltip content={isClaude ? "Lihat ketersediaan & info limit reset Claude" : "Lihat ketersediaan & riwayat reset credits"}>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)] hover:text-[var(--ink)] cursor-pointer"
          >
            <History className="w-3 h-3" />
            <span>{availableCount} {creditUnit}</span>
          </button>
        </Tooltip>
        <Tooltip content={availableCount > 0 ? `Gunakan 1 ${creditUnit}` : `Tidak ada ${creditUnit}`}>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={availableCount <= 0 || consuming}
            className="p-1 rounded text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            aria-label={`Use ${creditUnit}`}
          >
            <RotateCcw className={`w-3 h-3 ${consuming ? "animate-spin" : ""}`} />
          </button>
        </Tooltip>
      </div>

      {modalOpen && (
        <ResetCreditsModal
          providerId={providerId}
          connectionId={connectionId}
          accountLabel={accountLabel}
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          onRequestUseCredit={() => setConfirmOpen(true)}
        />
      )}

      {confirmOpen && (
        <ConfirmDialog
          isOpen={confirmOpen}
          title={isClaude ? "Gunakan Claude Limit Reset" : "Gunakan Reset Credit"}
          description={
            isClaude
              ? `1 limit reset akan dipakai untuk mereset rate limit (5-hour session & 7-day weekly) akun "${accountLabel}". Aksi ini langsung diterapkan dan tidak bisa dibatalkan. Sisa: ${availableCount}.`
              : `1 reset credit akan dipakai untuk mereset rate limit akun "${accountLabel}". Aksi ini tidak bisa dibatalkan. Sisa kredit: ${availableCount}.`
          }
          confirmLabel={isClaude ? "Reset Limit Sekarang" : "Gunakan Kredit"}
          busy={consuming}
          onConfirm={consume}
          onClose={() => {
            if (!consuming) setConfirmOpen(false);
          }}
        />
      )}
    </>
  );
}
