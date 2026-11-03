"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Loader2, ImageIcon, Sparkles, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { CustomSelect, type CustomSelectOption } from "@/components/ui/custom-select";
import { useToast } from "@/providers/toast-provider";

interface ImageModelOption {
  publicId: string;
  displayName: string;
  routeCount: number;
}

export function ImageSettingsCard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedModel, setSavedModel] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [availableModels, setAvailableModels] = useState<ImageModelOption[]>([]);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/admin/settings/image", { credentials: "same-origin" })
      .then((res) => {
        if (!res.ok) throw new Error("Gagal mengambil pengaturan model gambar");
        return res.json();
      })
      .then((json) => {
        if (!active) return;
        const current = json?.data?.settings?.catalogModelId || "";
        const list: ImageModelOption[] = json?.data?.availableModels || [];
        setSavedModel(current);
        setSelectedModel(current);
        setAvailableModels(list);
      })
      .catch((err) => {
        if (!active) return;
        toast(err instanceof Error ? err.message : "Gagal memuat pengaturan model gambar");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [toast]);

  const selectOptions: CustomSelectOption<string>[] = useMemo(() => {
    return availableModels.map((m) => ({
      value: m.publicId,
      label: `${m.displayName} (${m.publicId}) — ${m.routeCount} route`,
    }));
  }, [availableModels]);

  const isDirty = selectedModel !== (savedModel || "");

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedModel) return;
    setSaving(true);
    try {
      const res = await fetch("/api/v1/admin/settings/image", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalogModelId: selectedModel }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error?.message || "Gagal menyimpan model generator gambar");
      }
      const updated = json.data?.settings?.catalogModelId || selectedModel;
      setSavedModel(updated);
      setSelectedModel(updated);
      toast("Model generator gambar aktif berhasil disimpan!");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Gagal menyimpan model");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-[14px] border border-[var(--border)] bg-[var(--panel)] p-5 sm:p-6 space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-indigo-500/10 text-indigo-400">
            <ImageIcon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink)]">
              Model Generator Gambar Aktif (Tool `generate_image`)
            </h3>
            <p className="text-xs text-[var(--muted)]">
              Kebijakan routing DB: memilih model katalog (kategori image) yang melayani permintaan pembuatan gambar AI beserta urutan route fallback-nya.
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
          <span>Memuat konfigurasi model gambar...</span>
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-medium text-[var(--ink)]">
                Pilih Model Katalog Gambar
              </label>
              <Tooltip content="Hanya model berstatus active dan berkategori 'image' di Katalog Model yang muncul di sini. Setiap model dapat memiliki multi-route fallback ke Gemini Flash Image atau Grok Imagine.">
                <HelpCircle className="w-3.5 h-3.5 text-[var(--muted)] cursor-help shrink-0" />
              </Tooltip>
            </div>

            {selectOptions.length > 0 ? (
              <CustomSelect<string>
                options={selectOptions}
                value={selectedModel}
                onChange={(val) => setSelectedModel(val)}
                placeholder="Pilih model katalog gambar..."
                searchable
              />
            ) : (
              <div className="p-4 rounded-[10px] border border-amber-500/20 bg-amber-500/[0.04] text-xs text-amber-300 space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                  Belum ada model katalog berkategori &apos;image&apos;
                </p>
                <p className="text-[11px] text-[var(--muted)]">
                  Buka menu <span className="text-[var(--ink)] font-mono">/admin/model-catalog</span>, buat model baru dengan kategori <span className="font-mono text-indigo-400">image</span>, lalu hubungkan route-nya ke upstream model gambar (Antigravity atau xAI).
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-2">
            <span className="text-[11px] text-[var(--placeholder)]">
              Model tersimpan saat ini: <code className="text-indigo-400 font-mono">{savedModel || "Belum diatur"}</code>
            </span>
            <Button type="submit" size="sm" disabled={!isDirty || saving || selectOptions.length === 0}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              Simpan Model Gambar
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
