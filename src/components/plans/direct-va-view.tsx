"use client";

import React, { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n-provider";

export interface DirectVaResult {
  virtualAccountNumber?: string;
  paymentCode?: string;
  invoiceNumber: string;
  amount: number;
  expiredDate?: string;
  bank: string;
  howToPayPage?: string;
}

interface DirectVaViewProps {
  vaResult: DirectVaResult;
  formatRupiah: (val: number) => string;
  onClose: () => void;
}

export function DirectVaView({ vaResult, formatRupiah, onClose }: DirectVaViewProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopyVa = () => {
    const code = vaResult.virtualAccountNumber || vaResult.paymentCode;
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-5 py-1">
      <div className="p-4 rounded-[12px] bg-[var(--panel-elevated)] border border-[var(--border)] text-center space-y-3">
        <span className="text-xs uppercase font-semibold text-[var(--muted)] tracking-wider">
          Nomor Virtual Account ({vaResult.bank.toUpperCase()})
        </span>
        <div className="flex items-center justify-center gap-3">
          <span className="text-2xl font-mono font-bold text-[var(--ink)] tracking-wider select-all">
            {vaResult.virtualAccountNumber || vaResult.paymentCode}
          </span>
          <button
            type="button"
            onClick={handleCopyVa}
            className="p-1.5 rounded-[6px] hover:bg-[var(--hover)] text-[var(--muted)] hover:text-[var(--ink)] transition-colors cursor-pointer"
            title={t("plans.copy")}
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
        {copied && <p className="text-[11px] text-emerald-400 font-medium">{t("plans.copied")}</p>}
        {vaResult.howToPayPage && (
          <div className="pt-1">
            <a
              href={vaResult.howToPayPage}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline"
            >
              <span>Lihat Petunjuk Pembayaran</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        )}
      </div>

      <div className="space-y-2 text-xs text-[var(--muted)]">
        <div className="flex justify-between py-1 border-b border-[var(--border)]">
          <span>Nomor Invoice</span>
          <span className="font-mono text-[var(--ink)]">{vaResult.invoiceNumber}</span>
        </div>
        <div className="flex justify-between py-1 border-b border-[var(--border)]">
          <span>Total Tagihan</span>
          <span className="font-semibold text-[var(--ink)]">{formatRupiah(vaResult.amount)}</span>
        </div>
        {vaResult.expiredDate && (
          <div className="flex justify-between py-1 border-b border-[var(--border)]">
            <span>{t("plans.expiryTime")}</span>
            <span className="text-amber-400 font-medium">
              {new Date(vaResult.expiredDate).toLocaleString("id-ID")}
            </span>
          </div>
        )}
      </div>

      <p className="text-xs text-[var(--muted)] bg-white/[0.03] p-3 rounded-[8px] border border-white/5">
        {t("plans.vaInstructions")}
      </p>

      <Button variant="primary" className="w-full text-xs" onClick={onClose}>
        Selesai
      </Button>
    </div>
  );
}
