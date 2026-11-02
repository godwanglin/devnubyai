"use client";

import React from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import type { ErrorDistributionMetric } from "@/lib/metrics/types";

export function ErrorDistributionChart({ data }: { data: ErrorDistributionMetric[] }) {
  const { t } = useI18n();

  return (
    <div className="p-4 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] flex flex-col justify-between">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-[var(--ink)]">
          {t("admin.metrics.charts.errorTitle")}
        </h3>
        <p className="text-xs text-[var(--muted)]">
          {t("admin.metrics.charts.errorSubtitle")}
        </p>
      </div>

      {data.length === 0 ? (
        <div className="h-64 flex flex-col items-center justify-center text-center p-6 space-y-2">
          <div className="p-2.5 rounded-full bg-emerald-500/10 text-emerald-400">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h4 className="text-sm font-medium text-[var(--ink)]">Semua Sistem Beroperasi Normal</h4>
          <p className="text-xs text-[var(--muted)] max-w-xs">
            Tidak ada error routing atau fallback yang tercatat pada rentang waktu ini.
          </p>
        </div>
      ) : (
        <div className="space-y-3 py-1">
          {data.map((err) => (
            <div key={err.errorClass} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 min-w-0">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span className="font-mono font-medium text-[var(--ink)] truncate">
                    {err.errorClass}
                  </span>
                </div>
                <div className="flex items-center gap-2 font-mono text-[11px] shrink-0">
                  <span className="text-[var(--muted)]">{err.count} insiden</span>
                  <span className="font-semibold text-rose-400">{err.percentage}%</span>
                </div>
              </div>
              {/* Progress bar */}
              <div className="w-full h-2 rounded-full bg-[var(--hover)] overflow-hidden">
                <div
                  className="h-full bg-rose-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(5, err.percentage))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
