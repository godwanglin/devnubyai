"use client";

import React, { useState, useRef } from "react";
import { Download, Loader2, CheckCircle2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/providers/toast-provider";

interface ExportDataModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ExportSessionItem {
  id: string;
  title: string;
  isArchived: boolean;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
  messages: {
    role: string;
    content: string;
    createdAt: string;
  }[];
}

export function ExportDataModal({ isOpen, onClose }: ExportDataModalProps) {
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [isDone, setIsDone] = useState(false);
  const isCancelledRef = useRef(false);

  const startExport = async () => {
    setIsExporting(true);
    setIsDone(false);
    setProgress({ current: 0, total: 1 });
    isCancelledRef.current = false;

    const allConversations: ExportSessionItem[] = [];
    let cursor: string | null = null;
    let totalCount = 0;

    try {
      while (!isCancelledRef.current) {
        const url: string = cursor
          ? `/api/v1/user/export?limit=20&cursor=${encodeURIComponent(cursor)}`
          : `/api/v1/user/export?limit=20`;

        const res = await fetch(url);
        if (!res.ok) throw new Error("Gagal mengambil batch ekspor");
        const json = await res.json();

        totalCount = json.data?.totalCount ?? totalCount;
        const batch: ExportSessionItem[] = json.data?.conversations ?? [];
        allConversations.push(...batch);

        setProgress({
          current: allConversations.length,
          total: Math.max(totalCount, allConversations.length),
        });

        cursor = json.data?.nextCursor ?? null;
        if (!cursor || batch.length === 0) {
          break; // All conversations fetched
        }

        // 300ms throttle between batches to avoid overloading DB or network
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      if (isCancelledRef.current) return;

      // Assemble export payload
      const exportPayload = {
        app: "Devnuby AI",
        version: "1.0",
        exportedAt: new Date().toISOString(),
        totalConversations: allConversations.length,
        conversations: allConversations,
      };

      // Trigger file download
      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
        type: "application/json",
      });
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const dateStr = new Date().toISOString().split("T")[0];
      a.href = downloadUrl;
      a.download = `devnuby-data-export-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);

      setIsDone(true);
      toast("Ekspor data berhasil diunduh");
    } catch {
      toast("Terjadi kesalahan saat mengekspor data");
    } finally {
      setIsExporting(false);
    }
  };

  const handleClose = () => {
    if (isExporting) {
      isCancelledRef.current = true;
    }
    onClose();
  };

  const percent = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.current / progress.total) * 100))
    : 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Ekspor Data Akun"
      description="Unduh salinan riwayat percakapan dan pesan Anda dalam format JSON terstruktur."
      maxWidth="md"
    >
      <div className="space-y-4 pt-2">
        <div className="p-4 rounded-[12px] border border-[var(--border)] bg-[var(--panel-elevated)] space-y-2">
          <p className="text-xs text-[var(--muted)] leading-relaxed">
            Proses ekspor menggunakan batch bertahap (throttled) agar tidak membebani server dan koneksi perangkat Anda.
          </p>
          <div className="text-[11px] text-[var(--muted)]/80">
            Format: File JSON tunggal yang dapat dibuka di teks editor mana pun.
          </div>
        </div>

        {/* Progress Display */}
        {isExporting && progress && (
          <div className="space-y-2 p-3.5 rounded-[10px] border border-[var(--border)] bg-[var(--panel)]">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[var(--ink)] flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent)]" />
                <span>Mengekspor batch obrolan...</span>
              </span>
              <span className="font-mono text-[var(--muted)]">
                {progress.current} / {progress.total} ({percent}%)
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--border)]">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )}

        {isDone && (
          <div className="p-3 rounded-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>Ekspor selesai. File JSON telah otomatis diunduh ke perangkat Anda.</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={handleClose}
            className="px-3.5 py-2 rounded-[8px] border border-[var(--border)] hover:bg-[var(--hover)] text-xs font-semibold text-[var(--ink)] transition-colors cursor-pointer"
          >
            {isDone ? "Selesai" : "Batal"}
          </button>
          {!isDone && (
            <button
              type="button"
              onClick={startExport}
              disabled={isExporting}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[8px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-xs font-semibold text-[var(--accent-text)] transition-colors cursor-pointer disabled:opacity-50"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Memproses ({percent}%)...</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  <span>Mulai Ekspor</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
