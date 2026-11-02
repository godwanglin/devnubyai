"use client";

import React from "react";
import { CheckCircle2, AlertTriangle, ShieldAlert, Clock, RefreshCw } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import type { ServerHealthStatus } from "@/lib/system-health/types";

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}h ${h}j ${m}m`;
  if (h > 0) return `${h}j ${m}m`;
  return `${m}m`;
}

export function OverallStatusBanner({
  status,
  timestamp,
  systemUptimeSeconds,
  processUptimeSeconds,
}: {
  status: ServerHealthStatus;
  timestamp: string;
  systemUptimeSeconds: number;
  processUptimeSeconds: number;
}) {
  const { t } = useI18n();

  const isHealthy = status === "healthy";
  const isDegraded = status === "degraded";

  const config = isHealthy
    ? {
        badgeBorder: "border-emerald-500/25",
        badgeBg: "bg-emerald-500/10",
        badgeText: "text-emerald-400",
        dotBg: "bg-emerald-400",
        icon: <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />,
        titleKey: "admin.systemHealth.status.healthy",
        descKey: "admin.systemHealth.status.healthyDesc",
      }
    : isDegraded
    ? {
        badgeBorder: "border-amber-500/25",
        badgeBg: "bg-amber-500/10",
        badgeText: "text-amber-400",
        dotBg: "bg-amber-400",
        icon: <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />,
        titleKey: "admin.systemHealth.status.degraded",
        descKey: "admin.systemHealth.status.degradedDesc",
      }
    : {
        badgeBorder: "border-rose-500/25",
        badgeBg: "bg-rose-500/10",
        badgeText: "text-rose-400",
        dotBg: "bg-rose-400",
        icon: <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0" />,
        titleKey: "admin.systemHealth.status.critical",
        descKey: "admin.systemHealth.status.criticalDesc",
      };

  return (
    <div className="p-4 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all shadow-xs">
      <div className="flex items-start sm:items-center gap-3">
        <div className={`p-2 rounded-full ${config.badgeBg} ${config.badgeText} border ${config.badgeBorder} shrink-0`}>
          {config.icon}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--ink)]">
              {t(config.titleKey)}
            </h3>
            <span className="relative flex h-2 w-2">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${config.dotBg}`}
              />
              <span className={`relative inline-flex rounded-full h-2 w-2 ${config.dotBg}`} />
            </span>
          </div>
          <p className="text-xs text-[var(--muted)] mt-0.5 max-w-2xl">
            {t(config.descKey)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-[var(--muted)] border-t md:border-t-0 md:border-l border-[var(--divider)] pt-3 md:pt-0 md:pl-5 shrink-0">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-[var(--placeholder)]" />
          <span>Host: {formatUptime(systemUptimeSeconds)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <RefreshCw className="w-3.5 h-3.5 text-[var(--placeholder)]" />
          <span>App: {formatUptime(processUptimeSeconds)}</span>
        </div>
        <div className="text-[11px] text-[var(--placeholder)]">
          {new Date(timestamp).toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}
