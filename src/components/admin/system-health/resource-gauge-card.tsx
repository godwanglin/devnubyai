"use client";

import React from "react";
import { Cpu, HardDrive } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import type { CpuHealth, MemoryHealth } from "@/lib/system-health/types";

function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function ResourceGaugeCard({
  cpu,
  memory,
}: {
  cpu: CpuHealth;
  memory: MemoryHealth;
}) {
  const { t } = useI18n();

  const getMeterColor = (pct: number) => {
    if (pct >= 90) return "bg-rose-500";
    if (pct >= 75) return "bg-amber-500";
    return "bg-emerald-500/90";
  };

  const cpuColor = getMeterColor(cpu.usagePct);
  const ramColor = getMeterColor(memory.usedPct);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* 1. CPU Monitor */}
      <div className="p-4 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] space-y-3.5 flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] shadow-xs">
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-[var(--ink)]">
                {t("admin.systemHealth.cpu.title")}
              </h4>
              <p className="text-[11px] text-[var(--muted)] font-mono">
                {t("admin.systemHealth.cpu.cores", { count: cpu.cores })} • {cpu.speedMhz} MHz
              </p>
            </div>
          </div>
          <div className="text-right">
            <span className="text-xl font-bold font-mono text-[var(--ink)]">
              {cpu.usagePct}%
            </span>
          </div>
        </div>

        {/* CPU Progress Bar */}
        <div className="space-y-1.5">
          <div className="w-full h-2 rounded-full bg-[var(--hover)] overflow-hidden">
            <div
              className={`h-full ${cpuColor} rounded-full transition-all duration-500`}
              style={{ width: `${Math.min(100, Math.max(2, cpu.usagePct))}%` }}
            />
          </div>
          <p className="text-[11px] text-[var(--muted)] truncate font-mono">
            {cpu.model}
          </p>
        </div>

        {/* CPU Details Grid */}
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[var(--divider)] text-xs font-mono">
          <div className="p-2.5 rounded-[8px] bg-[var(--surface)] border border-[var(--border)]/60">
            <span className="text-[10px] text-[var(--muted)] block">Load Avg (1m, 5m, 15m)</span>
            <span className="text-[var(--ink)] font-semibold mt-0.5 block">
              {cpu.loadAvg.join(" • ") || "N/A (Win32)"}
            </span>
          </div>
          <div className="p-2.5 rounded-[8px] bg-[var(--surface)] border border-[var(--border)]/60">
            <span className="text-[10px] text-[var(--muted)] block">CPU Node.js (User/Sys)</span>
            <span className="text-[var(--ink)] font-semibold mt-0.5 block">
              {(cpu.processCpuUserMs / 1000).toFixed(1)}s / {(cpu.processCpuSysMs / 1000).toFixed(1)}s
            </span>
          </div>
        </div>
      </div>

      {/* 2. RAM Monitor */}
      <div className="p-4 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] space-y-3.5 flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] shadow-xs">
              <HardDrive className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-[var(--ink)]">
                {t("admin.systemHealth.ram.title")}
              </h4>
              <p className="text-[11px] text-[var(--muted)] font-mono">
                {formatBytes(memory.usedBytes)} / {formatBytes(memory.totalBytes)} ({memory.usedPct}%)
              </p>
            </div>
          </div>
          <div className="text-right">
            <span className="text-xl font-bold font-mono text-[var(--ink)]">
              {memory.usedPct}%
            </span>
          </div>
        </div>

        {/* RAM Progress Bar */}
        <div className="space-y-1.5">
          <div className="w-full h-2 rounded-full bg-[var(--hover)] overflow-hidden">
            <div
              className={`h-full ${ramColor} rounded-full transition-all duration-500`}
              style={{ width: `${Math.min(100, Math.max(2, memory.usedPct))}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-[var(--muted)] font-mono">
            <span>{t("admin.systemHealth.ram.free", { free: formatBytes(memory.freeBytes) })}</span>
            <span>Total: {formatBytes(memory.totalBytes)}</span>
          </div>
        </div>

        {/* RAM Details Grid */}
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[var(--divider)] text-xs font-mono">
          <div className="p-2.5 rounded-[8px] bg-[var(--surface)] border border-[var(--border)]/60">
            <span className="text-[10px] text-[var(--muted)] block">Heap Node.js (Used / Total)</span>
            <span className="text-[var(--ink)] font-semibold mt-0.5 block truncate">
              {formatBytes(memory.processHeapUsedBytes)} / {formatBytes(memory.processHeapTotalBytes)}
            </span>
          </div>
          <div className="p-2.5 rounded-[8px] bg-[var(--surface)] border border-[var(--border)]/60">
            <span className="text-[10px] text-[var(--muted)] block">RSS (Resident Set Size)</span>
            <span className="text-[var(--ink)] font-semibold mt-0.5 block">
              {formatBytes(memory.processRssBytes)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
