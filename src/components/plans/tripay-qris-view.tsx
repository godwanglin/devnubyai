"use client";

import React, { useState, useEffect, useCallback } from "react";
import QRCode from "qrcode";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface TripayQrisResult {
  invoiceNumber: string;
  qrString: string;
  amount: number;
  fee: number;
  totalAmount: number;
  expiredAt: string;
}

interface TripayQrisViewProps {
  result: TripayQrisResult;
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

/** QRIS from Tripay, rendered locally from the raw QR payload */
export function TripayQrisView({ result, formatRupiah, onPaid, onClose }: TripayQrisViewProps) {
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<"pending" | "expired" | "failed">("pending");
  const [now, setNow] = useState(() => Date.now());
  const expiresAt = new Date(result.expiredAt).getTime();
  const remaining = expiresAt - now;

  useEffect(() => {
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
        // keep polling
      } finally {
        if (!silent) setChecking(false);
      }
      return false;
    },
    [result.invoiceNumber, onPaid]
  );

  // Countdown tick + status poll every 4 seconds while pending
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

  return (
    <div className="space-y-4 py-1">
      <div className="flex items-center justify-between gap-2 p-3 rounded-[12px] bg-[var(--panel-elevated)] border border-[var(--border)] text-xs">
        <div>
          <span className="text-[10px] uppercase font-semibold text-[var(--muted)] tracking-wider block">
            Nomor Invoice
          </span>
          <span className="font-mono font-medium text-[var(--ink)]">{result.invoiceNumber}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 font-medium text-[11px]">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          <span>{isExpired ? "Kedaluwarsa" : `Bayar dalam ${formatCountdown(remaining)}`}</span>
        </div>
      </div>

      <div className="flex flex-col items-center gap-3">
        <div className="relative w-64 h-64 rounded-[12px] bg-white p-3 shadow-inner flex items-center justify-center">
          {qrSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- local data: URL, nothing to optimize
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
              {isExpired ? "QR kedaluwarsa, buat tagihan baru" : "Pembayaran gagal"}
            </span>
          )}
        </div>
        <p className="text-[11px] text-[var(--muted)] text-center">
          Pindai dengan aplikasi e-wallet atau mobile banking yang mendukung QRIS.
        </p>
      </div>

      <div className="p-3 rounded-[12px] bg-white/[0.02] border border-[var(--border)] space-y-1.5 text-xs">
        <div className="flex justify-between text-[var(--muted)]">
          <span>Harga paket</span>
          <span className="text-[var(--ink)]">{formatRupiah(result.amount)}</span>
        </div>
        {result.fee > 0 && (
          <div className="flex justify-between text-[var(--muted)]">
            <span>Biaya layanan QRIS</span>
            <span className="text-[var(--ink)]">{formatRupiah(result.fee)}</span>
          </div>
        )}
        <div className="flex justify-between pt-1.5 border-t border-[var(--border)] font-bold text-sm text-[var(--ink)]">
          <span>Total Bayar</span>
          <span>{formatRupiah(result.totalAmount)}</span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          className="text-xs"
          onClick={() => checkStatus(false)}
          disabled={checking || isExpired}
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${checking ? "animate-spin" : ""}`} />
          {checking ? "Memeriksa..." : "Cek Status"}
        </Button>
        <Button variant="ghost" className="text-xs" onClick={onClose}>
          Tutup
        </Button>
      </div>

      <p className="text-[10px] text-[var(--placeholder)] text-center flex items-center justify-center gap-1">
        <ShieldCheck className="w-3 h-3 text-[var(--accent)]" />
        Pembayaran QRIS diproses oleh Tripay
      </p>
    </div>
  );
}
