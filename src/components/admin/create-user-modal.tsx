"use client";

import React, { useState } from "react";
import { Loader2 } from "lucide-react";
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
    <Modal
      isOpen={true}
      onClose={onClose}
      title={t("admin.users.createTitle")}
      description="Tambahkan pengguna baru dan tentukan peran serta paket langganan awal"
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} className="max-h-[75vh] overflow-y-auto pr-1 space-y-4">
        {error && (
          <div className="rounded-[10px] border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-500">
            {error}
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--muted)]">Nama Lengkap</label>
          <Input
            type="text"
            required
            placeholder="Contoh: Denis Prasetio"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--muted)]">Email</label>
          <Input
            type="email"
            required
            placeholder="nama@domain.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--muted)]">
            {t("admin.users.initialPassword")}
          </label>
          <Input
            type="password"
            placeholder={t("admin.users.initialPasswordPlaceholder")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

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
                  label: p.name,
                })),
              ]}
              className="w-full"
              size="md"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--muted)]">Status Awal</label>
          <CustomSelect
            value={status}
            onChange={setStatus}
            options={[
              { value: "active", label: "Aktif" },
              { value: "deactivated", label: "Dinonaktifkan" },
            ]}
            className="w-full"
            size="md"
          />
        </div>

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
            {t("admin.users.addUser")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
