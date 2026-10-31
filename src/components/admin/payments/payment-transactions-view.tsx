"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Search,
  RefreshCw,
  Loader2,
  Copy,
  Check,
  Eye,
  Edit3,
  TrendingUp,
  Clock,
  CheckCircle2,
  FileText,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/providers/toast-provider";
import { cn } from "@/lib/cn";
import type { PaymentTransactionItem, TransactionSummaryStats } from "@/lib/payments/types";
import { TransactionStatusModal } from "./transaction-status-modal";
import { TransactionDetailModal } from "./transaction-detail-modal";

export function PaymentTransactionsView() {
  const { toast } = useToast();
  const [transactions, setTransactions] = useState<PaymentTransactionItem[]>([]);
  const [stats, setStats] = useState<TransactionSummaryStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters & Pagination
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Modals state
  const [statusModalItem, setStatusModalItem] = useState<PaymentTransactionItem | null>(null);
  const [detailModalItem, setDetailModalItem] = useState<PaymentTransactionItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadTransactions = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set("page", page.toString());
      params.set("limit", "15");
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (search.trim()) params.set("search", search.trim());

      const res = await fetch(`/api/v1/admin/payment-transactions?${params.toString()}`);
      const json = await res.json().catch(() => null);

      if (res.ok && json?.data) {
        setTransactions(json.data.transactions || []);
        setStats(json.data.stats || null);
        setTotalPages(json.data.pagination?.totalPages || 1);
        setTotalCount(json.data.pagination?.total || 0);
      }
    } catch {
      toast("Gagal memuat transaksi");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, search, toast]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    params.set("page", page.toString());
    params.set("limit", "15");
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (search.trim()) params.set("search", search.trim());

    fetch(`/api/v1/admin/payment-transactions?${params.toString()}`)
      .then((res) => res.json())
      .then((json) => {
        if (!active) return;
        if (json?.data) {
          setTransactions(json.data.transactions || []);
          setStats(json.data.stats || null);
          setTotalPages(json.data.pagination?.totalPages || 1);
          setTotalCount(json.data.pagination?.total || 0);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [page, statusFilter, search]);

  function copyText(text: string, id: string) {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast("Kode pembayaran disalin");
    setTimeout(() => setCopiedId(null), 2000);
  }

  const statusStyles: Record<string, string> = {
    PAID: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    PENDING: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
    EXPIRED: "bg-neutral-500/15 text-[var(--muted)] border-neutral-500/30",
    FAILED: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
    CANCELLED: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
    REFUNDED: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30",
  };

  const filterTabs = [
    { key: "ALL", label: "Semua" },
    { key: "PENDING", label: "Menunggu" },
    { key: "PAID", label: "Lunas" },
    { key: "EXPIRED", label: "Kedaluwarsa" },
    { key: "FAILED", label: "Gagal" },
    { key: "CANCELLED", label: "Batal" },
  ];

  return (
    <div className="space-y-4">
      {/* Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-[12px] bg-[var(--panel)] border border-[var(--border)] space-y-1">
          <div className="flex items-center justify-between text-[11px] text-[var(--muted)]">
            <span>Total Transaksi</span>
            <FileText className="w-3.5 h-3.5" />
          </div>
          <p className="text-xl font-bold text-[var(--ink)]">
            {stats?.totalCount || 0}
          </p>
        </div>

        <div className="p-3.5 rounded-[12px] bg-[var(--panel)] border border-[var(--border)] space-y-1">
          <div className="flex items-center justify-between text-[11px] text-emerald-600 dark:text-emerald-400">
            <span>Lunas (Berhasil)</span>
            <CheckCircle2 className="w-3.5 h-3.5" />
          </div>
          <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
            {stats?.paidCount || 0}
          </p>
        </div>

        <div className="p-3.5 rounded-[12px] bg-[var(--panel)] border border-[var(--border)] space-y-1">
          <div className="flex items-center justify-between text-[11px] text-amber-600 dark:text-amber-400">
            <span>Menunggu Bayar</span>
            <Clock className="w-3.5 h-3.5" />
          </div>
          <p className="text-xl font-bold text-amber-600 dark:text-amber-400">
            {stats?.pendingCount || 0}
          </p>
        </div>

        <div className="p-3.5 rounded-[12px] bg-[var(--panel)] border border-[var(--border)] space-y-1">
          <div className="flex items-center justify-between text-[11px] text-[var(--muted)]">
            <span>Volume Lunas</span>
            <TrendingUp className="w-3.5 h-3.5" />
          </div>
          <p className="text-lg font-bold text-[var(--ink)] truncate">
            Rp {(stats?.paidVolume || 0).toLocaleString("id-ID")}
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pb-1">
        {/* Status Filters */}
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none pb-1 sm:pb-0">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                setStatusFilter(tab.key);
                setPage(1);
              }}
              className={cn(
                "px-2.5 py-1 rounded-[6px] text-xs font-medium transition-colors whitespace-nowrap cursor-pointer",
                statusFilter === tab.key
                  ? "bg-[var(--accent-soft)] text-[var(--accent)] font-semibold shadow-xs border border-[var(--border)]"
                  : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] border border-transparent"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-[var(--muted)] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Cari invoice, pelanggan, VA..."
              className="w-full pl-8 pr-3 py-1.5 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--ink)] focus:outline-hidden focus:border-[var(--accent)]"
            />
          </div>

          <Button
            size="sm"
            variant="ghost"
            onClick={loadTransactions}
            disabled={loading}
            className="border border-[var(--border)] h-8 px-2.5"
            title="Muat Ulang"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-[12px] border border-[var(--border)] bg-[var(--panel)] overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] font-medium">
                <th className="py-2.5 px-3">Invoice</th>
                <th className="py-2.5 px-3">Pelanggan</th>
                <th className="py-2.5 px-3">Metode</th>
                <th className="py-2.5 px-3">Kode Bayar (VA)</th>
                <th className="py-2.5 px-3 text-right">Nominal</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Waktu</th>
                <th className="py-2.5 px-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {loading && transactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[var(--muted)]">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-[var(--accent)]" />
                    Memuat transaksi...
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[var(--muted)]">
                    Tidak ada transaksi yang cocok.
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx.publicId} className="hover:bg-[var(--hover)] transition-colors">
                    {/* Invoice */}
                    <td className="py-3 px-3 font-mono font-medium text-[var(--ink)]">
                      {tx.invoiceNumber}
                    </td>

                    {/* Customer */}
                    <td className="py-3 px-3">
                      <div className="font-medium text-[var(--ink)]">{tx.customerName}</div>
                      <div className="text-[10px] text-[var(--muted)]">{tx.customerEmail}</div>
                    </td>

                    {/* Method */}
                    <td className="py-3 px-3">
                      <div className="font-medium text-[var(--ink)]">{tx.paymentMethodName}</div>
                      <div className="text-[10px] text-[var(--muted)] uppercase font-mono">
                        {tx.paymentMethodCode}
                      </div>
                    </td>

                    {/* Payment Code / VA */}
                    <td className="py-3 px-3">
                      {tx.paymentCode ? (
                        <div className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-[var(--ink)] px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)]">
                          <span>{tx.paymentCode}</span>
                          <button
                            type="button"
                            onClick={() => copyText(tx.paymentCode!, tx.publicId)}
                            className="text-[var(--muted)] hover:text-[var(--ink)] p-0.5"
                            title="Salin Kode"
                          >
                            {copiedId === tx.publicId ? (
                              <Check className="w-3 h-3 text-emerald-500" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      ) : (
                        <span className="text-[var(--muted)]">-</span>
                      )}
                    </td>

                    {/* Nominal */}
                    <td className="py-3 px-3 text-right font-semibold text-[var(--ink)]">
                      Rp {tx.totalAmount.toLocaleString("id-ID")}
                    </td>

                    {/* Status Badge */}
                    <td className="py-3 px-3">
                      <span className={cn(
                        "px-2 py-0.5 rounded-full text-[10px] font-bold border",
                        statusStyles[tx.status] || ""
                      )}>
                        {tx.status}
                      </span>
                    </td>

                    {/* Date */}
                    <td className="py-3 px-3 text-[11px] text-[var(--muted)] whitespace-nowrap">
                      {new Date(tx.createdAt).toLocaleDateString("id-ID", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDetailModalItem(tx)}
                          className="h-7 w-7 p-0 hover:bg-[var(--hover)] text-[var(--ink)]"
                          title="Lihat Detail Transaksi"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setStatusModalItem(tx)}
                          className="h-7 w-7 p-0 hover:bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          title="Ubah Status Manual"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between p-3 border-t border-[var(--border)] text-xs text-[var(--muted)]">
            <div>
              Halaman {page} dari {totalPages} ({totalCount} total)
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="h-7 px-2 border border-[var(--border)]"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="h-7 px-2 border border-[var(--border)]"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      <TransactionStatusModal
        isOpen={Boolean(statusModalItem)}
        onClose={() => setStatusModalItem(null)}
        transaction={statusModalItem}
        onUpdated={loadTransactions}
      />

      <TransactionDetailModal
        isOpen={Boolean(detailModalItem)}
        onClose={() => setDetailModalItem(null)}
        transaction={detailModalItem}
        onOpenStatusModal={(tx) => setStatusModalItem(tx)}
      />
    </div>
  );
}
