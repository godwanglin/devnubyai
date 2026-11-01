"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Shield,
  KeyRound,
  Lock,
  Smartphone,
  Laptop,
  Terminal,
  LogOut,
  Trash2,
  RefreshCw,
  Eye,
  EyeOff,
} from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { parseDeviceUa } from "@/lib/auth/device";
import { Input } from "@/components/ui/input";
import { ConfirmModal } from "@/components/modals/confirm-modal";

interface SessionItem {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

export function SecurityTab() {
  const { t } = useI18n();
  const { toast } = useToast();

  // Sessions state
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [revokingSessions, setRevokingSessions] = useState(false);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);

  // Password state
  const [hasPassword, setHasPassword] = useState<boolean>(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  // PIN state
  const [hasPin, setHasPin] = useState<boolean>(false);
  const [pinValue, setPinValue] = useState("");
  const [showPinForm, setShowPinForm] = useState(false);
  const [savingPin, setSavingPin] = useState(false);

  // Clear chat history state
  const [showClearChatsConfirm, setShowClearChatsConfirm] = useState(false);
  const [clearingChats, setClearingChats] = useState(false);

  // Load sessions helper for post-actions
  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/user/sessions");
      if (res.ok) {
        const json = await res.json();
        setSessions(json.data?.sessions || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    fetch("/api/v1/user/sessions")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (active && json?.data?.sessions) {
          setSessions(json.data.sessions);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingSessions(false);
      });

    fetch("/api/v1/user/password")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (active && json?.data) {
          setHasPassword(Boolean(json.data.hasPassword));
        }
      })
      .catch(() => {});

    fetch("/api/v1/user/pin")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (active && json?.data) {
          setHasPin(Boolean(json.data.hasPin));
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  // Handle revoke other sessions
  const handleRevokeOtherSessions = async () => {
    try {
      setRevokingSessions(true);
      const res = await fetch("/api/v1/user/sessions", { method: "DELETE" });
      if (res.ok) {
        toast("Semua sesi perangkat lain berhasil dicabut");
        setShowRevokeConfirm(false);
        await loadSessions();
      } else {
        toast("Gagal mencabut sesi lain");
      }
    } catch {
      toast("Terjadi kesalahan jaringan");
    } finally {
      setRevokingSessions(false);
    }
  };

  // Handle password change
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast("Password baru minimal 8 karakter");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast("Konfirmasi password tidak cocok");
      return;
    }

    try {
      setSavingPassword(true);
      const res = await fetch("/api/v1/user/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast("Password berhasil diperbarui");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setShowPasswordForm(false);
        setHasPassword(true);
      } else {
        toast(json.error?.message || "Gagal memperbarui password");
      }
    } catch {
      toast("Terjadi kesalahan jaringan");
    } finally {
      setSavingPassword(false);
    }
  };

  // Handle PIN save
  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4}$/.test(pinValue)) {
      toast("PIN harus berupa 4 digit angka");
      return;
    }

    try {
      setSavingPin(true);
      const res = await fetch("/api/v1/user/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pinValue }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast("PIN obrolan berhasil diatur");
        setPinValue("");
        setShowPinForm(false);
        setHasPin(true);
      } else {
        toast(json.error?.message || "Gagal mengatur PIN");
      }
    } catch {
      toast("Terjadi kesalahan jaringan");
    } finally {
      setSavingPin(false);
    }
  };

  // Handle clear all chats
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

  const otherSessionsCount = sessions.filter((s) => !s.isCurrent).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--ink)]">
          {t("settings.securityTab")}
        </h2>
        <p className="text-xs text-[var(--muted)] mt-0.5">
          Kelola sesi aktif, keamanan kata sandi, PIN obrolan, dan privasi akun kamu.
        </p>
      </div>

      {/* Sesi & Perangkat Aktif */}
      <section className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink)] flex items-center gap-2">
              <Shield className="w-4 h-4 text-[var(--accent)]" />
              <span>Sesi & Perangkat Aktif</span>
            </h3>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              Daftar perangkat yang saat ini memiliki akses login ke akunmu.
            </p>
          </div>
          {otherSessionsCount > 0 && (
            <button
              type="button"
              onClick={() => setShowRevokeConfirm(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-red-500/10 hover:bg-red-500/20 text-red-500 text-xs font-semibold transition-colors cursor-pointer self-start sm:self-auto"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Cabut Sesi Lain ({otherSessionsCount})</span>
            </button>
          )}
        </div>

        <div className="space-y-2 rounded-[12px] border border-[var(--border)] bg-[var(--panel-elevated)] p-3">
          {loadingSessions ? (
            <div className="py-6 text-center text-xs text-[var(--muted)] flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-[var(--muted)]" />
              <span>Memuat sesi aktif...</span>
            </div>
          ) : sessions.length === 0 ? (
            <div className="py-6 text-center text-xs text-[var(--muted)]">
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
                  className="flex items-start sm:items-center justify-between gap-3 p-2.5 rounded-[8px] border border-[var(--border)]/60 bg-[var(--panel)] min-w-0"
                >
                  <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
                    <div className="w-8 h-8 rounded-[8px] bg-[var(--hover)] grid place-items-center shrink-0 mt-0.5 sm:mt-0 text-[var(--muted)]">
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
                        <span className="font-semibold text-xs sm:text-sm text-[var(--ink)]">
                          {device} • {browser}
                        </span>
                        {s.isCurrent && (
                          <span className="px-1.5 py-0.5 rounded-[4px] bg-emerald-500/15 text-emerald-500 text-[10px] font-bold shrink-0">
                            Sesi Ini
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--muted)] truncate mt-0.5">
                        IP: <span className="font-mono text-[var(--ink)]">{s.ipAddress || "Unknown"}</span>
                        {" • "}
                        <span>
                          {new Date(s.createdAt).toLocaleDateString("id-ID", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Keamanan Sandi */}
      <section className="space-y-3 pt-4 border-t border-[var(--border)]">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink)] flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-[var(--muted)]" />
              <span>Kata Sandi Akun</span>
            </h3>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              {hasPassword
                ? "Akun kamu memiliki kata sandi aktif untuk masuk langsung dengan email."
                : "Kamu belum mengatur kata sandi untuk akun ini."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowPasswordForm((v) => !v)}
            className="px-3 py-1.5 rounded-[8px] border border-[var(--border)] hover:bg-[var(--hover)] text-xs font-semibold text-[var(--ink)] transition-colors cursor-pointer shrink-0"
          >
            {showPasswordForm ? "Tutup" : hasPassword ? "Ubah Sandi" : "Atur Sandi"}
          </button>
        </div>

        {showPasswordForm && (
          <form
            onSubmit={handleChangePassword}
            className="space-y-3 p-3.5 rounded-[12px] border border-[var(--border)] bg-[var(--panel-elevated)] max-w-md"
          >
            {hasPassword && (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-[var(--muted)]">Kata Sandi Saat Ini</label>
                <Input
                  type={showPass ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Masukkan kata sandi lama"
                  required
                />
              </div>
            )}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[var(--muted)]">Kata Sandi Baru</label>
              <Input
                type={showPass ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimal 8 karakter"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[var(--muted)]">Konfirmasi Kata Sandi Baru</label>
              <Input
                type={showPass ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Ulangi kata sandi baru"
                required
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                className="text-xs text-[var(--muted)] hover:text-[var(--ink)] inline-flex items-center gap-1 cursor-pointer"
              >
                {showPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{showPass ? "Sembunyikan" : "Tampilkan sandi"}</span>
              </button>
              <button
                type="submit"
                disabled={savingPassword}
                className="px-4 py-2 rounded-[8px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-xs font-semibold text-[var(--accent-text)] transition-colors cursor-pointer disabled:opacity-50"
              >
                {savingPassword ? "Menyimpan..." : "Simpan Sandi"}
              </button>
            </div>
          </form>
        )}
      </section>

      {/* Kunci Obrolan (PIN) */}
      <section className="space-y-3 pt-4 border-t border-[var(--border)]">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink)] flex items-center gap-2">
              <Lock className="w-4 h-4 text-[var(--muted)]" />
              <span>PIN Privasi Obrolan</span>
            </h3>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              {hasPin
                ? "PIN obrolan aktif. Obrolan privat dikunci dan memerlukan PIN 4 digit untuk dibuka."
                : "Kunci obrolan tertentu dengan 4 digit PIN agar privasi kamu tetap aman."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowPinForm((v) => !v)}
            className="px-3 py-1.5 rounded-[8px] border border-[var(--border)] hover:bg-[var(--hover)] text-xs font-semibold text-[var(--ink)] transition-colors cursor-pointer shrink-0"
          >
            {showPinForm ? "Tutup" : hasPin ? "Ganti PIN" : "Atur PIN"}
          </button>
        </div>

        {showPinForm && (
          <form
            onSubmit={handleSavePin}
            className="space-y-3 p-3.5 rounded-[12px] border border-[var(--border)] bg-[var(--panel-elevated)] max-w-sm"
          >
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[var(--muted)]">PIN 4 Digit</label>
              <Input
                type="password"
                maxLength={4}
                pattern="[0-9]{4}"
                inputMode="numeric"
                value={pinValue}
                onChange={(e) => setPinValue(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="4 digit angka (mis. 1234)"
                required
              />
            </div>
            <button
              type="submit"
              disabled={savingPin || pinValue.length !== 4}
              className="px-4 py-2 rounded-[8px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-xs font-semibold text-[var(--accent-text)] transition-colors cursor-pointer disabled:opacity-50"
            >
              {savingPin ? "Menyimpan..." : "Simpan PIN"}
            </button>
          </form>
        )}
      </section>

      {/* Zona Bahaya - Privasi Riwayat Obrolan */}
      <section className="space-y-3 pt-4 border-t border-red-500/20">
        <div className="p-3.5 rounded-[12px] border border-red-500/20 bg-red-500/5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
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

      {/* Confirm Revoke Other Sessions */}
      <ConfirmModal
        isOpen={showRevokeConfirm}
        onClose={() => setShowRevokeConfirm(false)}
        onConfirm={handleRevokeOtherSessions}
        title="Cabut Semua Sesi Lain?"
        description="Kamu akan dikeluarkan dari semua perangkat lain. Sesi pada peramban saat ini akan tetap aktif."
        confirmLabel="Cabut Sesi Lain"
        cancelLabel="Batal"
        variant="danger"
        loading={revokingSessions}
      />

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
