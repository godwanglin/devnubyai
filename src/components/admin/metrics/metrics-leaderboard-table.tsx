"use client";

import React, { useState } from "react";
import { Sparkles, Server, CheckCircle2, AlertTriangle, ShieldAlert } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import type { GatewayMetric, ModelUsageMetric } from "@/lib/metrics/types";

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(2)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toLocaleString();
}

export function MetricsLeaderboardTable({
  models,
  gateways,
}: {
  models: ModelUsageMetric[];
  gateways: GatewayMetric[];
}) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<"models" | "gateways">("models");

  return (
    <div className="p-4 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--ink)]">
            {t("admin.metrics.table.title")}
          </h3>
          <p className="text-xs text-[var(--muted)]">
            {t("admin.metrics.table.subtitle")}
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-[8px] bg-[var(--panel-elevated)] border border-[var(--border)] self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setActiveTab("models")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-xs font-medium cursor-pointer transition-all ${
              activeTab === "models"
                ? "bg-[var(--surface)] text-[var(--ink)] shadow-xs"
                : "text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{t("admin.metrics.table.model")} ({models.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("gateways")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-xs font-medium cursor-pointer transition-all ${
              activeTab === "gateways"
                ? "bg-[var(--surface)] text-[var(--ink)] shadow-xs"
                : "text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            <span>{t("admin.metrics.table.gateway")} ({gateways.length})</span>
          </button>
        </div>
      </div>

      {activeTab === "models" ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[var(--border)] text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                <th className="py-2.5 px-3">{t("admin.metrics.table.model")}</th>
                <th className="py-2.5 px-3">{t("admin.metrics.table.requests")}</th>
                <th className="py-2.5 px-3">{t("admin.metrics.table.share")}</th>
                <th className="py-2.5 px-3">{t("admin.metrics.table.tokens")}</th>
                <th className="py-2.5 px-3">{t("admin.metrics.table.avgLatency")}</th>
                <th className="py-2.5 px-3 text-right">{t("admin.metrics.table.successRate")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--divider)]">
              {models.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[var(--muted)]">
                    {t("admin.metrics.table.noData")}
                  </td>
                </tr>
              ) : (
                models.map((m) => (
                  <tr key={m.modelId} className="hover:bg-[var(--hover)]/60 transition-colors">
                    <td className="py-3 px-3 font-medium text-[var(--ink)]">
                      <div className="flex flex-col">
                        <span>{m.modelName}</span>
                        {m.publicId && (
                          <span className="text-[10px] text-[var(--muted)] font-mono">{m.publicId}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3 font-mono text-[var(--ink)] tabular-nums">
                      {m.requestCount.toLocaleString()}
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-[var(--hover)] overflow-hidden">
                          <div
                            className="h-full bg-violet-500 rounded-full"
                            style={{ width: `${Math.min(100, m.requestSharePct)}%` }}
                          />
                        </div>
                        <span className="font-mono text-[11px] text-[var(--muted)]">
                          {m.requestSharePct}%
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-3 font-mono text-[var(--muted)]">
                      <span className="text-[var(--ink)] font-medium">{formatTokens(m.totalTokens)}</span>
                      <span className="text-[10px] ml-1.5 opacity-70">
                        ({formatTokens(m.promptTokens)} / {formatTokens(m.completionTokens)})
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono text-[var(--ink)] tabular-nums">
                      {m.avgLatencyMs.toLocaleString()} ms
                    </td>
                    <td className="py-3 px-3 text-right">
                      <span
                        className={`inline-flex items-center gap-1 font-mono font-medium px-2 py-0.5 rounded text-[11px] ${
                          m.successRatePct >= 95
                            ? "bg-emerald-500/10 text-emerald-400"
                            : m.successRatePct >= 80
                            ? "bg-amber-500/10 text-amber-400"
                            : "bg-rose-500/10 text-rose-400"
                        }`}
                      >
                        {m.successRatePct >= 95 ? (
                          <CheckCircle2 className="w-3 h-3 shrink-0" />
                        ) : (
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                        )}
                        {m.successRatePct}%
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[var(--border)] text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                <th className="py-2.5 px-3">{t("admin.metrics.table.gateway")}</th>
                <th className="py-2.5 px-3">{t("admin.metrics.table.requests")}</th>
                <th className="py-2.5 px-3">Sukses / Fallback / Error</th>
                <th className="py-2.5 px-3">{t("admin.metrics.table.avgLatency")}</th>
                <th className="py-2.5 px-3 text-right">{t("admin.metrics.table.successRate")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--divider)]">
              {gateways.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[var(--muted)]">
                    {t("admin.metrics.table.noData")}
                  </td>
                </tr>
              ) : (
                gateways.map((g) => (
                  <tr key={g.gatewayId} className="hover:bg-[var(--hover)]/60 transition-colors">
                    <td className="py-3 px-3 font-medium text-[var(--ink)]">
                      <div className="flex items-center gap-2">
                        <span>{g.name}</span>
                        {g.isPrimary && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-500/10 text-violet-400 border border-violet-500/20">
                            {t("admin.metrics.table.primary")}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-[var(--muted)] font-mono">{g.slug}</span>
                    </td>
                    <td className="py-3 px-3 font-mono text-[var(--ink)] tabular-nums">
                      {g.requestCount.toLocaleString()} ({g.sharePct}%)
                    </td>
                    <td className="py-3 px-3 font-mono text-[11px]">
                      <span className="text-emerald-400">{g.successCount}</span>
                      <span className="text-[var(--muted)]"> / </span>
                      <span className="text-amber-400">{g.fallbackCount}</span>
                      <span className="text-[var(--muted)]"> / </span>
                      <span className={g.errorCount > 0 ? "text-rose-400 font-bold" : "text-[var(--muted)]"}>
                        {g.errorCount}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono text-[var(--ink)] tabular-nums">
                      {g.avgLatencyMs.toLocaleString()} ms
                    </td>
                    <td className="py-3 px-3 text-right">
                      <span
                        className={`inline-flex items-center gap-1 font-mono font-medium px-2 py-0.5 rounded text-[11px] ${
                          g.successRatePct >= 95
                            ? "bg-emerald-500/10 text-emerald-400"
                            : g.successRatePct >= 80
                            ? "bg-amber-500/10 text-amber-400"
                            : "bg-rose-500/10 text-rose-400"
                        }`}
                      >
                        {g.successRatePct >= 95 ? (
                          <CheckCircle2 className="w-3 h-3 shrink-0" />
                        ) : (
                          <ShieldAlert className="w-3 h-3 shrink-0" />
                        )}
                        {g.successRatePct}%
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
