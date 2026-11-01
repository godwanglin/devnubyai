"use client";

import React, { useState } from "react";
import { X, UserPlus, Loader2 } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import type { AdminUserListItemDto } from "@/lib/users/types";

interface PlanOption {
  id: string;
  name: string;
  slug: string;
}

interface CreateUserModalProps {
  plans: PlanOption[];
  onClose: () => void;
  onSuccess: (created: AdminUserListItemDto) => void;
}

export function CreateUserModal({ plans, onClose, onSuccess }: CreateUserModalProps) {
  const { t } = useI18n();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [status, setStatus] = useState("active");
  const [planId, setPlanId] = useState("none");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        email: email.trim(),
        role,
        status,
        planId: planId === "none" ? null : planId,
      };

      if (password.trim()) {
        payload.password = password.trim();
      }

      const res = await fetch("/api/v1/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Gagal membuat pengguna");
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
      <div className="relative flex max-h-[90vh] w-full max-w-[500px] flex-col rounded-[16px] border border-[var(--border)] bg-[var(--panel)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="rounded-[8px] bg-[var(--primary)]/10 p-1.5 text-[var(--primary)]">
              <UserPlus className="h-4 w-4" />
            </div>
            <h3 className="text-base font-semibold text-[var(--ink)]">
              {t("admin.users.createTitle")}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--ink)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {error && (
            <div className="rounded-[10px] border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-500">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--muted)]">Nama Lengkap</label>
            <input
              type="text"
              required
              placeholder="Contoh: Denis Prasetio"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-[8px] border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--placeholder)] focus:border-[var(--primary)] focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--muted)]">Email</label>
            <input
              type="email"
              required
              placeholder="nama@domain.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-[8px] border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--placeholder)] focus:border-[var(--primary)] focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--muted)]">
              {t("admin.users.initialPassword")}
            </label>
            <input
              type="password"
              placeholder={t("admin.users.initialPasswordPlaceholder")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-[8px] border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--placeholder)] focus:border-[var(--primary)] focus:outline-none"
            />
          </div>

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
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--muted)]">Status Awal</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--primary)] focus:outline-none"
            >
              <option value="active">Aktif</option>
              <option value="deactivated">Dinonaktifkan</option>
            </select>
          </div>

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
              {t("admin.users.addUser")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
