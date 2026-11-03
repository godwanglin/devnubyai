"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Bot, Plus, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/providers/toast-provider";
import { CustomHeadersSection } from "./custom-headers-section";
import { ProviderLogo } from "./provider-logo";
import { ConnectOAuthModal } from "./connect-oauth-modal";
import { BulkImportAccountsModal } from "./bulk-import-accounts-modal";
import { ProviderModelsSection } from "./provider-models-section";
import { ConnectionCard } from "./connection-card";
import { ConfirmDialog } from "./confirm-dialog";
import { useSetAdminBreadcrumb } from "./admin-breadcrumb-context";
import type { OAuthProviderId } from "@/lib/oauth/providers";
import type { SanitizedProviderConnectionDto } from "@/lib/gateways/provider-service";

interface ProviderDetailPageProps {
  providerId: string;
}

interface ProviderDetail {
  providerId: OAuthProviderId;
  name: string;
  description: string;
  flow: "pkce" | "device_code";
  iconKey: string;
  logoUrl: string | null;
  baseUrl: string;
  wireApi: "chat" | "responses";
  gatewayId: string;
  customHeaders: Record<string, string>;
  defaultCustomHeaders: Record<string, string>;
  connections: SanitizedProviderConnectionDto[];
  quotaSupported: boolean;
}

export function ProviderDetailPage({ providerId }: ProviderDetailPageProps) {
  const { toast } = useToast();
  const [detail, setDetail] = useState<ProviderDetail | null>(null);
  const [connections, setConnections] = useState<SanitizedProviderConnectionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [addModelOpen, setAddModelOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  useSetAdminBreadcrumb([
    { label: "OAuth Providers", href: "/admin/gateway/providers" },
    { label: detail?.name || providerId },
  ]);
  const [refreshingQuota, setRefreshingQuota] = useState(false);
  const [singleQuotaLoading, setSingleQuotaLoading] = useState<Record<string, boolean>>({});

  // Drag and drop state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Delete confirmation modal state (replaces native confirm())
  const [deleteTarget, setDeleteTarget] = useState<SanitizedProviderConnectionDto | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/gateway/providers/${providerId}`, {
        credentials: "same-origin",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || "Failed to load provider");
      const d = json.data.provider as ProviderDetail;
      setDetail(d);
      setConnections(d.connections || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load provider";
      setError(msg);
      toast(msg);
    } finally {
      setLoading(false);
    }
  }, [providerId, toast]);

  const hasLoadedRef = useRef(false);
  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    void fetchDetail();
  }, [fetchDetail]);

  // Refresh all quotas
  async function handleRefreshAllQuota() {
    setRefreshingQuota(true);
    try {
      const res = await fetch(`/api/v1/admin/gateway/providers/${providerId}/quota`, {
        method: "POST",
        credentials: "same-origin",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || "Failed to refresh quotas");
      toast("Quotas refreshed");
      void fetchDetail();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Failed to refresh quotas");
    } finally {
      setRefreshingQuota(false);
    }
  }

  // Auto-refresh quota once on visit if supported and accounts exist
  // (cached quota shows first; the live fetch reloads the detail when it finishes)
  const hasAutoRefreshedQuotaRef = useRef(false);
  useEffect(() => {
    if (hasAutoRefreshedQuotaRef.current) return;
    if (detail?.quotaSupported && connections.length > 0) {
      hasAutoRefreshedQuotaRef.current = true;
      void fetch(`/api/v1/admin/gateway/providers/${providerId}/quota`, {
        method: "POST",
        credentials: "same-origin",
      })
        .then((res) => (res.ok ? fetchDetail() : undefined))
        .catch(() => undefined);
    }
  }, [detail?.quotaSupported, connections.length, providerId, fetchDetail]);

  // Refresh single account quota
  async function handleRefreshSingleQuota(connId: string) {
    setSingleQuotaLoading((prev) => ({ ...prev, [connId]: true }));
    try {
      const res = await fetch(
        `/api/v1/admin/gateway/providers/${providerId}/connections/${connId}/quota`,
        { method: "POST", credentials: "same-origin" }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || "Failed to refresh quota");

      const quota = json.data.quota;
      setConnections((prev) =>
        prev.map((c) => (c.id === connId ? { ...c, quotaCached: quota } : c))
      );
      toast("Quota updated");
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Failed to refresh quota");
    } finally {
      setSingleQuotaLoading((prev) => ({ ...prev, [connId]: false }));
    }
  }

  // Toggle connection enabled
  async function handleToggleEnabled(conn: SanitizedProviderConnectionDto) {
    const nextState = !conn.isEnabled;
    setConnections((prev) =>
      prev.map((c) => (c.id === conn.id ? { ...c, isEnabled: nextState } : c))
    );

    try {
      const res = await fetch(
        `/api/v1/admin/gateway/providers/${providerId}/connections/${conn.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isEnabled: nextState }),
          credentials: "same-origin",
        }
      );
      if (!res.ok) throw new Error("Failed to update status");
    } catch {
      setConnections((prev) =>
        prev.map((c) => (c.id === conn.id ? { ...c, isEnabled: conn.isEnabled } : c))
      );
      toast("Failed to update connection status");
    }
  }

  // Confirm delete connection (uses ConfirmDialog, no native confirm())
  async function confirmDeleteConnection() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/v1/admin/gateway/providers/${providerId}/connections/${deleteTarget.id}`,
        { method: "DELETE", credentials: "same-origin" }
      );
      if (!res.ok) throw new Error("Failed to delete connection");
      setConnections((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      toast("Account disconnected");
      setDeleteTarget(null);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  }

  // Drag and drop reordering
  function handleDragStart(index: number) {
    setDraggedIndex(index);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  function handleDrop(targetIndex: number) {
    if (draggedIndex === null || draggedIndex === targetIndex) return;

    const list = [...connections];
    const [moved] = list.splice(draggedIndex, 1);
    list.splice(targetIndex, 0, moved);

    setConnections(list);
    setDraggedIndex(null);
    void saveReorder(list.map((c) => c.id));
  }

  async function saveReorder(orderedIds: string[]) {
    try {
      const res = await fetch(
        `/api/v1/admin/gateway/providers/${providerId}/connections/reorder`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderedIds }),
          credentials: "same-origin",
        }
      );
      if (!res.ok) throw new Error("Failed to save reorder");
      toast("Account priority updated");
    } catch {
      toast("Failed to save account priority");
      void fetchDetail();
    }
  }

  async function handleSaveHeaders(newHeaders: Record<string, string>) {
    try {
      const res = await fetch(`/api/v1/admin/gateway/providers/${providerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          headers: newHeaders,
          customHeaders: newHeaders,
        }),
        credentials: "same-origin",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || "Failed to save headers");
      toast("Custom headers updated");
      if (detail) {
        setDetail({ ...detail, customHeaders: newHeaders });
      }
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Failed to save");
      throw err;
    }
  }

  return (
    <div className="space-y-6">
      {/* Header (breadcrumb lives in the admin topbar) */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ProviderLogo logoUrl={detail?.logoUrl} size="sm" />
            <h2 className="text-xl font-semibold text-[var(--ink)]">{detail?.name || providerId}</h2>
          </div>
          <p className="text-xs text-[var(--muted)]">{detail?.description}</p>
        </div>

        <div className="flex items-center gap-2">
          {detail?.quotaSupported && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRefreshAllQuota}
              disabled={refreshingQuota || loading || connections.length === 0}
              className="text-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshingQuota ? "animate-spin" : ""}`} />
              <span>Refresh Quotas</span>
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setAddModelOpen(true)}
            className="text-xs gap-1"
          >
            <Bot className="w-3.5 h-3.5" />
            <span>Add Model</span>
          </Button>
          {providerId === "openai" && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setBulkOpen(true)}
              className="text-xs gap-1"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Bulk Import</span>
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => setModalOpen(true)}
            className="text-xs gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Connection</span>
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-[8px] bg-red-500/10 border border-red-500/20 text-xs text-red-500">
          {error}
        </div>
      )}

      {/* Custom Headers Accordion (default collapsed) */}
      {detail && (
        <CustomHeadersSection
          headers={detail.customHeaders}
          defaultHeaders={detail.defaultCustomHeaders}
          onSave={handleSaveHeaders}
          disabled={loading}
        />
      )}

      {/* Models Section: Grid card, Ping per model, Add Model modal */}
      <ProviderModelsSection
        providerId={providerId}
        addModalOpen={addModelOpen}
        setAddModalOpen={setAddModelOpen}
      />

      {/* Multi-Account Connections List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink)]">
              Connected Accounts ({connections.length})
            </h3>
            <p className="text-[11px] text-[var(--muted)]">
              Urutan akun menentukan prioritas routing. Drag pegangan di sebelah kiri untuk mengatur urutan.
            </p>
          </div>
          <span className="text-[11px] text-[var(--muted)]">
            {connections.filter((c) => c.isEnabled).length} aktif menerima trafik
          </span>
        </div>

        {connections.length === 0 && !loading ? (
          <div className="p-10 text-center rounded-[12px] border border-dashed border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] space-y-2">
            <p className="text-xs">Belum ada akun yang terhubung untuk provider ini.</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setModalOpen(true)}
              className="text-xs"
            >
              Hubungkan Akun Pertama
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
            {connections.map((conn, idx) => (
              <ConnectionCard
                key={conn.id}
                providerId={providerId}
                conn={conn}
                onQuotaUpdated={(quota) => {
                  if (quota) {
                    setConnections((prev) =>
                      prev.map((c) => (c.id === conn.id ? { ...c, quotaCached: quota, cooldownUntil: null } : c))
                    );
                  } else {
                    void fetchDetail();
                  }
                }}
                index={idx}
                quotaSupported={detail?.quotaSupported ?? false}
                quotaLoading={singleQuotaLoading[conn.id] || false}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onToggleEnabled={handleToggleEnabled}
                onRefreshQuota={handleRefreshSingleQuota}
                onRequestDelete={setDeleteTarget}
              />
            ))}
          </div>
        )}
      </div>

      {/* Connect OAuth Modal (only mounted when open) */}
      {detail && modalOpen && (
        <ConnectOAuthModal
          providerId={detail.providerId}
          providerName={detail.name}
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          onSuccess={() => {
            toast("Account connected successfully!");
            void fetchDetail();
          }}
        />
      )}

      {/* Bulk Import Accounts (OpenAI only, mounted when open) */}
      {detail && bulkOpen && (
        <BulkImportAccountsModal
          providerId={detail.providerId}
          providerName={detail.name}
          isOpen={bulkOpen}
          onClose={() => setBulkOpen(false)}
          onSuccess={() => void fetchDetail()}
        />
      )}

      {/* Disconnect Account Confirmation (replaces native confirm()) */}
      {deleteTarget && (
        <ConfirmDialog
          isOpen={!!deleteTarget}
          title="Disconnect Account"
          description={`Yakin ingin memutuskan koneksi akun "${
            deleteTarget.label || deleteTarget.email || deleteTarget.displayName || deleteTarget.id
          }"? Token akses akan dihapus dari pool.`}
          confirmLabel="Disconnect"
          busy={deleting}
          onConfirm={confirmDeleteConnection}
          onClose={() => {
            if (!deleting) setDeleteTarget(null);
          }}
        />
      )}
    </div>
  );
}
