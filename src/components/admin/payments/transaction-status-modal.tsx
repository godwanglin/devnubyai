"use client";

import React, { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/providers/toast-provider";
import { Loader2, AlertTriangle } from "lucide-react";
import type { PaymentTransactionItem, PaymentTransactionStatus } from "@/lib/payments/types";

interface TransactionStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: PaymentTransactionItem | null;
  onUpdated: () => void;
}

export function TransactionStatusModal({
  isOpen,
  onClose,
  transaction,
  onUpdated,
}: TransactionStatusModalProps) {
  const { toast } = useToast();
  const [status, setStatus] = useState<PaymentTransactionStatus>("PAID");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !transaction) return;
    const timer = setTimeout(() => {
      setStatus(transaction.status === "PENDING" ? "PAID" : transaction.status);
      setNotes("");
    }, 0);
    return () => clearTimeout(timer);
  }, [transaction, isOpen]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!transaction) return;

    if (!notes.trim() || notes.trim().length < 3) {
      toast("Harap masukkan catatan/alasan perubahan status (minimal 3 karakter)");
      return;
    }

    try {
      setLoading(true);
      const res = await fetch(`/api/v1/admin/payment-transactions/${transaction.publicId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          notes: notes.trim(),
        }),
      });

      const json = await res.json().catch(() => null);
      if (res.ok && json?.data?.transaction) {
        toast(`Status transaksi ${transaction.invoiceNumber} berhasil diubah ke ${status}`);
        onUpdated();
        onClose();
      } else {
        toast(json?.error?.message || "Gagal mengubah status transaksi");
      }
    } catch {
      toast("Terjadi kesalahan jaringan");
    } finally {
      setLoading(false);
    }
  }

  if (!transaction) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!loading) onClose();
      }}
      title="Ubah Status Transaksi Manual"
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        <div className="p-3 rounded-[8px] bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-semibold text-xs">Peringatan Override Manual</p>
            <p className="text-[11px] opacity-90">
              Perubahan status secara manual akan dicatat di log audit admin beserta alasan yang kamu masukkan.
            </p>
          </div>
        </div>

        <div className="p-3 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-[var(--muted)]">Nomor Invoice:</span>
            <span className="font-mono font-medium text-[var(--ink)]">{transaction.invoiceNumber}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--muted)]">Pelanggan:</span>
            <span className="font-medium text-[var(--ink)]">{transaction.customerName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--muted)]">Total Tagihan:</span>
            <span className="font-semibold text-[var(--ink)]">
              Rp {transaction.totalAmount.toLocaleString("id-ID")}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--muted)]">Status Saat Ini:</span>
            <span className="font-bold text-[var(--accent)]">{transaction.status}</span>
          </div>
        </div>

        <div>
          <label className="block text-[var(--muted)] font-medium mb-1">
            Status Baru <span className="text-red-500">*</span>
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as PaymentTransactionStatus)}
            className="w-full px-3 py-2 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] font-medium text-xs focus:outline-hidden"
          >
            <option value="PAID">PAID (Lunas / Berhasil)</option>
            <option value="PENDING">PENDING (Menunggu Pembayaran)</option>
            <option value="CANCELLED">CANCELLED (Dibatalkan)</option>
            <option value="EXPIRED">EXPIRED (Kedaluwarsa)</option>
            <option value="FAILED">FAILED (Gagal)</option>
            <option value="REFUNDED">REFUNDED (Dikembalikan)</option>
          </select>
        </div>

        <div>
          <label className="block text-[var(--muted)] font-medium mb-1">
            Alasan / Catatan Konfirmasi <span className="text-red-500">*</span>
          </label>
          <textarea
            required
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Contoh: Dikonfirmasi manual via mutasi rekening bank / permintaan pelanggan..."
            className="w-full px-3 py-2 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] text-xs focus:outline-hidden resize-none"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
          <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
            Batal
          </Button>
          <Button type="submit" variant="primary" disabled={loading} className="gap-1.5">
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Konfirmasi Ubah Status
          </Button>
        </div>
      </form>
    </Modal>
  );
}
