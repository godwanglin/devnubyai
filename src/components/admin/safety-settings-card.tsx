"use client";

import React, { useEffect, useMemo, useState } from "react";
import { HelpCircle, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { CustomSelect, type CustomSelectOption } from "@/components/ui/custom-select";
import { useToast } from "@/providers/toast-provider";

interface ClassifierModelOption {
  publicId: string;
  displayName: string;
  routeCount: number;
}

/** Sentinel for "gate off" (CustomSelect values are non-empty strings) */
const DISABLED = "__off__";

export function SafetySettingsCard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedModel, setSavedModel] = useState<string>(DISABLED);
  const [selectedModel, setSelectedModel] = useState<string>(DISABLED);
  const [availableModels, setAvailableModels] = useState<ClassifierModelOption[]>([]);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/admin/settings/safety", { credentials: "same-origin" })
      .then((res) => {
        if (!res.ok) throw new Error("Gagal mengambil pengaturan filter keamanan");
        return res.json();
      })
      .then((json) => {
        if (!active) return;
        const current = json?.data?.settings?.classifierModelId || DISABLED;
        setSavedModel(current);
        setSelectedModel(current);
        setAvailableModels(json?.data?.availableModels || []);
      })
      .catch((err) => {
        if (!active) return;
        toast(err instanceof Error ? err.message : "Gagal memuat pengaturan filter keamanan");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [toast]);

  const selectOptions: CustomSelectOption<string>[] = useMemo(
    () => [
      { value: DISABLED, label: "Nonaktif (tanpa filter)" },
      ...availableModels.map((m) => ({
        value: m.publicId,
        label: `${m.displayName} (${m.publicId}) — ${m.routeCount} route`,
      })),
    ],
    [availableModels]
  );

  const isDirty = selectedModel !== savedModel;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/v1/admin/settings/safety", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classifierModelId: selectedModel === DISABLED ? null : selectedModel }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error?.message || "Gagal menyimpan filter keamanan");
      }
      const updated = json.data?.settings?.classifierModelId || DISABLED;
      setSavedModel(updated);
      setSelectedModel(updated);
      toast(updated === DISABLED ? "Filter keamanan dinonaktifkan" : "Model filter keamanan disimpan!");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Gagal menyimpan filter keamanan");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-[14px] border border-[var(--border)] bg-[var(--panel)] p-5 sm:p-6 space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-rose-500/10 text-rose-400">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink)]">Filter Keamanan Permintaan</h3>
            <p className="text-xs text-[var(--muted)]">
              Setiap pesan user dinilai dulu oleh model ini. Permintaan yang jelas ilegal atau berbahaya langsung ditolak tanpa diteruskan ke provider model chat.
            </p>
          </div>
        </div>
        {isDirty ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            Belum Disimpan
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-[var(--muted)] gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
          <span>Memuat konfigurasi filter keamanan...</span>
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-medium text-[var(--ink)]">Model Penilai</label>
              <Tooltip content="Pilih model cepat yang provider-nya tidak sensitif terhadap teks keamanan, karena pesan user juga dikirim ke model ini. Jika model penilai gagal atau timeout, pesan tetap diteruskan (fail-open).">
                <HelpCircle className="w-3.5 h-3.5 text-[var(--muted)] cursor-help shrink-0" />
              </Tooltip>
            </div>
            <CustomSelect<string>
              options={selectOptions}
              value={selectedModel}
              onChange={(val) => setSelectedModel(val)}
              placeholder="Pilih model penilai..."
              searchable
            />
          </div>

          <div className="flex items-center justify-between pt-2">
            <span className="text-[11px] text-[var(--placeholder)]">
              Status saat ini:{" "}
              <code className="text-rose-400 font-mono">{savedModel === DISABLED ? "Nonaktif" : savedModel}</code>
            </span>
            <Button type="submit" size="sm" disabled={!isDirty || saving}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              Simpan Filter
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
