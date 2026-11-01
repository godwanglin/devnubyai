"use client";

import React from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PaymentSuccessViewProps {
  planName: string;
  invoiceNumber: string;
  amount: number;
  formatRupiah: (val: number) => string;
  onDone: () => void;
}

export function PaymentSuccessView({
  planName,
  invoiceNumber,
  amount,
  formatRupiah,
  onDone,
}: PaymentSuccessViewProps) {
  return (
    <div className="space-y-6 py-4 text-center">
      <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mx-auto flex items-center justify-center shadow-lg shadow-emerald-500/5">
        <CheckCircle2 className="w-9 h-9" />
      </div>

      <div className="space-y-1.5">
        <h3 className="text-lg font-bold text-[var(--ink)]">Pembayaran Berhasil!</h3>
        <p className="text-xs text-[var(--muted)] max-w-sm mx-auto leading-relaxed">
          Selamat! Langganan paket <strong className="text-[var(--ink)] font-semibold">{planName}</strong> Anda telah aktif. Anda dapat langsung menggunakan semua model dan fitur tanpa batas.
        </p>
      </div>

      <div className="p-3.5 rounded-[12px] bg-white/[0.02] border border-[var(--border)] space-y-2 text-xs text-left max-w-sm mx-auto">
        <div className="flex justify-between text-[var(--muted)]">
          <span>Nomor Invoice</span>
          <span className="font-mono text-[var(--ink)]">{invoiceNumber}</span>
        </div>
        <div className="flex justify-between text-[var(--muted)]">
          <span>Status</span>
          <span className="text-emerald-400 font-semibold">LUNAS</span>
        </div>
        <div className="flex justify-between text-[var(--muted)] pt-1 border-t border-[var(--border)] font-medium">
          <span>Total Dibayar</span>
          <span className="text-[var(--ink)] font-bold">{formatRupiah(amount)}</span>
        </div>
      </div>

      <div className="space-y-2 pt-2">
        <Button variant="primary" className="w-full text-xs font-semibold py-2.5" onClick={onDone}>
          Mulai Menggunakan Layanan
        </Button>
        <p className="text-[10px] text-[var(--placeholder)] flex items-center justify-center gap-1">
          <ShieldCheck className="w-3 h-3 text-emerald-400" />
          Transaksi diverifikasi secara aman oleh DOKU Payment Gateway
        </p>
      </div>
    </div>
  );
}
