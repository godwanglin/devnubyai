"use client";

import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { useToast } from "@/providers/toast-provider";

interface PasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  hasPassword: boolean;
  onSuccess: () => void;
}

export function PasswordModal({
  isOpen,
  onClose,
  hasPassword,
  onSuccess,
}: PasswordModalProps) {
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast("Kata sandi baru minimal 8 karakter");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast("Konfirmasi kata sandi tidak cocok");
      return;
    }

    try {
      setSaving(true);
      const res = await fetch("/api/v1/user/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast("Kata sandi berhasil diperbarui");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        onSuccess();
        onClose();
      } else {
        toast(json.error?.message || "Gagal memperbarui kata sandi");
      }
    } catch {
      toast("Terjadi kesalahan jaringan");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={hasPassword ? "Ubah Kata Sandi" : "Tambahkan Kata Sandi"}
      description="Gunakan minimal 8 karakter dengan kombinasi angka dan huruf untuk keamanan maksimal."
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4 pt-1">
        {hasPassword && (
          <div className="space-y-1">
            <label className="text-xs font-semibold text-[var(--muted)]">
              Kata Sandi Saat Ini
            </label>
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
          <label className="text-xs font-semibold text-[var(--muted)]">
            Kata Sandi Baru
          </label>
          <Input
            type={showPass ? "text" : "password"}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Minimal 8 karakter"
            required
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-[var(--muted)]">
            Konfirmasi Kata Sandi Baru
          </label>
          <Input
            type={showPass ? "text" : "password"}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Ketik ulang kata sandi baru"
            required
          />
        </div>

        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={() => setShowPass((v) => !v)}
            className="text-xs text-[var(--muted)] hover:text-[var(--ink)] inline-flex items-center gap-1.5 cursor-pointer"
          >
            {showPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            <span>{showPass ? "Sembunyikan" : "Tampilkan sandi"}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-[8px] border border-[var(--border)] hover:bg-[var(--hover)] text-xs font-semibold text-[var(--ink)] transition-colors cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-[8px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-xs font-semibold text-[var(--accent-text)] transition-colors cursor-pointer disabled:opacity-50"
            >
              {saving ? "Menyimpan..." : "Simpan"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
