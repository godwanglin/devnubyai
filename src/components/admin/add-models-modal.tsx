"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Search,
  Plus,
  RefreshCw,
  Loader2,
  CheckSquare,
  Square,
  Bot,
  Brain,
  Eye,
  AlertCircle,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DiscoveredModel } from "@/lib/oauth/model-capabilities";

interface DiscoveryResult {
  supported: boolean;
  models: DiscoveredModel[];
  warning?: string;
}

interface AddModelsModalProps {
  providerId: string;
  isOpen: boolean;
  existingKeys: Set<string>;
  onClose: () => void;
  onImportSuccess: (count: number) => void;
}

export function AddModelsModal({
  providerId,
  isOpen,
  existingKeys,
  onClose,
  onImportSuccess,
}: AddModelsModalProps) {
  const [activeTab, setActiveTab] = useState<"discover" | "manual">("discover");
  // Parent mounts this modal per open, so state starts fresh and loading begins immediately
  const [loading, setLoading] = useState(true);
  const [discoveredList, setDiscoveredList] = useState<DiscoveredModel[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // Manual input state
  const [manualKey, setManualKey] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  // Submitting
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Pure fetch: never touches state, so the effect below only sets state in its .then callback
  const fetchDiscovery = useCallback(async (): Promise<DiscoveryResult> => {
    try {
      const res = await fetch(
        `/api/v1/admin/gateway/providers/${providerId}/models?discover=true`,
        { credentials: "same-origin" }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || "Gagal fetch /models");
      return json.data as DiscoveryResult;
    } catch (err: unknown) {
      return {
        supported: false,
        models: [],
        warning: err instanceof Error ? err.message : "Gagal fetch /models",
      };
    }
  }, [providerId]);

  const applyDiscovery = useCallback((data: DiscoveryResult) => {
    setDiscoveredList(data.models || []);
    setWarning(data.warning ?? null);
    if (!data.supported && (data.models || []).length === 0) setActiveTab("manual");
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    void fetchDiscovery().then((data) => {
      if (active) applyDiscovery(data);
    });
    return () => {
      active = false;
    };
  }, [isOpen, fetchDiscovery, applyDiscovery]);

  function handleRefresh() {
    setLoading(true);
    setWarning(null);
    void fetchDiscovery().then(applyDiscovery);
  }

  const filteredDiscovered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return discoveredList.filter((m) => {
      if (!q) return true;
      return (
        m.modelKey.toLowerCase().includes(q) ||
        m.displayName.toLowerCase().includes(q)
      );
    });
  }, [discoveredList, searchQuery]);

  function toggleSelect(key: string) {
    if (existingKeys.has(key)) return;
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSelectAll() {
    const selectable = filteredDiscovered.filter(
      (m) => !existingKeys.has(m.modelKey)
    );
    const allSelected = selectable.every((m) => selectedKeys.has(m.modelKey));
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const m of selectable) next.delete(m.modelKey);
      } else {
        for (const m of selectable) next.add(m.modelKey);
      }
      return next;
    });
  }

  async function handleImportSelected() {
    if (selectedKeys.size === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const byKey = new Map(discoveredList.map((m) => [m.modelKey, m]));
      const items = Array.from(selectedKeys).map((key) => {
        const item = byKey.get(key);
        return {
          modelKey: key,
          ownedBy: item?.ownedBy || providerId,
          rawMetadata: item?.raw || null,
        };
      });

      const res = await fetch(`/api/v1/admin/gateway/providers/${providerId}/models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
        credentials: "same-origin",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || "Import failed");
      onImportSuccess(items.length);
      onClose();
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddManual() {
    const key = manualKey.trim();
    if (!key) {
      setManualError("Nama model wajib diisi");
      return;
    }
    if (existingKeys.has(key)) {
      setManualError("Model ini sudah ada di database");
      return;
    }

    setSubmitting(true);
    setManualError(null);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/v1/admin/gateway/providers/${providerId}/models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ modelKey: key, ownedBy: providerId, rawMetadata: null }],
        }),
        credentials: "same-origin",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || "Import failed");
      onImportSuccess(1);
      onClose();
    } catch (err: unknown) {
      setManualError(err instanceof Error ? err.message : "Gagal menyimpan model");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Models"
      description={`Import model upstream untuk provider ${providerId} ke database.`}
      maxWidth="lg"
    >
      <div className="space-y-4 text-xs">
        {/* Tab switcher: Upstream /models vs Manual */}
        <div className="flex items-center gap-1 p-1 rounded-[8px] bg-[var(--surface)] border border-[var(--border)]">
          <button
            type="button"
            onClick={() => setActiveTab("discover")}
            className={`flex-1 py-1.5 px-3 rounded-[6px] font-medium transition-colors cursor-pointer text-center ${
              activeTab === "discover"
                ? "bg-[var(--panel)] text-[var(--ink)] shadow-xs"
                : "text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
          >
            Fetch Upstream /models
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("manual")}
            className={`flex-1 py-1.5 px-3 rounded-[6px] font-medium transition-colors cursor-pointer text-center ${
              activeTab === "manual"
                ? "bg-[var(--panel)] text-[var(--ink)] shadow-xs"
                : "text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
          >
            Input Manual
          </button>
        </div>

        {submitError && (
          <div className="p-2.5 rounded-[8px] bg-red-500/10 border border-red-500/20 text-red-500 flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{submitError}</span>
          </div>
        )}

        {/* Tab 1: Discover */}
        {activeTab === "discover" && (
          <div className="space-y-3">
            {warning && (
              <div className="p-2.5 rounded-[8px] bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[11px] flex items-start gap-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{warning}</span>
              </div>
            )}

            {loading ? (
              <div className="py-12 text-center space-y-2 text-[var(--muted)]">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-[var(--muted)]" />
                <p>Mengambil daftar model dari upstream /models...</p>
              </div>
            ) : discoveredList.length === 0 ? (
              <div className="py-8 text-center space-y-2 text-[var(--muted)] border border-dashed border-[var(--border)] rounded-[10px]">
                <Bot className="w-6 h-6 mx-auto opacity-50" />
                <p>Upstream tidak mengembalikan model atau belum mendukung /models.</p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setActiveTab("manual")}
                >
                  Beralih ke Input Manual
                </Button>
              </div>
            ) : (
              <>
                {/* Search & Select All */}
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Cari model upstream..."
                      className="pl-8 text-xs"
                    />
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={toggleSelectAll}
                    className="shrink-0"
                  >
                    Select All
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRefresh}
                    disabled={loading}
                    className="shrink-0"
                    title="Refresh /models"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </Button>
                </div>

                {/* Model list */}
                <div className="max-h-[280px] overflow-y-auto space-y-1.5 pr-1 border border-[var(--border)] rounded-[8px] p-2 bg-[var(--surface)]">
                  {filteredDiscovered.map((m) => {
                    const isExisting = existingKeys.has(m.modelKey);
                    const isSelected = selectedKeys.has(m.modelKey);
                    return (
                      <div
                        key={m.modelKey}
                        onClick={() => toggleSelect(m.modelKey)}
                        className={`flex items-center justify-between p-2 rounded-[6px] border transition-colors ${
                          isExisting
                            ? "bg-[var(--panel)]/40 border-[var(--border)]/40 opacity-50 cursor-not-allowed"
                            : isSelected
                            ? "bg-[var(--panel)] border-[var(--primary)] cursor-pointer"
                            : "bg-[var(--panel)] border-[var(--border)] hover:border-[var(--border-strong)] cursor-pointer"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          {isExisting ? (
                            <CheckSquare className="w-4 h-4 text-[var(--muted)] shrink-0" />
                          ) : isSelected ? (
                            <CheckSquare className="w-4 h-4 text-[var(--primary)] shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-[var(--muted)] shrink-0" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="font-mono text-[11px] font-medium text-[var(--ink)] truncate">
                              {m.modelKey}
                            </div>
                            {m.displayName !== m.modelKey && (
                              <div className="text-[10px] text-[var(--muted)] truncate">
                                {m.displayName}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {m.capabilities.reasoning && (
                            <Brain className="w-3 h-3 text-[var(--primary)]" aria-label="Reasoning" />
                          )}
                          {m.capabilities.vision && (
                            <Eye className="w-3 h-3 text-[var(--ink)]" aria-label="Vision" />
                          )}
                          {isExisting && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)]">
                              Sudah di-import
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between text-[11px] text-[var(--muted)] pt-1">
                  <span>
                    {selectedKeys.size} model dipilih dari {discoveredList.length} upstream
                  </span>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
                      Batal
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleImportSelected}
                      disabled={submitting || selectedKeys.size === 0}
                    >
                      {submitting ? "Mengimpor..." : `Import (${selectedKeys.size})`}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Tab 2: Manual Input */}
        {activeTab === "manual" && (
          <div className="space-y-4">
            <p className="text-[var(--muted)]">
              Masukkan nama model upstream secara manual jika endpoint /models tidak tersedia atau
              model baru belum terdaftar di upstream.
            </p>

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-[var(--ink)]">
                Upstream Model ID
              </label>
              <Input
                value={manualKey}
                onChange={(e) => {
                  setManualKey(e.target.value);
                  setManualError(null);
                }}
                placeholder="misal: grok-4.7, grok-2-vision-1212, ..."
                className="font-mono text-xs"
                hasError={!!manualError}
                autoFocus
              />
              {manualError && (
                <p className="text-[11px] text-red-500">{manualError}</p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
              <Button variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
                Batal
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleAddManual}
                disabled={submitting || !manualKey.trim()}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{submitting ? "Menyimpan..." : "Tambah Model"}</span>
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
