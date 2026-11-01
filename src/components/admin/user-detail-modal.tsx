"use client";

import { useEffect, useState, useCallback } from "react";
import {
  X,
  ShieldAlert,
  RotateCcw,
  LogOut,
  Loader2,
  AlertTriangle,
  History,
  CheckCircle2,
} from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import type { AdminUserDetailDto } from "@/lib/users/types";

interface UserDetailModalProps {
  userId: string;
  onClose: () => void;
  onRefreshParent: () => void;
}

export function UserDetailModal({ userId, onClose, onRefreshParent }: UserDetailModalProps) {
  const { t } = useI18n();

  const [detail, setDetail] = useState<AdminUserDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/admin/users/${userId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Gagal memuat detail pengguna");
      setDetail(data.data.user);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    let active = true;
    fetch(`/api/v1/admin/users/${userId}`)
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        if (data.data?.user) setDetail(data.data.user);
        else setError(data.error?.message || "Gagal memuat detail pengguna");
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Terjadi kesalahan");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [userId]);

  async function handleRevokeSessions() {
    if (!detail) return;
    if (!window.confirm(`${t("admin.users.revokeConfirm")} ${detail.name}?`)) return;

    setActionLoading("revoke");
    setActionNotice(null);
    try {
      const res = await fetch(`/api/v1/admin/users/${detail.id}/revoke-sessions`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Gagal mencabut sesi");

      setActionNotice(`Berhasil mencabut ${data.data.revokedCount} sesi aktif.`);
      void fetchDetail();
      onRefreshParent();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Gagal mencabut sesi");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleResetQuota() {
    if (!detail) return;
    if (!window.confirm(`${t("admin.users.resetQuotaConfirm")} ${detail.name}?`)) return;

    setActionLoading("quota");
    setActionNotice(null);
    try {
      const res = await fetch(`/api/v1/admin/users/${detail.id}/reset-quota`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Gagal mereset kuota");

      setActionNotice("Kuota penggunaan pengguna berhasil direset.");
      void fetchDetail();
      onRefreshParent();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Gagal mereset kuota");
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative flex max-h-[90vh] w-full max-w-[680px] flex-col rounded-[16px] border border-[var(--border)] bg-[var(--panel)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-[var(--ink)]">
              {t("admin.users.viewDetail")}
            </h3>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Informasi lengkap akun, sesi login aktif, dan telemetri penggunaan
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--ink)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-[var(--muted)]">
              <Loader2 className="h-6 w-6 animate-spin mb-2" />
              <span className="text-xs">{t("admin.users.loading")}</span>
            </div>
          ) : error || !detail ? (
            <div className="rounded-[10px] border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-500">
              {error || "Pengguna tidak ditemukan"}
            </div>
          ) : (
            <>
              {actionNotice && (
                <div className="flex items-center gap-2 rounded-[10px] border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>{actionNotice}</span>
                </div>
              )}

              {/* Profile Card */}
              <div className="flex flex-col gap-4 rounded-[12px] border border-[var(--border)] bg-[var(--hover)]/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--primary)]/10 text-base font-bold text-[var(--primary)]">
                    {detail.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-[var(--ink)]">{detail.name}</span>
                      <span className="rounded-full bg-[var(--primary)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--primary)] uppercase">
                        {detail.role}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--muted)]">{detail.email}</div>
                    <div className="mt-1 font-mono text-[10px] text-[var(--muted)]">ID: {detail.publicId}</div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium border ${
                      detail.status === "active"
                        ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400"
                    }`}
                  >
                    {detail.status === "active" ? t("admin.users.statusActive") : t("admin.users.statusDeactivated")}
                  </span>
                  <span className="rounded-full border border-[var(--border)] bg-[var(--panel)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink)]">
                    {detail.planName || "Free Plan"}
                  </span>
                </div>
              </div>

              {/* Deactivation Reason Notice */}
              {detail.status !== "active" && detail.statusReason && (
                <div className="rounded-[10px] border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
                  <div className="flex items-center gap-1.5 font-semibold mb-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span>{t("admin.users.deactivateReason")}</span>
                  </div>
                  <p className="leading-relaxed">{detail.statusReason}</p>
                </div>
              )}

              {/* Stats Overview */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-[10px] border border-[var(--border)] bg-[var(--panel)] p-3">
                  <div className="text-[10px] text-[var(--muted)] uppercase tracking-wide">Total Token</div>
                  <div className="mt-1 text-base font-bold text-[var(--ink)]">
                    {new Intl.NumberFormat("id-ID").format(
                      detail.stats.totalPromptTokens + detail.stats.totalCompletionTokens
                    )}
                  </div>
                  <div className="text-[10px] text-[var(--muted)]">
                    Prompt: {new Intl.NumberFormat("id-ID").format(detail.stats.totalPromptTokens)}
                  </div>
                </div>

                <div className="rounded-[10px] border border-[var(--border)] bg-[var(--panel)] p-3">
                  <div className="text-[10px] text-[var(--muted)] uppercase tracking-wide">Total Request</div>
                  <div className="mt-1 text-base font-bold text-[var(--ink)]">
                    {new Intl.NumberFormat("id-ID").format(detail.stats.totalRequests)}
                  </div>
                  <div className="text-[10px] text-[var(--muted)]">Pemanggilan model</div>
                </div>

                <div className="rounded-[10px] border border-[var(--border)] bg-[var(--panel)] p-3">
                  <div className="text-[10px] text-[var(--muted)] uppercase tracking-wide">Obrolan & Proyek</div>
                  <div className="mt-1 text-base font-bold text-[var(--ink)]">
                    {detail.stats.chatCount} / {detail.stats.projectCount}
                  </div>
                  <div className="text-[10px] text-[var(--muted)]">Obrolan / Proyek</div>
                </div>

                <div className="rounded-[10px] border border-[var(--border)] bg-[var(--panel)] p-3">
                  <div className="text-[10px] text-[var(--muted)] uppercase tracking-wide">Sesi Aktif</div>
                  <div className="mt-1 text-base font-bold text-emerald-500">
                    {detail.activeSessions.length}
                  </div>
                  <div className="text-[10px] text-[var(--muted)]">Perangkat login</div>
                </div>
              </div>

              {/* Actions Row */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleRevokeSessions}
                  disabled={actionLoading !== null || detail.activeSessions.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-[8px] border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 disabled:opacity-40 transition-colors"
                >
                  {actionLoading === "revoke" ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
                  {t("admin.users.revokeSessions")}
                </button>
                <button
                  type="button"
                  onClick={handleResetQuota}
                  disabled={actionLoading !== null}
                  className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] hover:bg-[var(--hover)] disabled:opacity-40 transition-colors"
                >
                  {actionLoading === "quota" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                  {t("admin.users.resetQuota")}
                </button>
              </div>

              {/* Active Sessions List */}
              <div className="space-y-2 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ink)]">
                  <ShieldAlert className="h-4 w-4 text-[var(--muted)]" />
                  <span>Daftar Sesi Perangkat Aktif ({detail.activeSessions.length})</span>
                </div>
                {detail.activeSessions.length === 0 ? (
                  <p className="text-xs text-[var(--muted)] py-2">Tidak ada sesi login yang sedang aktif.</p>
                ) : (
                  <div className="divide-y divide-[var(--border)]">
                    {detail.activeSessions.map((s) => (
                      <div key={s.id} className="py-2.5 text-xs flex items-center justify-between">
                        <div className="max-w-[420px]">
                          <div className="font-mono text-[11px] text-[var(--ink)] truncate">
                            {s.userAgent || "Unknown User Agent"}
                          </div>
                          <div className="text-[10px] text-[var(--muted)] mt-0.5">
                            IP: {s.ipAddress || "Unknown IP"} • Dibuat: {new Date(s.createdAt).toLocaleString("id-ID")}
                          </div>
                        </div>
                        <span className="text-[10px] text-emerald-500 font-medium">Aktif</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent Audit Logs */}
              {detail.recentAudits.length > 0 && (
                <div className="space-y-2 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ink)]">
                    <History className="h-4 w-4 text-[var(--muted)]" />
                    <span>Jejak Audit Terakhir Pengguna Ini</span>
                  </div>
                  <div className="divide-y divide-[var(--border)]">
                    {detail.recentAudits.map((a) => (
                      <div key={a.id} className="py-2 text-xs flex items-center justify-between">
                        <div>
                          <span className="font-medium text-[var(--ink)] capitalize">{a.action}</span>
                          <span className="text-[var(--muted)] text-[11px] ml-1">oleh {a.actorName || "Admin"}</span>
                        </div>
                        <span className="text-[10px] text-[var(--muted)]">
                          {new Date(a.createdAt).toLocaleString("id-ID")}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-[var(--border)] px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] border border-[var(--border)] px-4 py-2 text-xs font-medium text-[var(--ink)] hover:bg-[var(--hover)]"
          >
            {t("admin.users.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
