"use client";

import React, { useState, useEffect, useCallback } from "react";
import { RefreshCw, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { OverallStatusBanner } from "./overall-status-banner";
import { ResourceGaugeCard } from "./resource-gauge-card";
import { PostgresHealthCard } from "./postgres-health-card";
import { RedisHealthCard } from "./redis-health-card";
import { SystemRuntimeCard } from "./system-runtime-card";
import type { SystemHealthReport } from "@/lib/system-health/types";

export function SystemHealthDashboard() {
  const { t } = useI18n();
  const { toast } = useToast();

  const [loading, setLoading] = useState<boolean>(true);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [data, setData] = useState<SystemHealthReport | null>(null);

  const fetchHealth = useCallback(
    async (showLoadingSpinner = true) => {
      if (showLoadingSpinner) setLoading(true);
      try {
        const res = await fetch("/api/v1/admin/system-health", {
          credentials: "same-origin",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json?.error?.message || "Gagal memeriksa kesehatan server");
        }
        setData(json.data);
      } catch (err) {
        toast(err instanceof Error ? err.message : "Gagal memeriksa kesehatan server");
      } finally {
        if (showLoadingSpinner) setLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchHealth(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchHealth]);

  // Smart Polling every 5 seconds (pauses when browser tab is hidden)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return; // Pause polling when tab is inactive
      }
      void fetchHealth(false);
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchHealth]);

  return (
    <div className="space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--ink)]">
            {t("admin.systemHealth.title")}
          </h2>
          <p className="text-xs text-[var(--muted)]">
            {t("admin.systemHealth.subtitle")}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {/* Live Auto-Refresh Toggle */}
          <button
            type="button"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-[8px] text-xs font-medium border transition-all cursor-pointer ${
              autoRefresh
                ? "bg-[var(--panel)] border-[var(--border)] text-[var(--ink)] shadow-xs hover:border-[var(--muted)]/40"
                : "bg-[var(--surface)] border-[var(--border)] text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
            title="Auto refresh metrics every 5 seconds"
          >
            <span className="relative flex h-2 w-2">
              {autoRefresh && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              )}
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  autoRefresh ? "bg-emerald-500" : "bg-[var(--muted)]"
                }`}
              />
            </span>
            <span>{t("admin.systemHealth.liveRefresh")}</span>
          </button>

          {/* Manual Check Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchHealth(true)}
            disabled={loading}
            className="flex items-center gap-1.5 h-8 text-xs font-medium cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>
              {loading ? t("admin.systemHealth.refreshing") : t("admin.systemHealth.refresh")}
            </span>
          </Button>
        </div>
      </div>

      {/* Main Content */}
      {loading && !data ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-20 rounded-[12px] bg-[var(--hover)]" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="h-44 rounded-[12px] bg-[var(--hover)]" />
            <div className="h-44 rounded-[12px] bg-[var(--hover)]" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="h-48 rounded-[12px] bg-[var(--hover)]" />
            <div className="h-48 rounded-[12px] bg-[var(--hover)]" />
          </div>
        </div>
      ) : data ? (
        <div className="space-y-4">
          {/* 1. Overall Status Banner */}
          <OverallStatusBanner
            status={data.overallStatus}
            timestamp={data.timestamp}
            systemUptimeSeconds={data.system.systemUptimeSeconds}
            processUptimeSeconds={data.system.processUptimeSeconds}
          />

          {/* 2. CPU & RAM Utilization */}
          <ResourceGaugeCard cpu={data.cpu} memory={data.memory} />

          {/* 3. Databases: PostgreSQL & Redis */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <PostgresHealthCard pg={data.postgres} />
            <RedisHealthCard redis={data.redis} />
          </div>

          {/* 4. Runtime Environment & Log Storage */}
          <SystemRuntimeCard system={data.system} storage={data.storage} />
        </div>
      ) : (
        <div className="p-8 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] text-center text-xs text-[var(--muted)] space-y-2">
          <Activity className="w-8 h-8 mx-auto text-[var(--muted)] opacity-60" />
          <p>Tidak dapat mengambil status kesehatan server.</p>
        </div>
      )}
    </div>
  );
}
