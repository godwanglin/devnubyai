"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Image as ImageIcon,
  RefreshCw,
  ArrowLeftRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/modals/confirm-modal";
import { useToast } from "@/providers/toast-provider";
import { cn } from "@/lib/cn";
import type { PaymentMethodItem } from "@/lib/payments/types";
import { PaymentMethodModal } from "./payment-method-modal";
import { resolveAssetUrl } from "@/lib/storage/assets";
import { SmartImage } from "@/components/ui/smart-image";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

export function PaymentMethodsView() {
  const { toast } = useToast();
  const [methods, setMethods] = useState<PaymentMethodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMethod, setEditingMethod] = useState<PaymentMethodItem | null>(null);
  const [deletingMethod, setDeletingMethod] = useState<PaymentMethodItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [failoverTarget, setFailoverTarget] = useState<"tripay" | "doku" | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);

  // Pagination state (default 10)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const loadMethods = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/v1/admin/payment-methods");
      const json = await res.json().catch(() => null);
      if (res.ok && json?.data?.methods) {
        setMethods(json.data.methods);
      }
    } catch {
      toast("Gagal memuat daftar metode pembayaran");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/admin/payment-methods")
      .then((res) => res.json())
      .then((json) => {
        if (!active) return;
        if (json?.data?.methods) {
          setMethods(json.data.methods);
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
  }, []);

  async function handleToggleActive(method: PaymentMethodItem) {
    setTogglingId(method.publicId);
    // Optimistic UI update
    setMethods((prev) =>
      prev.map((m) =>
        m.publicId === method.publicId ? { ...m, isActive: !m.isActive } : m
      )
    );

    try {
      const res = await fetch(`/api/v1/admin/payment-methods/${method.publicId}/toggle`, {
        method: "PATCH",
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.data?.method) {
        toast(
          json.data.method.isActive
            ? `${method.name} berhasil diaktifkan`
            : `${method.name} dinonaktifkan`
        );
      } else {
        // Rollback on failure
        setMethods((prev) =>
          prev.map((m) =>
            m.publicId === method.publicId ? { ...m, isActive: method.isActive } : m
          )
        );
        toast("Gagal mengubah status metode pembayaran");
      }
    } catch {
      setMethods((prev) =>
        prev.map((m) =>
          m.publicId === method.publicId ? { ...m, isActive: method.isActive } : m
        )
      );
      toast("Terjadi kesalahan jaringan");
    } finally {
      setTogglingId(null);
    }
  }

  async function handleFailoverConfirm() {
    if (!failoverTarget) return;
    try {
      setIsSwitching(true);
      const res = await fetch("/api/v1/admin/payment-methods/failover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryProvider: failoverTarget }),
      });
      const json = await res.json().catch(() => null);
      toast(res.ok ? json?.data?.message : json?.error?.message || "Gagal mengalihkan gateway");
      if (res.ok) {
        setFailoverTarget(null);
        await loadMethods();
      }
    } catch {
      toast("Terjadi kesalahan jaringan");
    } finally {
      setIsSwitching(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!deletingMethod) return;
    try {
      setIsDeleting(true);
      const res = await fetch(`/api/v1/admin/payment-methods/${deletingMethod.publicId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast("Metode pembayaran berhasil dihapus");
        setDeletingMethod(null);
        await loadMethods();
      } else {
        toast("Gagal menghapus metode pembayaran");
      }
    } catch {
      toast("Terjadi kesalahan saat menghapus");
    } finally {
      setIsDeleting(false);
    }
  }

  const categoryLabels: Record<string, string> = {
    virtual_account: "Virtual Account",
    qris: "QRIS",
    ewallet: "E-Wallet",
    retail: "Convenience Store",
    card: "Kartu Kredit/Debit",
  };

  const displayedMethods = methods.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2">
        <div>
          <h2 className="text-base font-semibold text-[var(--ink)]">Daftar Metode Pembayaran</h2>
          <p className="text-xs text-[var(--muted)]">
            Atur metode pembayaran, logo, sumber gateway (Tripay utama, DOKU cadangan), alur pembayaran, dan status aktif.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setFailoverTarget("tripay")}
            className="border border-[var(--border)] gap-1.5"
            title="Aktifkan semua metode Tripay, nonaktifkan DOKU"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            Pakai Tripay
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setFailoverTarget("doku")}
            className="border border-[var(--border)] gap-1.5"
            title="Aktifkan semua metode DOKU, nonaktifkan Tripay (saat Tripay bermasalah)"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            Pakai DOKU
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={loadMethods}
            disabled={loading}
            className="border border-[var(--border)] gap-1.5"
            title="Segarkan daftar"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setEditingMethod(null);
              setIsModalOpen(true);
            }}
            className="gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Tambah Metode
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="p-12 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] flex items-center justify-center gap-2 text-sm text-[var(--muted)]">
          <Loader2 className="w-5 h-5 animate-spin text-[var(--accent)]" />
          Memuat data metode pembayaran...
        </div>
      ) : methods.length === 0 ? (
        <div className="p-12 rounded-[12px] border border-dashed border-[var(--border)] bg-[var(--panel)] text-center space-y-3">
          <ImageIcon className="w-10 h-10 text-[var(--muted)] mx-auto opacity-50" />
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-[var(--ink)]">Belum Ada Metode Pembayaran</h3>
            <p className="text-xs text-[var(--muted)] max-w-sm mx-auto">
              Tambahkan metode pembayaran pertama seperti BRI Virtual Account atau QRIS agar pengguna dapat melakukan top-up.
            </p>
          </div>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setEditingMethod(null);
              setIsModalOpen(true);
            }}
            className="gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Tambah Metode Sekarang
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {displayedMethods.map((method) => {
            const isToggling = togglingId === method.publicId;
            return (
              <div
                key={method.publicId}
                className={cn(
                  "p-4 rounded-[12px] border transition-all space-y-3 bg-[var(--panel)]",
                  method.isActive
                    ? "border-[var(--border)] shadow-xs"
                    : "border-[var(--border)]/60 opacity-60 bg-[var(--surface)]"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] flex items-center justify-center p-1 overflow-hidden shrink-0">
                      {method.imagePath ? (
                        <SmartImage
                          src={resolveAssetUrl(method.imagePath)}
                          alt={method.name}
                          loaderSize="sm"
                          containerClassName="w-full h-full bg-transparent border-0"
                          imgClassName="w-full h-full object-contain"
                        />
                      ) : (
                        <ImageIcon className="w-5 h-5 text-[var(--muted)]" />
                      )}
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--ink)] leading-snug">
                        {method.name}
                      </h3>
                      <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
                        <code className="font-mono text-[10px] px-1 py-0.5 rounded bg-[var(--surface)]">
                          {method.code}
                        </code>
                        <span>•</span>
                        <span>{categoryLabels[method.category] || method.category}</span>
                      </div>
                    </div>
                  </div>

                  {/* Toggle Active Switch */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={method.isActive}
                    disabled={isToggling}
                    onClick={() => handleToggleActive(method)}
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden",
                      method.isActive ? "bg-emerald-500" : "bg-[var(--border)]",
                      isToggling && "opacity-50 cursor-not-allowed"
                    )}
                    title={method.isActive ? "Klik untuk nonaktifkan" : "Klik untuk aktifkan"}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out",
                        method.isActive ? "translate-x-4" : "translate-x-0"
                      )}
                    />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-[var(--border)]">
                  <div>
                    <span className="text-[var(--muted)] block">Tipe Alur:</span>
                    <span className="font-medium text-[var(--ink)] capitalize">
                      {method.provider === "tripay"
                        ? `🟢 Tripay · ${method.dokuCode || "-"}`
                        : method.flowType === "direct"
                          ? "⚡ DOKU Direct VA"
                          : "🔗 DOKU Checkout"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[var(--muted)] block">Min. Transaksi:</span>
                    <span className="font-medium text-[var(--ink)]">
                      Rp {method.minAmount.toLocaleString("id-ID")}
                    </span>
                  </div>
                </div>

                {method.imagePath && (
                  <div className="text-[10px] text-[var(--muted)] font-mono truncate px-2 py-1 rounded bg-[var(--surface)]">
                    path: {method.imagePath}
                  </div>
                )}

                <div className="flex items-center justify-between pt-1 border-t border-[var(--border)] text-xs">
                  <span className={cn(
                    "text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1",
                    method.isActive
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-neutral-500/10 text-[var(--muted)]"
                  )}>
                    {method.isActive ? (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Aktif
                      </>
                    ) : (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-neutral-400" />
                        Nonaktif
                      </>
                    )}
                  </span>

                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingMethod(method);
                        setIsModalOpen(true);
                      }}
                      className="h-7 px-2 hover:bg-[var(--hover)] text-[var(--ink)]"
                      title="Edit Metode"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeletingMethod(method)}
                      className="h-7 px-2 hover:bg-red-500/10 text-red-500"
                      title="Hapus Metode"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {methods.length > 0 && (
        <DataTablePagination
          page={page}
          pageSize={pageSize}
          totalItems={methods.length}
          onPageChange={setPage}
          onPageSizeChange={(newSize) => {
            setPageSize(newSize);
            setPage(1);
          }}
          className="rounded-[12px] border border-[var(--border)]"
        />
      )}

      {/* Edit / Add Modal */}
      <PaymentMethodModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        method={editingMethod}
        onSaved={loadMethods}
      />

      {/* Confirm Gateway Failover */}
      <ConfirmModal
        isOpen={Boolean(failoverTarget)}
        onClose={() => setFailoverTarget(null)}
        onConfirm={handleFailoverConfirm}
        title={`Alihkan pembayaran ke ${failoverTarget === "doku" ? "DOKU" : "Tripay"}?`}
        description={
          <span>
            Semua metode <strong>{failoverTarget === "doku" ? "DOKU" : "Tripay"}</strong> akan diaktifkan dan
            semua metode <strong>{failoverTarget === "doku" ? "Tripay" : "DOKU"}</strong> dinonaktifkan.
            Tagihan yang sudah dibuat tetap diproses gateway asalnya.
          </span>
        }
        confirmLabel="Alihkan"
        cancelLabel="Batal"
        loading={isSwitching}
      />

      {/* Confirm Delete Modal */}
      <ConfirmModal
        isOpen={Boolean(deletingMethod)}
        onClose={() => setDeletingMethod(null)}
        onConfirm={handleDeleteConfirm}
        title="Hapus Metode Pembayaran?"
        description={
          <span>
            Apakah Anda yakin ingin menghapus metode pembayaran{" "}
            <strong>{deletingMethod?.name}</strong>? Transaksi yang sudah dibuat dengan metode ini akan tetap tercatat.
          </span>
        }
        confirmLabel="Hapus Metode"
        cancelLabel="Batal"
        loading={isDeleting}
      />
    </div>
  );
}
