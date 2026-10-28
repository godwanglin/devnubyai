"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Plus,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Zap,
  RotateCcw,
  Sparkles,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { GatewayModal } from "./gateway-modal";
import { DeleteGatewayModal, SetPrimaryGatewayModal } from "./gateway-confirm-modals";
import type { SanitizedGatewayDto } from "@/lib/gateways/admin-service";

interface TestResult {
  testing: boolean;
  latencyMs?: number;
  modelsFound?: number;
  success?: boolean;
  error?: string;
}

export function GatewaysTab() {
  const { t } = useI18n();
  const { toast } = useToast();

  const [gateways, setGateways] = useState<SanitizedGatewayDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modals state
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedGateway, setSelectedGateway] = useState<SanitizedGatewayDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SanitizedGatewayDto | null>(null);
  const [primaryTarget, setPrimaryTarget] = useState<SanitizedGatewayDto | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Testing & Syncing indicators
  const [testStates, setTestStates] = useState<Record<string, TestResult>>({});
  const [syncStates, setSyncStates] = useState<Record<string, boolean>>({});

  const fetchGateways = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/gateways", { credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message || "Failed to load gateways");
      }
      setGateways(json.data.gateways);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load gateways");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(fetchGateways);
  }, [fetchGateways]);

  async function handleTest(g: SanitizedGatewayDto) {
    setTestStates((prev) => ({ ...prev, [g.id]: { testing: true } }));
    try {
      const res = await fetch(`/api/v1/admin/gateways/${g.id}/test`, {
        method: "POST",
        credentials: "same-origin",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message || "Failed to test gateway");
      }
      const data = json.data;
      setTestStates((prev) => ({
        ...prev,
        [g.id]: {
          testing: false,
          latencyMs: data.latencyMs,
          modelsFound: data.modelsFound,
          success: data.success,
          error: data.error,
        },
      }));
      if (data.success) {
        toast(
          t("admin.gateways.testSuccess", {
            latency: data.latencyMs,
            models: data.modelsFound ?? 0,
          })
        );
      } else {
        toast(
          t("admin.gateways.testFailure", {
            latency: data.latencyMs,
            error: data.error || "Unknown",
          })
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Test failed";
      setTestStates((prev) => ({
        ...prev,
        [g.id]: { testing: false, success: false, error: msg },
      }));
      toast(t("admin.gateways.testFailure", { latency: 0, error: msg }));
    }
  }

  async function handleSync(g: SanitizedGatewayDto) {
    setSyncStates((prev) => ({ ...prev, [g.id]: true }));
    try {
      const res = await fetch(`/api/v1/admin/gateways/${g.id}/sync-models`, {
        method: "POST",
        credentials: "same-origin",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message || "Failed to sync models");
      }
      toast(
        t("admin.gateways.syncSuccess", {
          synced: json.data.syncedCount,
          unavailable: json.data.unavailableCount,
        })
      );
      fetchGateways();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncStates((prev) => ({ ...prev, [g.id]: false }));
    }
  }

  async function handleResetCircuit(g: SanitizedGatewayDto) {
    try {
      const res = await fetch(`/api/v1/admin/gateways/${g.id}/reset-circuit`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error?.message || "Reset failed");
      }
      toast(t("admin.gateways.circuitResetSuccess"));
      fetchGateways();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Reset failed");
    }
  }

  async function confirmSetPrimary() {
    if (!primaryTarget) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/v1/admin/gateways/${primaryTarget.id}/primary`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error?.message || "Failed to change primary gateway");
      }
      setPrimaryTarget(null);
      fetchGateways();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Failed to change primary");
    } finally {
      setActionLoading(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/v1/admin/gateways/${deleteTarget.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error?.message || "Failed to delete gateway");
      }
      setDeleteTarget(null);
      fetchGateways();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Failed to delete gateway");
    } finally {
      setActionLoading(false);
    }
  }

  function renderHealthBadge(status: string) {
    if (status === "healthy") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
          <CheckCircle2 className="w-3 h-3" />
          <span>healthy</span>
        </span>
      );
    }
    if (status === "degraded") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">
          <AlertTriangle className="w-3 h-3" />
          <span>degraded</span>
        </span>
      );
    }
    if (status === "down") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-500/10 text-rose-500 border border-rose-500/20">
          <XCircle className="w-3 h-3" />
          <span>down</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
        <HelpCircle className="w-3 h-3" />
        <span>unknown</span>
      </span>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--ink)]">
            {t("admin.gateways.title")}
          </h2>
          <p className="text-xs text-[var(--muted)]">{t("admin.gateways.description")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={fetchGateways} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>{t("admin.gateways.refresh")}</span>
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setSelectedGateway(null);
              setModalOpen(true);
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t("admin.gateways.addGateway")}</span>
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-[8px] bg-red-500/10 border border-red-500/20 text-xs text-red-500">
          {error}
        </div>
      )}

      {gateways.length === 0 && !loading ? (
        <div className="p-8 text-center rounded-[12px] border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] text-sm">
          {t("admin.gateways.emptyList")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[12px] border border-[var(--border)] bg-[var(--panel)]">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] font-medium">
              <tr>
                <th className="py-3 px-3 w-12 text-center">{t("admin.gateways.primary")}</th>
                <th className="py-3 px-4">{t("admin.gateways.name")}</th>
                <th className="py-3 px-4">{t("admin.gateways.baseUrl")}</th>
                <th className="py-3 px-3 text-center">{t("admin.gateways.health")}</th>
                <th className="py-3 px-3 text-center">{t("admin.gateways.status")}</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {gateways.map((g) => {
                const isCircuitOpen =
                  g.circuitOpenUntil && new Date(g.circuitOpenUntil) > new Date();
                const testState = testStates[g.id];
                const isSyncing = syncStates[g.id];

                return (
                  <tr key={g.id} className="hover:bg-[var(--hover)] transition-colors">
                    {/* Primary selection */}
                    <td className="py-3 px-3 text-center">
                      <input
                        type="radio"
                        name="primary_gateway"
                        checked={g.isPrimary}
                        onChange={() => {
                          if (!g.isPrimary) setPrimaryTarget(g);
                        }}
                        className="cursor-pointer accent-[var(--accent)]"
                        title={t("admin.gateways.setPrimary")}
                      />
                    </td>

                    {/* Name + slug + wire format */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-[var(--ink)] text-sm">{g.name}</span>
                        {g.isPrimary && (
                          <span className="px-1.5 py-0.2 rounded-[4px] text-[10px] font-semibold bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)]/20">
                            PRIMARY
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[var(--muted)] font-mono">
                        <span>{g.slug}</span>
                        <span>•</span>
                        <span className="px-1 rounded bg-[var(--surface)] border border-[var(--border)]">
                          {g.wireApi}
                        </span>
                        <span>•</span>
                        <span>prio: {g.priority}</span>
                      </div>
                    </td>

                    {/* Base URL & masked API key */}
                    <td className="py-3 px-4 font-mono">
                      <div className="text-[12px] text-[var(--ink)] truncate max-w-[280px]" title={g.baseUrl}>
                        {g.baseUrl}
                      </div>
                      <div className="text-[11px] text-[var(--muted)] flex items-center gap-2 mt-0.5">
                        <span>key: {g.apiKeyLast4 ? `••••${g.apiKeyLast4}` : "none"}</span>
                        <span>•</span>
                        <span>{g.modelsPath}</span>
                      </div>
                    </td>

                    {/* Health & Circuit */}
                    <td className="py-3 px-3 text-center">
                      <div className="flex flex-col items-center gap-1">
                        {renderHealthBadge(g.healthStatus)}
                        {isCircuitOpen && (
                          <div className="flex items-center gap-1">
                            <span className="px-1.5 py-0.2 rounded text-[10px] bg-red-500/10 text-red-500 border border-red-500/20 font-mono">
                              Circuit Open
                            </span>
                            <Tooltip content={t("admin.gateways.resetCircuit")} side="top">
                              <button
                                type="button"
                                onClick={() => handleResetCircuit(g)}
                                className="p-1 rounded text-red-500 hover:bg-red-500/20 transition-colors cursor-pointer"
                                aria-label="Reset circuit"
                              >
                                <RotateCcw className="w-3 h-3" />
                              </button>
                            </Tooltip>
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Enabled / Disabled */}
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-[4px] text-[11px] font-medium ${
                          g.isEnabled
                            ? "bg-emerald-500/10 text-emerald-500"
                            : "bg-zinc-500/10 text-zinc-400"
                        }`}
                      >
                        {g.isEnabled ? t("admin.gateways.enabled") : t("admin.gateways.disabled")}
                      </span>
                    </td>

                    {/* Actions toolbar */}
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {testState?.latencyMs !== undefined && (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                              testState.success
                                ? "bg-emerald-500/10 text-emerald-500"
                                : "bg-red-500/10 text-red-500"
                            }`}
                          >
                            {testState.latencyMs}ms
                          </span>
                        )}

                        <Tooltip content={t("admin.gateways.test")} side="top">
                          <Button
                            variant="secondary"
                            size="icon-sm"
                            onClick={() => handleTest(g)}
                            disabled={testState?.testing}
                            aria-label={t("admin.gateways.test")}
                          >
                            <Zap className={`w-3.5 h-3.5 ${testState?.testing ? "animate-pulse text-[var(--accent)]" : ""}`} />
                          </Button>
                        </Tooltip>

                        <Tooltip content={t("admin.gateways.sync")} side="top">
                          <Button
                            variant="secondary"
                            size="icon-sm"
                            onClick={() => handleSync(g)}
                            disabled={isSyncing}
                            aria-label={t("admin.gateways.sync")}
                          >
                            <Sparkles className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin text-[var(--accent)]" : ""}`} />
                          </Button>
                        </Tooltip>

                        <Tooltip content={t("admin.gateways.edit")} side="top">
                          <Button
                            variant="secondary"
                            size="icon-sm"
                            onClick={() => {
                              setSelectedGateway(g);
                              setModalOpen(true);
                            }}
                            aria-label={t("admin.gateways.edit")}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                        </Tooltip>

                        <Tooltip content={t("admin.gateways.delete")} side="top">
                          <Button
                            variant="danger"
                            size="icon-sm"
                            onClick={() => setDeleteTarget(g)}
                            disabled={g.isPrimary}
                            aria-label={t("admin.gateways.delete")}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      <GatewayModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        gateway={selectedGateway}
        onSaved={fetchGateways}
      />

      <DeleteGatewayModal
        gateway={deleteTarget}
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        loading={actionLoading}
      />

      <SetPrimaryGatewayModal
        gateway={primaryTarget}
        isOpen={Boolean(primaryTarget)}
        onClose={() => setPrimaryTarget(null)}
        onConfirm={confirmSetPrimary}
        loading={actionLoading}
      />
    </div>
  );
}
