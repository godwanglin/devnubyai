"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Check, Copy, ExternalLink, Loader2, RefreshCw, AlertCircle } from "lucide-react";
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
  userId?: string | number | bigint;
  formatRupiah: (val: number) => string;
  onPaid?: () => void;
  onClose: () => void;
}

export function DirectVaView({
  vaResult,
  userId,
  formatRupiah,
  onPaid,
  onClose,
}: DirectVaViewProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isExpired, setIsExpired] = useState(false);

  const handleCopyVa = () => {
    const code = vaResult.virtualAccountNumber || vaResult.paymentCode;
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const checkStatus = useCallback(
    async (silent = false) => {
      if (!silent) setChecking(true);
      setStatusMessage(null);

      try {
        const userIdentifier = userId ? String(userId) : "me";
        const endpoint = `/api/v1/tracking/pym:${encodeURIComponent(userIdentifier)}:${encodeURIComponent(
          vaResult.invoiceNumber
        )}:doku`;

        const res = await fetch(endpoint, { credentials: "same-origin" });
        const json = await res.json();

        if (json?.status === "success") {
          onPaid?.();
          return true;
        } else if (json?.status === "expired") {
          setIsExpired(true);
          setStatusMessage(t("plans.expiredNotice"));
        } else if (json?.status === "failed") {
          setStatusMessage(t("plans.failedOrCancelled"));
        }
      } catch (err) {
        if (!silent) {
          setStatusMessage(
            err instanceof Error ? err.message : t("plans.checkStatusFailed")
          );
        }
      } finally {
        if (!silent) setChecking(false);
      }
      return false;
    },
    [userId, vaResult.invoiceNumber, onPaid, t]
  );

  // Auto-polling every 3.5 seconds while open and not expired
  useEffect(() => {
    if (isExpired) return;

    let active = true;
    const interval = setInterval(async () => {
      if (!active) return;
      const done = await checkStatus(true);
      if (done && active) {
        clearInterval(interval);
      }
    }, 3500);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [checkStatus, isExpired]);

  return (
    <div className="space-y-5 py-1">
      {isExpired ? (
        <div className="p-4 rounded-[12px] bg-red-500/10 border border-red-500/20 text-center space-y-2">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
          <h4 className="text-sm font-semibold text-red-400">{t("plans.expiredTitle")}</h4>
          <p className="text-xs text-[var(--muted)]">{t("plans.expiredNotice")}</p>
        </div>
      ) : (
        <div className="p-4 rounded-[12px] bg-[var(--panel-elevated)] border border-[var(--border)] text-center space-y-3">
          <span className="text-xs uppercase font-semibold text-[var(--muted)] tracking-wider">
            {t("plans.vaNumberLabel", { name: vaResult.bank.toUpperCase() })}
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
                <span>{t("plans.viewInstructions")}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2 text-xs text-[var(--muted)]">
        <div className="flex justify-between py-1 border-b border-[var(--border)]">
          <span>{t("plans.invoiceNumber")}</span>
          <span className="font-mono text-[var(--ink)]">{vaResult.invoiceNumber}</span>
        </div>
        <div className="flex justify-between py-1 border-b border-[var(--border)]">
          <span>{t("plans.totalBill")}</span>
          <span className="font-semibold text-[var(--ink)]">{formatRupiah(vaResult.amount)}</span>
        </div>
        <div className="flex justify-between py-1 border-b border-[var(--border)]">
          <span>{t("plans.expiryTime")}</span>
          <span className="text-amber-400 font-medium">
            {vaResult.expiredDate
              ? new Date(vaResult.expiredDate).toLocaleString("id-ID")
              : t("plans.oneHourFromCreation")}
          </span>
        </div>
      </div>

      {statusMessage && (
        <p className="text-xs text-amber-400 bg-amber-500/10 p-2.5 rounded-[8px] border border-amber-500/20">
          {statusMessage}
        </p>
      )}

      {!isExpired && (
        <div className="flex items-center justify-between text-[11px] text-[var(--placeholder)] px-1">
          <span className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            {t("plans.waitingPayment")}
          </span>
          <button
            type="button"
            onClick={() => void checkStatus(false)}
            disabled={checking}
            className="flex items-center gap-1 text-[var(--accent)] hover:underline cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${checking ? "animate-spin" : ""}`} />
            <span>{checking ? t("plans.checkingStatus") : t("plans.checkNow")}</span>
          </button>
        </div>
      )}

      <p className="text-xs text-[var(--muted)] bg-white/[0.03] p-3 rounded-[8px] border border-white/5">
        {t("plans.vaInstructions")} {t("plans.payWithinFlatOneHour")}
      </p>

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1 text-xs" onClick={onClose}>
          {t("plans.close")}
        </Button>
        {!isExpired && (
          <Button
            variant="primary"
            className="flex-1 text-xs"
            onClick={() => void checkStatus(false)}
            disabled={checking}
          >
            {checking ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                {t("plans.checkingStatus")}
              </>
            ) : (
              t("plans.iHavePaid")
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
