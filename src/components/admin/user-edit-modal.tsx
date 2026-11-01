"use client";

import React, { useState } from "react";
import { X, KeyRound, Lock, AlertTriangle, Loader2 } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import type { AdminUserListItemDto } from "@/lib/users/types";

interface PlanOption {
  id: string;
  name: string;
  slug: string;
}

interface UserEditModalProps {
  user: AdminUserListItemDto;
  plans: PlanOption[];
  onClose: () => void;
  onSuccess: (updated: AdminUserListItemDto) => void;
}

export function UserEditModal({ user, plans, onClose, onSuccess }: UserEditModalProps) {
  const { t } = useI18n();

  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status);
  const [statusReason, setStatusReason] = useState(user.statusReason || "");
  const [planId, setPlanId] = useState(user.planId || "none");
  const [newPassword, setNewPassword] = useState("");
  const [resetChatPin, setResetChatPin] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDeactivating = status !== "active";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const payload: Record<string, unknown> = {
        name,
        email,
        role,
        status,
        planId: planId === "none" ? null : planId,
        statusReason: isDeactivating ? statusReason : null,
      };

      if (newPassword.trim()) {
        payload.newPassword = newPassword.trim();
      }

      if (resetChatPin) {
        payload.resetChatPin = true;
      }

      const res = await fetch(`/api/v1/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Gagal memperbarui pengguna");
      }

      onSuccess(data.data.user);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative flex max-h-[90vh] w-full max-w-[560px] flex-col rounded-[16px] border border-[var(--border)] bg-[var(--panel)] shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-[var(--ink)]">
              {t("admin.users.editUser")}
            </h3>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              ID: <span className="font-mono">{user.publicId}</span>
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

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {error && (
            <div className="rounded-[10px] border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-500">
              {error}
            </div>
          )}

          {/* Name & Email */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--muted)]">Nama Lengkap</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-[8px] border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--primary)] focus:outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--muted)]">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-[8px] border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--primary)] focus:outline-none"
              />
            </div>
          </div>

          {/* Role & Plan */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--muted)]">Peran (Role)</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--primary)] focus:outline-none"
              >
                <option value="user">User</option>
                <option value="admin">Administrator</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--muted)]">Paket Langganan</label>
              <select
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                className="w-full rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--primary)] focus:outline-none"
              >
                <option value="none">Tanpa Paket (Default)</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.slug})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Status & Reason */}
          <div className="space-y-3 rounded-[12px] border border-[var(--border)] bg-[var(--hover)]/30 p-3.5">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--muted)]">Status Akun</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--primary)] focus:outline-none"
              >
                <option value="active">Aktif (Active)</option>
                <option value="deactivated">Dinonaktifkan (Deactivated)</option>
                <option value="suspended">Ditangguhkan (Suspended)</option>
              </select>
            </div>

            {isDeactivating && (
              <div className="space-y-1.5 animate-in fade-in duration-150">
                <div className="flex items-center gap-1.5 text-xs font-medium text-amber-500">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span>{t("admin.users.deactivateReason")}</span>
                </div>
                <textarea
                  rows={2}
                  value={statusReason}
                  onChange={(e) => setStatusReason(e.target.value)}
                  placeholder={t("admin.users.deactivateReasonPlaceholder")}
                  className="w-full rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-xs text-[var(--ink)] placeholder:text-[var(--placeholder)] focus:border-[var(--primary)] focus:outline-none"
                />
                <p className="text-[11px] text-[var(--muted)]">
                  *Menonaktifkan akun akan otomatis mencabut (force logout) seluruh sesi aktif pengguna.
                </p>
              </div>
            )}
          </div>

          {/* Security & Credentials */}
          <div className="space-y-3 rounded-[12px] border border-[var(--border)] bg-[var(--hover)]/30 p-3.5">
            <div className="flex items-center gap-2 text-xs font-medium text-[var(--ink)]">
              <KeyRound className="h-4 w-4 text-[var(--muted)]" />
              <span>Kredensial & Keamanan</span>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-[var(--muted)]">
                {t("admin.users.passwordLabel")}
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t("admin.users.passwordPlaceholder")}
                className="w-full rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--placeholder)] focus:border-[var(--primary)] focus:outline-none"
              />
            </div>

            <label className="flex items-center gap-2.5 pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={resetChatPin}
                onChange={(e) => setResetChatPin(e.target.checked)}
                className="rounded border-[var(--border)] text-[var(--primary)] focus:ring-0"
              />
              <div className="text-xs">
                <span className="font-medium text-[var(--ink)] flex items-center gap-1">
                  <Lock className="h-3 w-3" />
                  {t("admin.users.resetPinLabel")}
                </span>
                <span className="text-[11px] text-[var(--muted)] block">
                  {t("admin.users.resetPinDesc")}
                </span>
              </div>
            </label>
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[var(--border)]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-[8px] border border-[var(--border)] px-4 py-2 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--hover)]"
            >
              {t("admin.users.cancel")}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-[8px] bg-[var(--primary)] px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isSubmitting ? t("admin.users.saving") : t("admin.users.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
