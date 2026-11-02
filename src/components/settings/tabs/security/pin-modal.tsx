"use client";

import React, { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { useToast } from "@/providers/toast-provider";

interface PinModalProps {
  isOpen: boolean;
  onClose: () => void;
  hasPin: boolean;
  onSuccess: () => void;
}

export function PinModal({
  isOpen,
  onClose,
  hasPin,
  onSuccess,
}: PinModalProps) {
  const { toast } = useToast();
  const [currentPinValue, setCurrentPinValue] = useState("");
  const [pinValue, setPinValue] = useState("");
  const [confirmPinValue, setConfirmPinValue] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4}$/.test(pinValue)) {
      toast("PIN harus berupa 4 digit angka");
      return;
    }
    if (pinValue !== confirmPinValue) {
      toast("Konfirmasi PIN tidak cocok");
      return;
    }
    if (hasPin && !/^\d{4}$/.test(currentPinValue)) {
      toast("Masukkan PIN lama Anda");
      return;
    }

    try {
      setSaving(true);
      const res = await fetch("/api/v1/user/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pinValue, ...(hasPin ? { currentPin: currentPinValue } : {}) }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast("PIN akun berhasil disimpan");
        setCurrentPinValue("");
        setPinValue("");
        setConfirmPinValue("");
        onSuccess();
        onClose();
      } else {
        toast(json.error?.message || "Gagal mengatur PIN");
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
      title={hasPin ? "Ubah PIN Akun" : "Atur PIN Akun"}
      description="PIN 4 digit digunakan untuk membuka percakapan yang dikunci atau diverifikasi."
      maxWidth="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-4 pt-1">
        {hasPin && (
          <div className="space-y-1">
            <label className="text-xs font-semibold text-[var(--muted)]">PIN Lama (4 Digit)</label>
            <Input
              type="password"
              maxLength={4}
              pattern="[0-9]{4}"
              inputMode="numeric"
              value={currentPinValue}
              onChange={(e) => setCurrentPinValue(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="PIN yang sedang dipakai"
              className="tracking-widest text-center text-lg font-mono"
              required
              autoFocus
            />
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-semibold text-[var(--muted)]">
            PIN Baru (4 Digit)
          </label>
          <Input
            type="password"
            maxLength={4}
            pattern="[0-9]{4}"
            inputMode="numeric"
            value={pinValue}
            onChange={(e) => setPinValue(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="Contoh: 1234"
            className="tracking-widest text-center text-lg font-mono"
            required
            autoFocus={!hasPin}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-[var(--muted)]">
            Konfirmasi PIN (4 Digit)
          </label>
          <Input
            type="password"
            maxLength={4}
            pattern="[0-9]{4}"
            inputMode="numeric"
            value={confirmPinValue}
            onChange={(e) => setConfirmPinValue(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="Ketik ulang 4 digit PIN"
            className="tracking-widest text-center text-lg font-mono"
            required
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-[8px] border border-[var(--border)] hover:bg-[var(--hover)] text-xs font-semibold text-[var(--ink)] transition-colors cursor-pointer"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={
              saving ||
              pinValue.length !== 4 ||
              confirmPinValue.length !== 4 ||
              (hasPin && currentPinValue.length !== 4)
            }
            className="px-4 py-2 rounded-[8px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-xs font-semibold text-[var(--accent-text)] transition-colors cursor-pointer disabled:opacity-50"
          >
            {saving ? "Menyimpan..." : "Simpan PIN"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
