"use client";

import React, { useState, useEffect, useCallback } from "react";
import { ExternalLink, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n-provider";

export interface CheckoutResult {
  paymentUrl: string;
  invoiceNumber: string;
  amount: number;
  paymentMethodCode?: string;
}

interface QrisCheckoutViewProps {
  checkoutResult: CheckoutResult;
  formatRupiah: (val: number) => string;
  onPaid: () => void;
  onClose: () => void;
}

export function QrisCheckoutView({
  checkoutResult,
  formatRupiah,
  onPaid,
  onClose,
}: QrisCheckoutViewProps) {
  const { t } = useI18n();
  const [checking, setChecking] = useState(false);
  const [iframeLoading, setIframeLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const checkStatus = useCallback(
    async (silent = false) => {
      if (!silent) setChecking(true);
      setErrorMessage(null);

      try {
        const res = await fetch(
          `/api/v1/payments/status?invoiceNumber=${encodeURIComponent(checkoutResult.invoiceNumber)}`,
          { credentials: "same-origin" }
        );
        const json = await res.json();

        if (res.ok && json.data?.status === "PAID") {
          onPaid();
          return true;
        }
      } catch (err) {
        if (!silent) {
          setErrorMessage(err instanceof Error ? err.message : t("plans.checkStatusFailed"));
        }
      } finally {
        if (!silent) setChecking(false);
      }
      return false;
    },
    [checkoutResult.invoiceNumber, onPaid, t]
  );

  // Auto-poll status every 4 seconds
  useEffect(() => {
    let active = true;
    const interval = setInterval(async () => {
      if (!active) return;
      const isPaid = await checkStatus(true);
      if (isPaid && active) {
        clearInterval(interval);
      }
    }, 4000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [checkStatus]);

  // Listen to postMessage from DOKU iframe
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      const allowedOrigins = [
        "https://checkout.doku.com",
        "https://jokul.doku.com",
        "https://sandbox.doku.com",
        "https://staging.doku.com",
      ];
      // Exact match: a prefix check also accepts e.g. https://checkout.doku.com.evil.tld
      if (allowedOrigins.includes(e.origin)) {
        // DOKU finished or closed modal
        checkStatus(false);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [checkStatus]);

  const iframeSrc = `${checkoutResult.paymentUrl}${
    checkoutResult.paymentUrl.includes("?") ? "&" : "?"
  }view=iframe`;

  return (
    <div className="space-y-4 py-1">
      {/* Top summary badge bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-3 rounded-[12px] bg-[var(--panel-elevated)] border border-[var(--border)] text-xs">
        <div>
          <span className="text-[10px] uppercase font-semibold text-[var(--muted)] tracking-wider block">
            {t("plans.invoiceNumber")}
          </span>
          <span className="font-mono font-medium text-[var(--ink)]">
            {checkoutResult.invoiceNumber}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-[10px] uppercase font-semibold text-[var(--muted)] tracking-wider block">
              {t("plans.totalBill")}
            </span>
            <span className="font-bold text-[var(--ink)]">
              {formatRupiah(checkoutResult.amount)}
            </span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 font-medium text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span>{t("plans.statusPending")}</span>
          </div>
        </div>
      </div>

      {/* Embedded Payment Frame */}
      <div className="relative w-full h-[480px] rounded-[12px] overflow-hidden border border-[var(--border)] bg-white shadow-inner">
        {iframeLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--panel-elevated)] z-10 space-y-2 text-center p-4">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--accent)]" />
            <p className="text-xs text-[var(--muted)]">{t("plans.loadingQrisFromGateway")}</p>
          </div>
        )}
        <iframe
          src={iframeSrc}
          className="w-full h-full border-0"
          title="DOKU QRIS Payment"
          allow="payment"
          onLoad={() => setIframeLoading(false)}
        />
      </div>

      {errorMessage && (
        <p className="text-xs text-red-400 bg-red-500/10 p-2.5 rounded-[8px] border border-red-500/20">
          {errorMessage}
        </p>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-1">
        <a
          href={checkoutResult.paymentUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
        >
          <span>{t("plans.openInNewTabHint")}</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button
            variant="outline"
            className="text-xs flex-1 sm:flex-none"
            onClick={() => checkStatus(false)}
            disabled={checking}
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${checking ? "animate-spin" : ""}`} />
            {checking ? t("plans.checkingStatus") : t("plans.checkStatus")}
          </Button>
          <Button variant="ghost" className="text-xs flex-1 sm:flex-none" onClick={onClose}>
            {t("plans.close")}
          </Button>
        </div>
      </div>

      <p className="text-[10px] text-[var(--placeholder)] text-center flex items-center justify-center gap-1">
        <ShieldCheck className="w-3 h-3 text-[var(--accent)]" />
        {t("plans.securedByDoku")}
      </p>
    </div>
  );
}
