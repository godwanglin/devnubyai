"use client";

import React, { useState } from "react";
import { ChevronRight, Trash2 } from "lucide-react";
import { useToast } from "@/providers/toast-provider";
import { ConfirmModal } from "@/components/modals/confirm-modal";
import type { SessionItem } from "./active-sessions-subview";

interface SecurityMainListProps {
  sessions: SessionItem[];
  hasPassword: boolean;
  hasPin: boolean;
  onOpenPasskeys: () => void;
  onOpenPassword: () => void;
  onOpenPin: () => void;
  onNavigateToSessions: () => void;
  onNavigateToHistory: () => void;
}

export function SecurityMainList({
  sessions,
  hasPassword,
  hasPin,
  onOpenPasskeys,
  onOpenPassword,
  onOpenPin,
  onNavigateToSessions,
  onNavigateToHistory,
}: SecurityMainListProps) {
  const { toast } = useToast();
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [showClearChatsConfirm, setShowClearChatsConfirm] = useState(false);
  const [clearingChats, setClearingChats] = useState(false);

  const handleToggleMfa = () => {
    const next = !mfaEnabled;
    setMfaEnabled(next);
    toast(next ? "Autentikasi 2FA diaktifkan" : "Autentikasi 2FA dinonaktifkan");
  };

  const handleClearAllChats = async () => {
    try {
      setClearingChats(true);
      const res = await fetch("/api/v1/user/clear-history", { method: "POST" });
      if (res.ok) {
        toast("Semua riwayat percakapan berhasil dihapus");
        setShowClearChatsConfirm(false);
        window.location.reload();
      } else {
        toast("Gagal menghapus riwayat obrolan");
      }
    } catch {
      toast("Terjadi kesalahan jaringan");
    } finally {
      setClearingChats(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Cara Anda masuk */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-[var(--ink)]">
          Cara Anda masuk
        </h3>
        <div className="rounded-[14px] border border-[var(--border)] bg-[var(--panel-elevated)] divide-y divide-[var(--border)]/70 overflow-hidden">
          {/* Kunci sandi dan kunci keamanan */}
          <button
            type="button"
            onClick={onOpenPasskeys}
            className="w-full p-4 flex items-center justify-between gap-4 text-left hover:bg-[var(--hover)]/60 transition-colors cursor-pointer group"
          >
            <div className="min-w-0 flex-1 pr-2">
              <p className="text-sm font-semibold text-[var(--ink)] group-hover:text-[var(--accent)] transition-colors">
                Kunci sandi dan kunci keamanan
              </p>
              <p className="text-xs text-[var(--muted)] mt-0.5 leading-relaxed">
                Gunakan pengganti kata sandi yang tahan terhadap phishing
              </p>
            </div>
            <div className="flex items-center gap-1 text-xs font-medium text-[var(--muted)] group-hover:text-[var(--ink)] shrink-0 transition-colors">
              <span>Tambahkan</span>
              <ChevronRight className="w-4 h-4" />
            </div>
          </button>

          {/* Kata sandi */}
          <button
            type="button"
            onClick={onOpenPassword}
            className="w-full p-4 flex items-center justify-between gap-4 text-left hover:bg-[var(--hover)]/60 transition-colors cursor-pointer group"
          >
            <div className="min-w-0 flex-1 pr-2">
              <p className="text-sm font-semibold text-[var(--ink)] group-hover:text-[var(--accent)] transition-colors">
                Kata sandi
              </p>
              <p className="text-xs text-[var(--muted)] mt-0.5 leading-relaxed">
                Kelola kata sandi yang Anda gunakan untuk masuk
              </p>
            </div>
            <div className="flex items-center gap-1 text-xs font-medium text-[var(--muted)] group-hover:text-[var(--ink)] shrink-0 transition-colors">
              <span>{hasPassword ? "Ubah" : "Tambahkan"}</span>
              <ChevronRight className="w-4 h-4" />
            </div>
          </button>
        </div>
      </section>

      {/* PIN akun */}
      <section>
        <div className="rounded-[14px] border border-[var(--border)] bg-[var(--panel-elevated)] overflow-hidden">
          <button
            type="button"
            onClick={onOpenPin}
            className="w-full p-4 flex items-center justify-between gap-4 text-left hover:bg-[var(--hover)]/60 transition-colors cursor-pointer group"
          >
            <div className="min-w-0 flex-1 pr-2">
              <p className="text-sm font-semibold text-[var(--ink)] group-hover:text-[var(--accent)] transition-colors">
                PIN akun
              </p>
              <p className="text-xs text-[var(--muted)] mt-0.5 leading-relaxed">
                Atur cara mengakses obrolan Anda yang terkunci.
              </p>
            </div>
            <div className="flex items-center gap-1 text-xs font-medium text-[var(--muted)] group-hover:text-[var(--ink)] shrink-0 transition-colors">
              {hasPin && <span className="text-[11px] font-semibold text-emerald-500 mr-1">Aktif</span>}
              <ChevronRight className="w-4 h-4" />
            </div>
          </button>
        </div>
      </section>

      {/* 2. Autentikasi multifaktor (MFA) */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-[var(--ink)]">
          Autentikasi multifaktor (MFA)
        </h3>
        <div className="rounded-[14px] border border-[var(--border)] bg-[var(--panel-elevated)] overflow-hidden">
          <div className="p-4 flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1 pr-2">
              <p className="text-sm font-semibold text-[var(--ink)]">
                Aplikasi autentikator
              </p>
              <p className="text-xs text-[var(--muted)] mt-0.5 leading-relaxed">
                Gunakan kode sekali pakai dari aplikasi autentikator
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={mfaEnabled}
              onClick={handleToggleMfa}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                mfaEnabled ? "bg-[var(--accent)]" : "bg-neutral-700/80"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                  mfaEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>
      </section>

      {/* 3. Sesi */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-[var(--ink)]">
          Sesi
        </h3>
        <div className="rounded-[14px] border border-[var(--border)] bg-[var(--panel-elevated)] divide-y divide-[var(--border)]/70 overflow-hidden">
          {/* Sesi aktif */}
          <button
            type="button"
            onClick={onNavigateToSessions}
            className="w-full p-4 flex items-center justify-between gap-4 text-left hover:bg-[var(--hover)]/60 transition-colors cursor-pointer group"
          >
            <div className="min-w-0 flex-1 pr-2">
              <p className="text-sm font-semibold text-[var(--ink)] group-hover:text-[var(--accent)] transition-colors">
                Sesi aktif
              </p>
              <p className="text-xs text-[var(--muted)] mt-0.5 leading-relaxed">
                Lihat semua perangkat yang telah mengakses akun Anda. Anda dapat meninjau sesi aktif, menghapus perangkat tepercaya, atau menggunakan Keluar dari semua perangkat untuk mengakhiri semua sesi.
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink)] group-hover:text-[var(--accent)] shrink-0 transition-colors">
              <span className="px-2 py-0.5 rounded-full bg-[var(--hover)] text-xs font-mono">
                {sessions.length}
              </span>
              <ChevronRight className="w-4 h-4 text-[var(--muted)] group-hover:text-[var(--accent)]" />
            </div>
          </button>

          {/* Riwayat keamanan */}
          <button
            type="button"
            onClick={onNavigateToHistory}
            className="w-full p-4 flex items-center justify-between gap-4 text-left hover:bg-[var(--hover)]/60 transition-colors cursor-pointer group"
          >
            <div className="min-w-0 flex-1 pr-2">
              <p className="text-sm font-semibold text-[var(--ink)] group-hover:text-[var(--accent)] transition-colors">
                Riwayat keamanan
              </p>
              <p className="text-xs text-[var(--muted)] mt-0.5 leading-relaxed">
                Tinjau aktivitas login dan perubahan pada pengaturan keamanan Anda.
              </p>
            </div>
            <div className="flex items-center text-[var(--muted)] group-hover:text-[var(--ink)] shrink-0 transition-colors">
              <ChevronRight className="w-4 h-4" />
            </div>
          </button>
        </div>
      </section>

      {/* Zona Bahaya - Hapus Riwayat Obrolan */}
      <section className="pt-2">
        <div className="p-4 rounded-[14px] border border-red-500/20 bg-red-500/5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-red-500 flex items-center gap-1.5">
              <Trash2 className="w-4 h-4" />
              <span>Hapus Semua Riwayat Percakapan</span>
            </h4>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              Menghapus seluruh percakapan, lampiran, dan pesan kamu secara permanen.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowClearChatsConfirm(true)}
            className="px-3.5 py-2 rounded-[8px] bg-red-500 hover:bg-red-600 text-white text-xs font-semibold transition-colors cursor-pointer shrink-0 self-start sm:self-auto"
          >
            Hapus Riwayat
          </button>
        </div>
      </section>

      {/* Confirm Clear All Chats */}
      <ConfirmModal
        isOpen={showClearChatsConfirm}
        onClose={() => setShowClearChatsConfirm(false)}
        onConfirm={handleClearAllChats}
        title="Hapus Semua Riwayat Percakapan?"
        description="Tindakan ini permanen. Semua percakapan yang pernah kamu buat akan dihapus dan tidak dapat dipulihkan kembali."
        confirmLabel="Ya, Hapus Semua"
        cancelLabel="Batal"
        variant="danger"
        loading={clearingChats}
      />
    </div>
  );
}
