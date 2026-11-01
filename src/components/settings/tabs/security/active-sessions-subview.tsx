"use client";

import React, { useState } from "react";
import {
  ArrowLeft,
  Smartphone,
  Laptop,
  Terminal,
  LogOut,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useToast } from "@/providers/toast-provider";
import { parseDeviceUa } from "@/lib/auth/device";
import { ConfirmModal } from "@/components/modals/confirm-modal";

export interface SessionItem {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

interface ActiveSessionsSubviewProps {
  sessions: SessionItem[];
  loading: boolean;
  onBack: () => void;
  onRefresh: () => Promise<void>;
}

export function ActiveSessionsSubview({
  sessions,
  loading,
  onBack,
  onRefresh,
}: ActiveSessionsSubviewProps) {
  const { toast } = useToast();
  const [revokingAll, setRevokingAll] = useState(false);
  const [showRevokeAllModal, setShowRevokeAllModal] = useState(false);
  const [targetRevokeSession, setTargetRevokeSession] = useState<SessionItem | null>(null);
  const [revokingSingle, setRevokingSingle] = useState(false);

  const otherSessions = sessions.filter((s) => !s.isCurrent);

  const handleRevokeAllOther = async () => {
    try {
      setRevokingAll(true);
      const res = await fetch("/api/v1/user/sessions", { method: "DELETE" });
      if (res.ok) {
        toast("Semua sesi perangkat lain berhasil dicabut");
        setShowRevokeAllModal(false);
        await onRefresh();
      } else {
        toast("Gagal mencabut sesi lain");
      }
    } catch {
      toast("Terjadi kesalahan jaringan");
    } finally {
      setRevokingAll(false);
    }
  };

  const handleRevokeSingle = async () => {
    if (!targetRevokeSession) return;
    try {
      setRevokingSingle(true);
      const res = await fetch(`/api/v1/user/sessions?sessionId=${targetRevokeSession.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast("Sesi perangkat berhasil dihentikan");
        setTargetRevokeSession(null);
        await onRefresh();
      } else {
        toast("Gagal menghentikan sesi");
      }
    } catch {
      toast("Terjadi kesalahan jaringan");
    } finally {
      setRevokingSingle(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header with back navigation */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-[var(--muted)] hover:text-[var(--ink)] transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Kembali ke Keamanan</span>
        </button>

        {otherSessions.length > 0 && (
          <button
            type="button"
            onClick={() => setShowRevokeAllModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-red-500/10 hover:bg-red-500/20 text-red-500 text-xs font-semibold transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Cabut Semua Sesi Lain ({otherSessions.length})</span>
          </button>
        )}
      </div>

      <div>
        <h3 className="text-base sm:text-lg font-semibold text-[var(--ink)]">
          Sesi Aktif ({sessions.length})
        </h3>
        <p className="text-xs text-[var(--muted)] mt-1 leading-relaxed">
          Semua perangkat yang sedang masuk ke akun Devnuby kamu. Kamu dapat meninjau detail perangkat atau keluar dari sesi yang tidak kamu kenali.
        </p>
      </div>

      <div className="space-y-2.5">
        {loading ? (
          <div className="py-12 text-center text-xs text-[var(--muted)] flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-[var(--muted)]" />
            <span>Memuat sesi aktif...</span>
          </div>
        ) : sessions.length === 0 ? (
          <div className="p-8 text-center text-xs text-[var(--muted)] rounded-[12px] border border-[var(--border)] bg-[var(--panel-elevated)]">
            Tidak ada sesi aktif ditemukan.
          </div>
        ) : (
          sessions.map((s) => {
            const { device, browser } = parseDeviceUa(s.userAgent);
            const isMobile = device === "Android" || device === "iPhone" || device === "iPad";
            const isCli = browser === "CLI / Script";

            return (
              <div
                key={s.id}
                className="flex items-start sm:items-center justify-between gap-3 p-3.5 rounded-[12px] border border-[var(--border)] bg-[var(--panel-elevated)] hover:border-[var(--glass-border)] transition-colors"
              >
                <div className="flex items-start sm:items-center gap-3.5 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-[10px] bg-[var(--hover)] grid place-items-center shrink-0 mt-0.5 sm:mt-0 text-[var(--muted)]">
                    {isMobile ? (
                      <Smartphone className="w-4 h-4 text-[var(--accent)]" />
                    ) : isCli ? (
                      <Terminal className="w-4 h-4 text-amber-500" />
                    ) : (
                      <Laptop className="w-4 h-4 text-[var(--ink)]" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 truncate">
                      <span className="font-semibold text-xs sm:text-sm text-[var(--ink)] truncate">
                        {device} • {browser}
                      </span>
                      {s.isCurrent && (
                        <span className="px-2 py-0.5 rounded-[4px] bg-emerald-500/15 text-emerald-500 text-[10px] font-bold shrink-0">
                          Sesi Ini
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] text-[var(--muted)] truncate mt-1">
                      IP: <span className="font-mono text-[var(--ink)]">{s.ipAddress || "Unknown"}</span>
                      {" • "}
                      <span>
                        Masuk:{" "}
                        {new Date(s.createdAt).toLocaleDateString("id-ID", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>

                    {s.userAgent && (
                      <div className="text-[9px] font-mono text-[var(--muted)]/60 truncate mt-0.5" title={s.userAgent}>
                        {s.userAgent}
                      </div>
                    )}
                  </div>
                </div>

                {!s.isCurrent && (
                  <button
                    type="button"
                    onClick={() => setTargetRevokeSession(s)}
                    className="p-2 rounded-[8px] hover:bg-red-500/10 text-[var(--muted)] hover:text-red-500 transition-colors cursor-pointer shrink-0"
                    title="Keluarkan sesi ini"
                    aria-label="Keluarkan sesi ini"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Confirm Revoke All Modal */}
      <ConfirmModal
        isOpen={showRevokeAllModal}
        onClose={() => setShowRevokeAllModal(false)}
        onConfirm={handleRevokeAllOther}
        title="Cabut Semua Sesi Lain?"
        description="Semua sesi di perangkat lain akan diakhiri seketika. Kamu hanya akan tetap masuk di peramban saat ini."
        confirmLabel="Ya, Cabut Sesi Lain"
        cancelLabel="Batal"
        variant="danger"
        loading={revokingAll}
      />

      {/* Confirm Revoke Single Modal */}
      <ConfirmModal
        isOpen={Boolean(targetRevokeSession)}
        onClose={() => setTargetRevokeSession(null)}
        onConfirm={handleRevokeSingle}
        title="Keluarkan Sesi Perangkat Ini?"
        description="Akses login pada perangkat ini akan langsung dicabut dan pengguna harus masuk ulang."
        confirmLabel="Keluarkan Perangkat"
        cancelLabel="Batal"
        variant="danger"
        loading={revokingSingle}
      />
    </div>
  );
}
