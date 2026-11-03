"use client";

import React, { useState, useEffect, useCallback } from "react";
import QRCode from "qrcode";
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  QrCode,
  CreditCard,
  Wallet,
  Smartphone,
  BellRing,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n-provider";
import type { TripayPaymentResult } from "@/lib/tripay/payment-kind";

interface TripayPaymentViewProps {
  result: TripayPaymentResult;
  formatRupiah: (val: number) => string;
  onPaid: () => void;
  onClose: () => void;
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Tripay invoice inside the checkout modal: a locally rendered QR (QRIS), a
 * copyable pay code with Tripay's instructions (VA / retail), or a button to
 * Tripay's hosted page (e-wallet redirect). Status is polled the same way for all.
 */
export function TripayPaymentView({
  result,
  formatRupiah,
  onPaid,
  onClose,
}: TripayPaymentViewProps) {
  const { t } = useI18n();
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<"pending" | "expired" | "failed">("pending");
  const [now, setNow] = useState(() => Date.now());
  const expiresAt = new Date(result.expiredAt).getTime();
  const remaining = expiresAt - now;

  // Render QRIS SVG if the transaction returned a qrString
  useEffect(() => {
    if (!result.qrString) return;
    let cancelled = false;
    QRCode.toString(result.qrString, { type: "svg", margin: 1, errorCorrectionLevel: "M" })
      .then((svg) => {
        if (!cancelled) setQrSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [result.qrString]);

  const checkStatus = useCallback(
    async (silent = false) => {
      if (!silent) setChecking(true);
      try {
        const res = await fetch(
          `/api/v1/payments/status?invoiceNumber=${encodeURIComponent(result.invoiceNumber)}`,
          { credentials: "same-origin" }
        );
        const json = await res.json();
        const next = json?.data?.status;
        if (res.ok && next === "PAID") {
          onPaid();
          return true;
        }
        if (next === "EXPIRED") setStatus("expired");
        else if (next === "FAILED") setStatus("failed");
      } catch {
        // Keep polling
      } finally {
        if (!silent) setChecking(false);
      }
      return false;
    },
    [result.invoiceNumber, onPaid]
  );

  // Poll status every 4s and tick countdown
  useEffect(() => {
    if (status !== "pending") return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => {
      void checkStatus(true);
    }, 4000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [status, checkStatus]);

  const isExpired = status === "expired" || remaining <= 0;

  const handleCopyPayCode = () => {
    if (!result.payCode) return;
    navigator.clipboard.writeText(result.payCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div className="space-y-4 py-1">
      {/* Invoice header & countdown */}
      <div className="flex items-center justify-between gap-2 p-3 rounded-[12px] bg-[var(--panel-elevated)] border border-[var(--border)] text-xs">
        <div>
          <span className="text-[10px] uppercase font-semibold text-[var(--muted)] tracking-wider block">
            {t("plans.invoiceNumber")}
          </span>
          <span className="font-mono font-medium text-[var(--ink)]">{result.invoiceNumber}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 font-medium text-[11px]">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          <span>
            {isExpired ? t("plans.statusExpired") : t("plans.payWithin", { time: formatCountdown(remaining) })}
          </span>
        </div>
      </div>

      {/* ── KIND 1: QRIS ── */}
      {result.kind === "qris" && (
        <div className="flex flex-col items-center gap-3">
          <div className="relative w-64 h-64 rounded-[12px] bg-white p-3 shadow-inner flex items-center justify-center">
            {qrSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrSrc}
                alt="Kode QRIS"
                className={`w-full h-full ${isExpired || status === "failed" ? "opacity-20" : ""}`}
              />
            ) : (
              <Loader2 className="w-6 h-6 animate-spin text-neutral-400" />
            )}
            {(isExpired || status === "failed") && (
              <span className="absolute text-xs font-semibold text-red-600">
                {isExpired ? t("plans.qrExpired") : t("plans.statusFailed")}
              </span>
            )}
          </div>
          <p className="text-[11px] text-[var(--muted)] text-center flex items-center gap-1.5">
            <QrCode className="w-3.5 h-3.5 text-[var(--accent)]" />
            {t("plans.qrisScanDesc")}
          </p>
        </div>
      )}

      {/* ── KIND 2: Virtual Account / Pay Code ── */}
      {result.kind === "pay_code" && (
        <div className="space-y-3">
          <div className="p-3.5 rounded-[12px] bg-white/[0.03] border border-[var(--border)] space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--muted)] font-medium flex items-center gap-1.5">
                <CreditCard className="w-3.5 h-3.5 text-[var(--accent)]" />
                {t("plans.vaNumberLabel", { name: result.paymentName })}
              </span>
              <span className="text-[10px] uppercase font-semibold text-emerald-400">
                {t("plans.instantBadge")}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 p-2.5 rounded-[8px] bg-[var(--surface)] border border-[var(--border)]">
              <span className="font-mono text-base font-bold text-[var(--ink)] tracking-wider">
                {result.payCode || "-"}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleCopyPayCode}
                className="h-7 px-2.5 text-xs gap-1 border border-[var(--border)] hover:bg-[var(--hover)]"
              >
                {copiedCode ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    {t("plans.copied")}
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    {t("plans.copy")}
                  </>
                )}
              </Button>
            </div>
            <p className="text-[10px] text-[var(--muted)]">{t("plans.vaNoticeDesc")}</p>
          </div>

          {/* Payment Instructions if returned by Tripay */}
          {result.instructions && result.instructions.length > 0 && (
            <div className="max-h-36 overflow-y-auto space-y-2 p-2 rounded-[8px] bg-white/[0.02] border border-[var(--border)] text-[11px]">
              <span className="font-semibold text-[var(--ink)] block">
                {t("plans.instructionsTitle")}
              </span>
              {result.instructions.map((inst, idx) => (
                <details key={idx} className="cursor-pointer text-[var(--muted)]">
                  <summary className="font-medium text-[var(--ink)] hover:text-[var(--accent)]">
                    {inst.title}
                  </summary>
                  <ol className="list-decimal pl-4 pt-1 space-y-0.5 text-[10px] leading-relaxed">
                    {inst.steps.map((st, sIdx) => (
                      <li key={sIdx}>{st}</li>
                    ))}
                  </ol>
                </details>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── KIND 3: E-Wallet Redirect (DANA / ShopeePay) ── */}
      {result.kind === "redirect" && (
        <div className="p-4 rounded-[12px] bg-white/[0.03] border border-[var(--border)] text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] flex items-center justify-center mx-auto">
            <Wallet className="w-6 h-6" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-[var(--ink)]">
              {t("plans.methodTitle", { name: result.paymentName })}
            </h4>
            <p className="text-xs text-[var(--muted)] mt-1 max-w-xs mx-auto">
              {t("plans.ewalletPayDesc", { name: result.paymentName })}
            </p>
          </div>
          {result.checkoutUrl && (
            <a
              href={result.checkoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 w-full py-2.5 px-4 rounded-[8px] bg-[var(--accent)] text-[var(--accent-text)] font-semibold text-xs shadow-xs hover:opacity-95 transition-opacity"
            >
              <span>{t("plans.ewalletPayButton", { name: result.paymentName })}</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      )}

      {/* ── KIND 4: E-Wallet Push Payment (OVO) ── */}
      {result.kind === "push" && (
        <div className="p-4 rounded-[12px] bg-white/[0.03] border border-[var(--border)] text-center space-y-3">
          <div className="relative w-12 h-12 rounded-full bg-purple-500/10 text-purple-400 flex items-center justify-center mx-auto">
            <Smartphone className="w-6 h-6" />
            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-purple-500 text-[9px] text-white font-bold animate-bounce">
              <BellRing className="w-2.5 h-2.5" />
            </span>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-[var(--ink)]">
              {t("plans.ovoPushTitle")}
            </h4>
            <p className="text-xs text-[var(--muted)] mt-1 max-w-xs mx-auto leading-relaxed">
              {result.customerPhone
                ? t("plans.ovoPushDescWithPhone", { phone: result.customerPhone })
                : t("plans.ovoPushDesc")}
            </p>
          </div>

          <div className="p-2.5 rounded-[8px] bg-purple-500/5 border border-purple-500/20 text-purple-300 text-[11px] flex items-center justify-center gap-2">
            <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
            <span>{t("plans.ovoWaitingConfirm")}</span>
          </div>

          {result.checkoutUrl && (
            <div className="pt-1">
              <a
                href={result.checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1 text-[11px] text-[var(--muted)] hover:text-[var(--ink)] underline underline-offset-4"
              >
                <span>{t("plans.ovoTroubleOpenLink")}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>
      )}

      {/* Amount & Fee summary */}
      <div className="p-3 rounded-[12px] bg-white/[0.02] border border-[var(--border)] space-y-1.5 text-xs">
        <div className="flex justify-between text-[var(--muted)]">
          <span>{t("plans.planPrice")}</span>
          <span className="text-[var(--ink)]">{formatRupiah(result.amount)}</span>
        </div>
        {result.fee > 0 && (
          <div className="flex justify-between text-[var(--muted)]">
            <span>{t("plans.serviceFee", { name: result.paymentName })}</span>
            <span className="text-[var(--ink)]">{formatRupiah(result.fee)}</span>
          </div>
        )}
        <div className="flex justify-between pt-1.5 border-t border-[var(--border)] font-bold text-sm text-[var(--ink)]">
          <span>{t("plans.totalPayment")}</span>
          <span>{formatRupiah(result.totalAmount)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          className="text-xs"
          onClick={() => checkStatus(false)}
          disabled={checking || isExpired}
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${checking ? "animate-spin" : ""}`} />
          {checking ? t("plans.checkingStatus") : t("plans.checkStatus")}
        </Button>
        <Button variant="ghost" className="text-xs" onClick={onClose}>
          {t("plans.close")}
        </Button>
      </div>

      <p className="text-[10px] text-[var(--placeholder)] text-center flex items-center justify-center gap-1">
        <ShieldCheck className="w-3 h-3 text-[var(--accent)]" />
        {t("plans.securedByTripay")}
      </p>
    </div>
  );
}
