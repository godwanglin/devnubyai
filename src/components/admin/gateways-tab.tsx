"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { GatewayModal } from "./gateway-modal";
import { DeleteGatewayModal, SetPrimaryGatewayModal } from "./gateway-confirm-modals";
import { GatewayTableRow, type TestResult } from "./gateway-table-row";
import type { SanitizedGatewayDto } from "@/lib/gateways/admin-service";

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

  // Pagination state (default 10)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

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

  const hasLoadedRef = useRef(false);
  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    void fetchGateways();
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

  const displayedGateways = gateways.slice((page - 1) * pageSize, page * pageSize);

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
              {displayedGateways.map((g) => (
                <GatewayTableRow
                  key={g.id}
                  gateway={g}
                  testState={testStates[g.id]}
                  isSyncing={syncStates[g.id]}
                  onSetPrimary={(target) => setPrimaryTarget(target)}
                  onTest={(target) => handleTest(target)}
                  onResetCircuit={(target) => handleResetCircuit(target)}
                  onSyncModels={(target) => handleSync(target)}
                  onEdit={(target) => {
                    setSelectedGateway(target);
                    setModalOpen(true);
                  }}
                  onDelete={(target) => setDeleteTarget(target)}
                  t={t}
                />
              ))}
            </tbody>
          </table>
          <DataTablePagination
            page={page}
            pageSize={pageSize}
            totalItems={gateways.length}
            onPageChange={setPage}
            onPageSizeChange={(newSize) => {
              setPageSize(newSize);
              setPage(1);
            }}
            disabled={loading}
          />
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
