"use client";

import React, { useState } from "react";
import { KeyRound, Lock, AlertTriangle, Loader2 } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
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
  // yyyy-mm-dd for the date input; empty = plan never expires
  const [planExpiresOn, setPlanExpiresOn] = useState(user.planExpiresAt?.slice(0, 10) ?? "");
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
        planExpiresAt: planExpiresOn ? new Date(`${planExpiresOn}T23:59:59.000Z`).toISOString() : null,
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
    <Modal
      isOpen={Boolean(user)}
      onClose={onClose}
      title={t("admin.users.editUser")}
      description={`ID: ${user.publicId}`}
      maxWidth="xl"
    >
      <form onSubmit={handleSubmit} className="max-h-[75vh] overflow-y-auto pr-1 space-y-4">
        {error && (
          <div className="rounded-[10px] border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-500">
            {error}
          </div>
        )}

        {/* Name & Email */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--muted)]">Nama Lengkap</label>
            <Input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--muted)]">Email</label>
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>

        {/* Role & Plan */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--muted)]">Peran (Role)</label>
            <CustomSelect
              value={role}
              onChange={setRole}
              options={[
                { value: "user", label: "User" },
                { value: "admin", label: "Administrator" },
              ]}
              className="w-full"
              size="md"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--muted)]">Paket Langganan</label>
            <CustomSelect
              value={planId}
              onChange={setPlanId}
              options={[
                { value: "none", label: "Tanpa Paket (Default)" },
                ...plans.map((p) => ({
                  value: p.id,
                  label: `${p.name} (${p.slug})`,
                })),
              ]}
              className="w-full"
              size="md"
            />
          </div>
        </div>

        {/* Plan expiry */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--muted)]">
            {t("admin.users.planExpiresAt")}
          </label>
          <Input
            type="date"
            value={planExpiresOn}
            onChange={(e) => setPlanExpiresOn(e.target.value)}
          />
          <p className="text-[11px] text-[var(--muted)]">{t("admin.users.planExpiresAtHint")}</p>
        </div>

        {/* Status & Reason */}
        <div className="space-y-3 rounded-[12px] border border-[var(--border)] bg-[var(--hover)]/30 p-3.5">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--muted)]">Status Akun</label>
            <CustomSelect
              value={status}
              onChange={setStatus}
              options={[
                { value: "active", label: "Aktif (Active)" },
                { value: "deactivated", label: "Dinonaktifkan (Deactivated)" },
                { value: "suspended", label: "Ditangguhkan (Suspended)" },
              ]}
              className="w-full"
              size="md"
            />
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
                className="w-full rounded-[8px] border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-xs text-[var(--ink)] placeholder:text-[var(--muted)]/70 focus:border-[var(--accent)]/60 focus:outline-none"
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
            <span>Kredensial &amp; Keamanan</span>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-[var(--muted)]">
              {t("admin.users.passwordLabel")}
            </label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t("admin.users.passwordPlaceholder")}
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
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={isSubmitting}
          >
            {t("admin.users.cancel")}
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={isSubmitting}
          >
            {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isSubmitting ? t("admin.users.saving") : t("admin.users.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
