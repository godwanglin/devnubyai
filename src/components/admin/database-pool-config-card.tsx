"use client";

import React, { useEffect, useState } from "react";
import { Database, Loader2, Server, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";

interface DbPoolConfig {
  max: number;
  connectionTimeoutSeconds: number;
  idleTimeoutSeconds: number;
}

interface LiveDbStats {
  activeConnections: number | null;
  serverMaxConnections: number;
}

export function DatabasePoolConfigCard() {
  const { t } = useI18n();
  const { toast } = useToast();

  const [savedConfig, setSavedConfig] = useState<DbPoolConfig | null>(null);
  const [maxConnections, setMaxConnections] = useState<number>(20);
  const [connectionTimeout, setConnectionTimeout] = useState<number>(20);
  const [idleTimeout, setIdleTimeout] = useState<number>(30);
  const [liveStats, setLiveStats] = useState<LiveDbStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/admin/settings/database-pool", { credentials: "same-origin" })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.data?.poolConfig) {
          throw new Error(json?.error?.message);
        }
        if (!active) return;
        const cfg: DbPoolConfig = json.data.poolConfig;
        setSavedConfig(cfg);
        setMaxConnections(cfg.max);
        setConnectionTimeout(cfg.connectionTimeoutSeconds);
        setIdleTimeout(cfg.idleTimeoutSeconds);
        if (json.data.liveStats) {
          setLiveStats(json.data.liveStats);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        toast(err instanceof Error && err.message ? err.message : t("admin.dbPool.loadFailed"));
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [t, toast]);

  const isDirty =
    savedConfig !== null &&
    (maxConnections !== savedConfig.max ||
      connectionTimeout !== savedConfig.connectionTimeoutSeconds ||
      idleTimeout !== savedConfig.idleTimeoutSeconds);

  const isValid =
    maxConnections >= 5 &&
    maxConnections <= 100 &&
    connectionTimeout >= 3 &&
    connectionTimeout <= 60 &&
    idleTimeout >= 5 &&
    idleTimeout <= 300;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || !isDirty || saving) return;

    setSaving(true);
    try {
      const res = await fetch("/api/v1/admin/settings/database-pool", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          max: maxConnections,
          connectionTimeoutSeconds: connectionTimeout,
          idleTimeoutSeconds: idleTimeout,
        }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.data?.poolConfig) {
        throw new Error(json?.error?.message);
      }

      const updated: DbPoolConfig = json.data.poolConfig;
      setSavedConfig(updated);
      setMaxConnections(updated.max);
      setConnectionTimeout(updated.connectionTimeoutSeconds);
      setIdleTimeout(updated.idleTimeoutSeconds);
      if (json.data.liveStats) {
        setLiveStats(json.data.liveStats);
      }
      toast(t("admin.dbPool.saved"));
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : t("admin.dbPool.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 pt-6 border-t border-[var(--border)]">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Database className="w-4 h-4 text-[var(--accent)]" />
          <h2 className="text-base font-semibold text-[var(--ink)]">{t("admin.dbPool.title")}</h2>
        </div>
        <p className="text-xs text-[var(--muted)]">{t("admin.dbPool.description")}</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-[var(--muted)] py-6">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      ) : (
        <form
          onSubmit={handleSave}
          className="max-w-[560px] rounded-[12px] border border-[var(--border)] bg-[var(--panel)] p-4 space-y-4"
        >
          {liveStats && (
            <div className="grid grid-cols-2 gap-2 p-3 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-xs">
              <div className="flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-[var(--muted)]">{t("admin.dbPool.activeConnections")}:</span>
                <span className="font-semibold text-[var(--ink)]">
                  {liveStats.activeConnections !== null ? liveStats.activeConnections : "-"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Server className="w-3.5 h-3.5 text-blue-500" />
                <span className="text-[var(--muted)]">{t("admin.dbPool.serverMaxConnections")}:</span>
                <span className="font-semibold text-[var(--ink)]">
                  {liveStats.serverMaxConnections}
                </span>
              </div>
            </div>
          )}

          <div>
            <label
              htmlFor="db-max-connections"
              className="block text-xs font-medium text-[var(--muted)] mb-1"
            >
              {t("admin.dbPool.max")}
            </label>
            <input
              id="db-max-connections"
              type="number"
              min={5}
              max={100}
              required
              value={maxConnections}
              onChange={(e) => setMaxConnections(Number(e.target.value))}
              className="w-32 px-3 py-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] text-sm outline-none focus:border-[var(--accent)]"
            />
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--muted)]">
              {t("admin.dbPool.maxHint", {
                serverMax: String(liveStats?.serverMaxConnections ?? 100),
              })}
            </p>
          </div>

          <div className="pt-4 border-t border-[var(--border)]">
            <label
              htmlFor="db-connection-timeout"
              className="block text-xs font-medium text-[var(--muted)] mb-1"
            >
              {t("admin.dbPool.connectionTimeout")}
            </label>
            <input
              id="db-connection-timeout"
              type="number"
              min={3}
              max={60}
              required
              value={connectionTimeout}
              onChange={(e) => setConnectionTimeout(Number(e.target.value))}
              className="w-32 px-3 py-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] text-sm outline-none focus:border-[var(--accent)]"
            />
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--muted)]">
              {t("admin.dbPool.connectionTimeoutHint")}
            </p>
          </div>

          <div className="pt-4 border-t border-[var(--border)]">
            <label
              htmlFor="db-idle-timeout"
              className="block text-xs font-medium text-[var(--muted)] mb-1"
            >
              {t("admin.dbPool.idleTimeout")}
            </label>
            <input
              id="db-idle-timeout"
              type="number"
              min={5}
              max={300}
              required
              value={idleTimeout}
              onChange={(e) => setIdleTimeout(Number(e.target.value))}
              className="w-32 px-3 py-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] text-sm outline-none focus:border-[var(--accent)]"
            />
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--muted)]">
              {t("admin.dbPool.idleTimeoutHint")}
            </p>
          </div>

          <div className="flex justify-end pt-2">
            <Button type="submit" size="sm" disabled={!isValid || !isDirty || saving}>
              {saving ? t("admin.dbPool.saving") : t("admin.dbPool.save")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
