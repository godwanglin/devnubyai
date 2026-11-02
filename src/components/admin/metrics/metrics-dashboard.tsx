"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  Download,
  Activity,
  Sparkles,
  Server,
  CreditCard,
  FileSpreadsheet,
  FileCode,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { MetricsKpiGrid } from "./metrics-kpi-grid";
import { TrafficAreaChart } from "./traffic-area-chart";
import { TokenUsageChart } from "./token-usage-chart";
import { LatencyLineChart } from "./latency-line-chart";
import { ModelShareChart } from "./model-share-chart";
import { GatewayHealthChart } from "./gateway-health-chart";
import { ErrorDistributionChart } from "./error-distribution-chart";
import { BusinessMetricsCard } from "./business-metrics-card";
import { MetricsLeaderboardTable } from "./metrics-leaderboard-table";
import type { AdminMetricsData, MetricsActiveTab, MetricsTimeRange } from "@/lib/metrics/types";

export function MetricsDashboard() {
  const { t } = useI18n();
  const { toast } = useToast();

  const [timeRange, setTimeRange] = useState<MetricsTimeRange>("7d");
  const [activeTab, setActiveTab] = useState<MetricsActiveTab>("overview");
  const [loading, setLoading] = useState<boolean>(true);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(false);
  const [data, setData] = useState<AdminMetricsData | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState<boolean>(false);

  const fetchMetrics = useCallback(
    async (showLoadingSpinner = true) => {
      if (showLoadingSpinner) setLoading(true);
      try {
        const res = await fetch(`/api/v1/admin/metrics?range=${timeRange}`, {
          credentials: "same-origin",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json?.error?.message || "Gagal memuat metrik");
        }
        setData(json.data);
        setLastUpdated(new Date());
      } catch (err) {
        toast(err instanceof Error ? err.message : "Gagal memuat metrik");
      } finally {
        if (showLoadingSpinner) setLoading(false);
      }
    },
    [timeRange, toast]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchMetrics(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchMetrics]);

  // Auto-refresh interval (30 seconds)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      void fetchMetrics(false);
    }, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchMetrics]);

  // Export functions
  function handleExportJson() {
    if (!data) return;
    const jsonStr = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(data, null, 2))}`;
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", jsonStr);
    downloadAnchor.setAttribute("download", `devnuby-metrics-${timeRange}-${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setExportMenuOpen(false);
    toast("Metrik berhasil diekspor ke JSON");
  }

  function handleExportCsv() {
    if (!data) return;
    const headers = [
      "Timestamp",
      "Label",
      "Total Requests",
      "Success Requests",
      "Fallback Requests",
      "Failed Requests",
      "Prompt Tokens",
      "Completion Tokens",
      "Avg Latency (ms)",
      "Avg TTFT (ms)",
    ];
    const rows = data.timeSeries.map((d) => [
      d.timestamp,
      d.label,
      d.totalRequests,
      d.successfulRequests,
      d.fallbackRequests,
      d.failedRequests,
      d.promptTokens,
      d.completionTokens,
      d.avgLatencyMs,
      d.avgTtftMs,
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", encodedUri);
    downloadAnchor.setAttribute("download", `devnuby-timeseries-${timeRange}-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setExportMenuOpen(false);
    toast("Data time-series berhasil diekspor ke CSV");
  }

  const rangeOptions: { value: MetricsTimeRange; labelKey: string }[] = [
    { value: "24h", labelKey: "admin.metrics.ranges.24h" },
    { value: "7d", labelKey: "admin.metrics.ranges.7d" },
    { value: "30d", labelKey: "admin.metrics.ranges.30d" },
    { value: "all", labelKey: "admin.metrics.ranges.all" },
  ];

  const tabs: { key: MetricsActiveTab; labelKey: string; icon: React.ReactNode }[] = [
    { key: "overview", labelKey: "admin.metrics.tabs.overview", icon: <Activity className="w-3.5 h-3.5" /> },
    { key: "ai", labelKey: "admin.metrics.tabs.ai", icon: <Sparkles className="w-3.5 h-3.5" /> },
    { key: "performance", labelKey: "admin.metrics.tabs.performance", icon: <Server className="w-3.5 h-3.5" /> },
    { key: "business", labelKey: "admin.metrics.tabs.business", icon: <CreditCard className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="space-y-4">
      {/* Top Header & Global Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--ink)]">
            {t("admin.metrics.title")}
          </h2>
          <p className="text-xs text-[var(--muted)]">
            {t("admin.metrics.subtitle")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Time Range Pills */}
          <div className="flex items-center gap-1 p-1 rounded-[10px] bg-[var(--panel-elevated)] border border-[var(--border)]">
            {rangeOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTimeRange(opt.value)}
                className={`px-2.5 py-1 rounded-[6px] text-xs font-medium cursor-pointer transition-all ${
                  timeRange === opt.value
                    ? "bg-[var(--surface)] text-[var(--ink)] shadow-xs font-semibold"
                    : "text-[var(--muted)] hover:text-[var(--ink)]"
                }`}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>

          {/* Auto-Refresh Toggle */}
          <button
            type="button"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] text-xs font-medium border transition-all cursor-pointer ${
              autoRefresh
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : "bg-[var(--panel)] border-[var(--border)] text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
            title="Auto refresh metrics every 30 seconds"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                autoRefresh ? "bg-emerald-400 animate-pulse" : "bg-[var(--muted)]"
              }`}
            />
            <span>{t("admin.metrics.liveRefresh")}</span>
          </button>

          {/* Manual Refresh Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchMetrics(true)}
            disabled={loading}
            className="flex items-center gap-1.5 h-8 text-xs font-medium cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>{loading ? t("admin.metrics.refreshing") : t("admin.metrics.refresh")}</span>
          </Button>

          {/* Export Dropdown */}
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExportMenuOpen(!exportMenuOpen)}
              className="flex items-center gap-1.5 h-8 text-xs font-medium cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t("admin.metrics.export")}</span>
            </Button>
            {exportMenuOpen && (
              <div
                className="absolute right-0 mt-1.5 w-40 rounded-[10px] border border-[var(--border)] bg-[var(--panel)] shadow-xl p-1 z-50 animate-in fade-in zoom-in-95 duration-100"
                onMouseLeave={() => setExportMenuOpen(false)}
              >
                <button
                  type="button"
                  onClick={handleExportJson}
                  className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-[6px] text-xs text-[var(--ink)] hover:bg-[var(--hover)] text-left cursor-pointer"
                >
                  <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{t("admin.metrics.exportJson")}</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-[6px] text-xs text-[var(--ink)] hover:bg-[var(--hover)] text-left cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{t("admin.metrics.exportCsv")}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* View Tabs Switcher & Last Updated */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--border)] pb-2">
        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium cursor-pointer transition-all ${
                activeTab === tab.key
                  ? "bg-[var(--panel)] text-[var(--ink)] border border-[var(--border)] shadow-xs"
                  : "text-[var(--muted)] hover:text-[var(--ink)]"
              }`}
            >
              {tab.icon}
              <span>{t(tab.labelKey)}</span>
            </button>
          ))}
        </div>

        {lastUpdated && (
          <span className="text-[11px] text-[var(--muted)] font-mono self-end sm:self-auto">
            {t("admin.metrics.lastUpdated", {
              time: lastUpdated.toLocaleTimeString("id-ID", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              }),
            })}
          </span>
        )}
      </div>

      {/* Main Dashboard Views */}
      {loading && !data ? (
        <div className="space-y-4 animate-pulse">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-24 rounded-[12px] bg-[var(--hover)]" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="h-72 rounded-[12px] bg-[var(--hover)]" />
            <div className="h-72 rounded-[12px] bg-[var(--hover)]" />
          </div>
        </div>
      ) : data ? (
        <div className="space-y-4">
          {/* Always render KPI Grid on top for high-level visibility */}
          <MetricsKpiGrid summary={data.summary} />

          {/* TAB 1: OVERVIEW */}
          {activeTab === "overview" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <TrafficAreaChart data={data.timeSeries} />
                <TokenUsageChart data={data.timeSeries} />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <LatencyLineChart data={data.timeSeries} />
                <ModelShareChart data={data.modelUsage} />
              </div>
              <MetricsLeaderboardTable models={data.modelUsage} gateways={data.gatewayMetrics} />
            </div>
          )}

          {/* TAB 2: AI & TOKENS */}
          {activeTab === "ai" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <TokenUsageChart data={data.timeSeries} />
                <ModelShareChart data={data.modelUsage} />
              </div>
              <MetricsLeaderboardTable models={data.modelUsage} gateways={data.gatewayMetrics} />
            </div>
          )}

          {/* TAB 3: GATEWAYS & RELIABILITY */}
          {activeTab === "performance" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <LatencyLineChart data={data.timeSeries} />
                <GatewayHealthChart data={data.gatewayMetrics} />
              </div>
              <ErrorDistributionChart data={data.errorDistribution} />
              <MetricsLeaderboardTable models={data.modelUsage} gateways={data.gatewayMetrics} />
            </div>
          )}

          {/* TAB 4: BUSINESS & USERS */}
          {activeTab === "business" && (
            <div className="space-y-4">
              <BusinessMetricsCard plans={data.planDistribution} revenue={data.revenueSeries} />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
