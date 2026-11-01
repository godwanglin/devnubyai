"use client";

import React from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/providers/toast-provider";

interface PasskeyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PasskeyModal({ isOpen, onClose }: PasskeyModalProps) {
  const { toast } = useToast();

  const handleRegisterPasskey = () => {
    toast("Kunci sandi (Passkey) akan segera tersedia di pembaruan browser berikutnya.");
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Kunci Sandi & Kunci Keamanan"
      description="Gunakan biometrik (sidik jari, wajah) atau kunci fisik FIDO2 untuk masuk lebih cepat tanpa sandi."
      maxWidth="md"
    >
      <div className="space-y-4 pt-2">
        <div className="p-4 rounded-[12px] border border-[var(--border)] bg-[var(--panel-elevated)] space-y-3">
          <div className="flex items-start gap-3">
            <span className="p-2 rounded-[8px] bg-[var(--accent-soft)] text-[var(--accent)] shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-[var(--ink)]">
                Tahan Terhadap Phishing
              </p>
              <p className="text-xs text-[var(--muted)] mt-0.5 leading-relaxed">
                Kunci sandi diamankan secara kriptografis oleh perangkat keras Anda (Windows Hello, Touch ID, Face ID, atau YubiKey).
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-[8px] border border-[var(--border)] hover:bg-[var(--hover)] text-xs font-semibold text-[var(--ink)] transition-colors cursor-pointer"
          >
            Tutup
          </button>
          <button
            type="button"
            onClick={handleRegisterPasskey}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[8px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-xs font-semibold text-[var(--accent-text)] transition-colors cursor-pointer"
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Daftarkan Kunci Sandi</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}
