"use client";

import React from "react";
import {
  Activity,
  Zap,
  Clock,
  ShieldAlert,
  Users,
  CreditCard,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import type { MetricsSummary } from "@/lib/metrics/types";

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(2)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toLocaleString();
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function MetricsKpiGrid({ summary }: { summary: MetricsSummary }) {
  const { t } = useI18n();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
      {/* 1. Total Requests / Inferences */}
      <div className="p-3.5 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] transition-all hover:border-[var(--muted)]/40 shadow-xs flex flex-col justify-between">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-[var(--muted)] truncate">
            {t("admin.metrics.kpi.totalRequests")}
          </span>
          <div className="p-1.5 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] shrink-0 shadow-xs">
            <Activity className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="mt-2">
          <div className="text-xl font-bold font-mono tracking-tight text-[var(--ink)]">
            {summary.totalRequests.toLocaleString()}
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px]">
            <span className="inline-flex items-center gap-0.5 text-emerald-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 inline-block" />
              {summary.successRatePct}% {t("admin.metrics.kpi.successRate")}
            </span>
            {summary.requestsTrendPct !== 0 && (
              <span
                className={`inline-flex items-center font-mono ${
                  summary.requestsTrendPct > 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {summary.requestsTrendPct > 0 ? (
                  <ArrowUpRight className="w-3 h-3" />
                ) : (
                  <ArrowDownRight className="w-3 h-3" />
                )}
                {Math.abs(summary.requestsTrendPct)}%
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 2. Token Volume */}
      <div className="p-3.5 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] transition-all hover:border-[var(--muted)]/40 shadow-xs flex flex-col justify-between">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-[var(--muted)] truncate">
            {t("admin.metrics.kpi.totalTokens")}
          </span>
          <div className="p-1.5 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] shrink-0 shadow-xs">
            <Zap className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="mt-2">
          <div className="text-xl font-bold font-mono tracking-tight text-[var(--ink)]">
            {formatTokens(summary.totalTokens)}
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--muted)] font-mono">
            <span>In: {formatTokens(summary.promptTokens)}</span>
            <span>Out: {formatTokens(summary.completionTokens)}</span>
          </div>
        </div>
      </div>

      {/* 3. Latency & TTFT */}
      <div className="p-3.5 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] transition-all hover:border-[var(--muted)]/40 shadow-xs flex flex-col justify-between">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-[var(--muted)] truncate">
            {t("admin.metrics.kpi.avgLatency")}
          </span>
          <div className="p-1.5 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] shrink-0 shadow-xs">
            <Clock className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="mt-2">
          <div className="text-xl font-bold font-mono tracking-tight text-[var(--ink)]">
            {summary.avgLatencyMs.toLocaleString()} <span className="text-xs font-normal">ms</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--muted)] font-mono">
            <span>TTFT: {summary.avgTtftMs}ms</span>
            <span className="text-[10px] text-[var(--placeholder)]">p95: {summary.p95LatencyMs}ms</span>
          </div>
        </div>
      </div>

      {/* 4. Errors & Fallbacks */}
      <div className="p-3.5 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] transition-all hover:border-[var(--muted)]/40 shadow-xs flex flex-col justify-between">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-[var(--muted)] truncate">
            {t("admin.metrics.kpi.errorFallback")}
          </span>
          <div className="p-1.5 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] shrink-0 shadow-xs">
            <ShieldAlert className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="mt-2">
          <div className="text-xl font-bold font-mono tracking-tight text-[var(--ink)]">
            {summary.fallbackRatePct}%
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--muted)] font-mono">
            <span className="text-amber-400">{summary.fallbackCount} fallback</span>
            <span className={summary.errorCount > 0 ? "text-rose-400 font-semibold" : ""}>
              {summary.errorCount} error
            </span>
          </div>
        </div>
      </div>

      {/* 5. Active Users & Sessions */}
      <div className="p-3.5 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] transition-all hover:border-[var(--muted)]/40 shadow-xs flex flex-col justify-between">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-[var(--muted)] truncate">
            {t("admin.metrics.kpi.activeUsers")}
          </span>
          <div className="p-1.5 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] shrink-0 shadow-xs">
            <Users className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="mt-2">
          <div className="text-xl font-bold font-mono tracking-tight text-[var(--ink)]">
            {summary.activeUsers.toLocaleString()}
          </div>
          <div className="mt-1 text-[11px] text-[var(--muted)] truncate">
            {t("admin.metrics.kpi.totalSessions", { count: summary.totalSessions.toLocaleString() })}
          </div>
        </div>
      </div>

      {/* 6. Revenue & Transactions */}
      <div className="p-3.5 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] transition-all hover:border-[var(--muted)]/40 shadow-xs flex flex-col justify-between">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-[var(--muted)] truncate">
            {t("admin.metrics.kpi.totalRevenue")}
          </span>
          <div className="p-1.5 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] shrink-0 shadow-xs">
            <CreditCard className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="mt-2">
          <div className="text-lg font-bold font-mono tracking-tight text-[var(--ink)] truncate">
            {formatCurrency(summary.totalRevenueIdr)}
          </div>
          <div className="mt-1 text-[11px] text-[var(--muted)] truncate">
            {t("admin.metrics.kpi.paidTransactions", {
              count: summary.totalPaidTransactions.toLocaleString(),
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
