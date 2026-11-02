"use client";

import React from "react";
import { Terminal, HardDrive, Server, FileText } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import type { StorageHealth, SystemInfo } from "@/lib/system-health/types";

function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function SystemRuntimeCard({
  system,
  storage,
}: {
  system: SystemInfo;
  storage: StorageHealth;
}) {
  const { t } = useI18n();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* 1. Runtime Environment */}
      <div className="p-4 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] shadow-xs">
            <Terminal className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-[var(--ink)]">
              {t("admin.systemHealth.runtime.title")}
            </h4>
            <p className="text-[11px] text-[var(--muted)] font-mono">
              Host: {system.hostname}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono">
          <div className="p-2.5 rounded-[8px] bg-[var(--surface)] border border-[var(--border)]/60">
            <span className="text-[10px] text-[var(--muted)] block">Node.js Engine</span>
            <span className="text-[var(--ink)] font-bold mt-0.5 block">{system.nodeVersion}</span>
          </div>
          <div className="p-2.5 rounded-[8px] bg-[var(--surface)] border border-[var(--border)]/60">
            <span className="text-[10px] text-[var(--muted)] block">OS Platform</span>
            <span className="text-[var(--ink)] font-bold mt-0.5 block">{system.platform} ({system.arch})</span>
          </div>
          <div className="p-2.5 rounded-[8px] bg-[var(--surface)] border border-[var(--border)]/60">
            <span className="text-[10px] text-[var(--muted)] block">OS Release</span>
            <span className="text-[var(--ink)] font-bold mt-0.5 block truncate">{system.release}</span>
          </div>
        </div>
      </div>

      {/* 2. Log & Storage Health */}
      <div className="p-4 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] shadow-xs">
            <HardDrive className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-[var(--ink)]">
              {t("admin.systemHealth.runtime.logStorage")}
            </h4>
            <p className="text-[11px] text-[var(--muted)] font-mono">
              Lokasi: .logs/ (Local Telemetry)
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
          <div className="p-2.5 rounded-[8px] bg-[var(--surface)] border border-[var(--border)]/60">
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
              <FileText className="w-3.5 h-3.5" />
              <span>Berkas Log (.log)</span>
            </div>
            <span className="text-sm font-bold text-[var(--ink)] mt-1 block">
              {storage.logFilesCount} berkas
            </span>
          </div>
          <div className="p-2.5 rounded-[8px] bg-[var(--surface)] border border-[var(--border)]/60">
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
              <Server className="w-3.5 h-3.5" />
              <span>Kapasitas Digunakan</span>
            </div>
            <span className="text-sm font-bold text-[var(--ink)] mt-1 block">
              {formatBytes(storage.logDirSizeBytes)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
