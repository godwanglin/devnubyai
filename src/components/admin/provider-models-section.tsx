"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Bot, Plus, RefreshCw, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/providers/toast-provider";
import { ModelCard, type ModelCardItem, type PingFeedback } from "./model-card";
import { AddModelsModal } from "./add-models-modal";

interface ProviderModelsSectionProps {
  providerId: string;
  /** The page header owns the "Add Model" button next to "Add Connection" */
  addModalOpen: boolean;
  setAddModalOpen: (open: boolean) => void;
}

export function ProviderModelsSection({
  providerId,
  addModalOpen,
  setAddModalOpen,
}: ProviderModelsSectionProps) {
  const { toast } = useToast();
  const [models, setModels] = useState<ModelCardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Ping tracking per modelKey
  const [pingMap, setPingMap] = useState<Record<string, PingFeedback>>({});

  // Delete confirmation modal (no native confirm!)
  const [deleteTarget, setDeleteTarget] = useState<ModelCardItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/admin/gateway/providers/${providerId}/models`, {
        credentials: "same-origin",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || "Gagal memuat model");
      setModels(json.data.models || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal memuat model";
      setError(msg);
      toast(msg);
    } finally {
      setLoading(false);
    }
  }, [providerId, toast]);

  useEffect(() => {
    void fetchModels();
  }, [fetchModels]);

  const existingKeys = useMemo(
    () => new Set(models.map((m) => m.modelKey)),
    [models]
  );

  async function handlePing(modelKey: string) {
    setPingMap((prev) => ({
      ...prev,
      [modelKey]: { status: "running" },
    }));

    try {
      const res = await fetch(`/api/v1/admin/gateway/providers/${providerId}/models/ping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelKey }),
        credentials: "same-origin",
      });
      const json = await res.json().catch(() => ({}));
      const ping = json.data?.ping;

      if (!res.ok || !ping?.success) {
        const msg = ping?.error || json?.error?.message || "Ping failed";
        setPingMap((prev) => ({
          ...prev,
          [modelKey]: { status: "error", message: msg },
        }));
      } else {
        setPingMap((prev) => ({
          ...prev,
          [modelKey]: {
            status: "success",
            latencyMs: ping.latencyMs,
            message: ping.outputPreview || "OK",
          },
        }));
      }
    } catch (err: unknown) {
      setPingMap((prev) => ({
        ...prev,
        [modelKey]: {
          status: "error",
          message: err instanceof Error ? err.message : "Network error",
        },
      }));
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/v1/admin/gateway/providers/${providerId}/models/${deleteTarget.id}`,
        { method: "DELETE", credentials: "same-origin" }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || "Gagal menghapus model");

      setModels((prev) => prev.filter((m) => m.id !== deleteTarget.id));
      toast(`Model ${deleteTarget.modelKey} berhasil dihapus`);
      setDeleteTarget(null);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Gagal menghapus model");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Section Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--ink)] flex items-center gap-2">
              <Bot className="w-4 h-4 text-[var(--primary)]" />
              <span>Models</span>
            </h3>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)]">
              {models.length} model
            </span>
          </div>
          <p className="text-xs text-[var(--muted)]">
            Model yang di-import dari upstream. Hover kartu untuk ping atau delete model.
          </p>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setLoading(true);
            void fetchModels();
          }}
          disabled={loading}
          title="Refresh models"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {error && (
        <div className="p-3 rounded-[8px] bg-red-500/10 border border-red-500/20 text-xs text-red-500 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Grid of Model Cards (Screenshot 3 layout) */}
      {loading ? (
        <div className="py-12 text-center space-y-2 text-[var(--muted)] border border-dashed border-[var(--border)] rounded-[12px]">
          <Loader2 className="w-5 h-5 animate-spin mx-auto text-[var(--muted)]" />
          <p className="text-xs">Memuat daftar model...</p>
        </div>
      ) : models.length === 0 ? (
        <div className="py-12 text-center space-y-3 text-[var(--muted)] border border-dashed border-[var(--border)] rounded-[12px] bg-[var(--surface)]/30">
          <Bot className="w-8 h-8 mx-auto opacity-40 text-[var(--muted)]" />
          <div className="space-y-1">
            <p className="text-xs font-medium text-[var(--ink)]">Belum ada model yang di-import</p>
            <p className="text-[11px]">
              Klik tombol &ldquo;Add Model&rdquo; di atas untuk discover model dari upstream atau input manual.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setAddModalOpen(true)}
            className="gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Model</span>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {models.map((model) => (
            <ModelCard
              key={model.id}
              providerId={providerId}
              model={model}
              pingState={pingMap[model.modelKey]}
              onPing={handlePing}
              onRequestDelete={setDeleteTarget}
            />
          ))}
        </div>
      )}

      {/* Add Models Modal (only mounted when open) */}
      {addModalOpen && (
        <AddModelsModal
          providerId={providerId}
          isOpen={addModalOpen}
          existingKeys={existingKeys}
          onClose={() => setAddModalOpen(false)}
          onImportSuccess={(count) => {
            toast(`${count} model berhasil di-import`);
            void fetchModels();
          }}
        />
      )}

      {/* Delete Confirmation Modal (ARCHITECTURE_RULES: no native confirm!) */}
      {deleteTarget && (
        <Modal
          isOpen={!!deleteTarget}
          onClose={() => {
            if (!deleting) setDeleteTarget(null);
          }}
          title="Hapus Model"
          description={`Yakin ingin menghapus model ${deleteTarget.modelKey} dari provider ${providerId}? Model tidak akan lagi tersedia di catalog routing.`}
          maxWidth="sm"
        >
          <div className="space-y-4 pt-2">
            <div className="p-3 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] font-mono text-xs text-[var(--ink)]">
              {providerId}/{deleteTarget.modelKey}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                Batal
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={confirmDelete}
                disabled={deleting}
              >
                {deleting ? "Menghapus..." : "Hapus Model"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
