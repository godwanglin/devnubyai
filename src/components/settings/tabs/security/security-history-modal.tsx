"use client";

import React from "react";
import { Shield, CheckCircle2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";

interface SecurityHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SecurityHistoryModal({ isOpen, onClose }: SecurityHistoryModalProps) {
  const events = [
    {
      id: "1",
      title: "Masuk berhasil",
      detail: "Sesi browser saat ini telah diverifikasi",
      time: "Hari ini",
      status: "success",
    },
    {
      id: "2",
      title: "Pemeriksaan sesi aktif",
      detail: "Audit berkala perangkat terpercaya",
      time: "Hari ini",
      status: "info",
    },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Riwayat Keamanan"
      description="Catatan aktivitas autentikasi dan perubahan pengaturan keamanan akun kamu."
      maxWidth="md"
    >
      <div className="space-y-3 pt-2">
        <div className="space-y-2">
          {events.map((ev) => (
            <div
              key={ev.id}
              className="flex items-center justify-between p-3 rounded-[10px] border border-[var(--border)] bg-[var(--panel-elevated)]"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="p-2 rounded-[8px] bg-[var(--hover)] text-[var(--ink)] shrink-0">
                  <Shield className="w-4 h-4 text-[var(--accent)]" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-semibold text-[var(--ink)] truncate">
                    {ev.title}
                  </p>
                  <p className="text-[11px] text-[var(--muted)] truncate">{ev.detail}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-[11px] text-[var(--muted)]">{ev.time}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-[8px] border border-[var(--border)] hover:bg-[var(--hover)] text-xs font-semibold text-[var(--ink)] transition-colors cursor-pointer"
          >
            Tutup
          </button>
        </div>
      </div>
    </Modal>
  );
}
