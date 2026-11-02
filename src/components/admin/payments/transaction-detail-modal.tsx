"use client";

import React, { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Copy, Check, ExternalLink, ChevronDown, ChevronUp, User, CreditCard, Clock } from "lucide-react";
import { useToast } from "@/providers/toast-provider";
import { cn } from "@/lib/cn";
import type { PaymentTransactionItem } from "@/lib/payments/types";

interface TransactionDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: PaymentTransactionItem | null;
  onOpenStatusModal: (t: PaymentTransactionItem) => void;
}

export function TransactionDetailModal({
  isOpen,
  onClose,
  transaction,
  onOpenStatusModal,
}: TransactionDetailModalProps) {
  const { toast } = useToast();
  const [copiedCode, setCopiedCode] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);

  if (!transaction) return null;

  function copyPaymentCode() {
    if (!transaction?.paymentCode) return;
    void navigator.clipboard.writeText(transaction.paymentCode);
    setCopiedCode(true);
    toast("Kode pembayaran / VA disalin");
    setTimeout(() => setCopiedCode(false), 2000);
  }

  const statusStyles: Record<string, string> = {
    PAID: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    PENDING: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
    EXPIRED: "bg-neutral-500/15 text-[var(--muted)] border-neutral-500/30",
    FAILED: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
    CANCELLED: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
    REFUNDED: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30",
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Detail Transaksi" maxWidth="lg">
      <div className="space-y-4 text-xs">
        {/* Header Summary */}
        <div className="p-3.5 rounded-[10px] bg-[var(--surface)] border border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-[var(--ink)]">
                {transaction.invoiceNumber}
              </span>
              <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-semibold border", statusStyles[transaction.status] || "")}>
                {transaction.status}
              </span>
            </div>
            <p className="text-[11px] text-[var(--muted)] mt-0.5">
              Dibuat pada {new Date(transaction.createdAt).toLocaleString("id-ID")}
            </p>
          </div>

          <div className="text-right">
            <span className="text-[11px] text-[var(--muted)] block">Total Pembayaran</span>
            <span className="text-base font-bold text-[var(--ink)]">
              Rp {transaction.totalAmount.toLocaleString("id-ID")}
            </span>
          </div>
        </div>

        {/* Payment Code / VA */}
        {transaction.paymentCode && (
          <div className="p-3 rounded-[8px] bg-blue-500/10 border border-blue-500/20 flex items-center justify-between gap-3">
            <div>
              <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider block">
                Nomor Virtual Account / Kode Pembayaran ({transaction.paymentMethodCode.toUpperCase()})
              </span>
              <span className="font-mono text-base font-bold text-[var(--ink)] select-all tracking-wide">
                {transaction.paymentCode}
              </span>
            </div>

            <Button
              size="sm"
              variant="ghost"
              onClick={copyPaymentCode}
              className="h-8 gap-1.5 border border-blue-500/30 text-blue-600 dark:text-blue-400"
            >
              {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedCode ? "Tersalin" : "Salin Kode"}
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Customer Info */}
          <div className="p-3 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] space-y-2">
            <div className="flex items-center gap-1.5 font-semibold text-[var(--ink)] pb-1 border-b border-[var(--border)]">
              <User className="w-3.5 h-3.5 text-[var(--muted)]" />
              Informasi Pelanggan
            </div>
            <div className="space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Nama:</span>
                <span className="font-medium text-[var(--ink)]">{transaction.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Email:</span>
                <span className="font-medium text-[var(--ink)]">{transaction.customerEmail}</span>
              </div>
              {transaction.customerPhone && (
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Telepon:</span>
                  <span className="font-medium text-[var(--ink)]">{transaction.customerPhone}</span>
                </div>
              )}
            </div>
          </div>

          {/* Payment Method Details */}
          <div className="p-3 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] space-y-2">
            <div className="flex items-center gap-1.5 font-semibold text-[var(--ink)] pb-1 border-b border-[var(--border)]">
              <CreditCard className="w-3.5 h-3.5 text-[var(--muted)]" />
              Metode Pembayaran
            </div>
            <div className="space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Metode:</span>
                <span className="font-medium text-[var(--ink)]">{transaction.paymentMethodName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Nominal Pokok:</span>
                <span className="font-medium text-[var(--ink)]">
                  Rp {transaction.amount.toLocaleString("id-ID")}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Biaya Admin:</span>
                <span className="font-medium text-[var(--ink)]">
                  Rp {transaction.fee.toLocaleString("id-ID")}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Timestamps */}
        <div className="p-3 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] space-y-2 text-[11px]">
          <div className="flex items-center gap-1.5 font-semibold text-[var(--ink)] pb-1 border-b border-[var(--border)]">
            <Clock className="w-3.5 h-3.5 text-[var(--muted)]" />
            Waktu Transaksi
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <span className="text-[var(--muted)] block">Dibuat:</span>
              <span className="font-medium text-[var(--ink)]">
                {new Date(transaction.createdAt).toLocaleString("id-ID")}
              </span>
            </div>
            <div>
              <span className="text-[var(--muted)] block">Kedaluwarsa:</span>
              <span className="font-medium text-[var(--ink)]">
                {transaction.expiredAt ? new Date(transaction.expiredAt).toLocaleString("id-ID") : "-"}
              </span>
            </div>
            <div>
              <span className="text-[var(--muted)] block">Dibayar:</span>
              <span className="font-medium text-emerald-600 dark:text-emerald-400 font-semibold">
                {transaction.paidAt ? new Date(transaction.paidAt).toLocaleString("id-ID") : "-"}
              </span>
            </div>
          </div>
        </div>

        {/* Manual Audit Trail if modified */}
        {transaction.manualNotes && (
          <div className="p-3 rounded-[8px] bg-amber-500/10 border border-amber-500/20 space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-amber-700 dark:text-amber-300">
                Catatan Perubahan Manual (Admin)
              </span>
              {transaction.manualUpdatedBy && (
                <span className="text-[10px] text-[var(--muted)]">
                  Oleh: {transaction.manualUpdatedBy.name} ({new Date(transaction.manualUpdatedAt || "").toLocaleString("id-ID")})
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--ink)] italic bg-black/5 dark:bg-white/5 p-2 rounded-[6px]">
              &ldquo;{transaction.manualNotes}&rdquo;
            </p>
          </div>
        )}

        {/* Raw DOKU Payload Accordion */}
        {transaction.gatewayResponse && (
          <div className="border border-[var(--border)] rounded-[8px] overflow-hidden">
            <button
              type="button"
              onClick={() => setShowRawJson(!showRawJson)}
              className="w-full px-3 py-2 bg-[var(--surface)] text-[var(--ink)] text-xs font-medium flex items-center justify-between hover:bg-[var(--hover)]"
            >
              <span>Respon Mentah Gateway (DOKU)</span>
              {showRawJson ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {showRawJson && (
              <pre className="p-3 bg-[var(--panel)] font-mono text-[10px] text-[var(--ink)] overflow-x-auto max-h-48 border-t border-[var(--border)]">
                {JSON.stringify(transaction.gatewayResponse, null, 2)}
              </pre>
            )}
          </div>
        )}

        {/* Actions Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
          {transaction.howToPayUrl ? (
            <a
              href={transaction.howToPayUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Panduan Bayar DOKU
            </a>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                onClose();
                onOpenStatusModal(transaction);
              }}
              className="border border-[var(--border)] text-xs"
            >
              Ubah Status Manual
            </Button>
            <Button type="button" size="sm" variant="primary" onClick={onClose}>
              Tutup
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
