"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, ImageIcon, Sparkles, HelpCircle, ChevronUp, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { CustomSelect, type CustomSelectOption } from "@/components/ui/custom-select";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";

interface ImageModelOption {
  publicId: string;
  displayName: string;
  routeCount: number;
}

interface ImageSettingsState {
  catalogModelId: string;
  fallbackModelIds: string[];
}

const EMPTY_SETTINGS: ImageSettingsState = { catalogModelId: "", fallbackModelIds: [] };

/** Moves one item of a list up or down, returning a new list. */
function moveItem(list: string[], index: number, direction: -1 | 1): string[] {
  const target = index + direction;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function sameSettings(a: ImageSettingsState, b: ImageSettingsState): boolean {
  return a.catalogModelId === b.catalogModelId && a.fallbackModelIds.join("|") === b.fallbackModelIds.join("|");
}

export function ImageSettingsCard() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<ImageSettingsState>(EMPTY_SETTINGS);
  const [draft, setDraft] = useState<ImageSettingsState>(EMPTY_SETTINGS);
  const [availableModels, setAvailableModels] = useState<ImageModelOption[]>([]);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/admin/settings/image", { credentials: "same-origin" })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error?.message);
        if (!active) return;
        const settings: ImageSettingsState = {
          catalogModelId: json?.data?.settings?.catalogModelId || "",
          fallbackModelIds: Array.isArray(json?.data?.settings?.fallbackModelIds)
            ? json.data.settings.fallbackModelIds
            : [],
        };
        setSaved(settings);
        setDraft(settings);
        setAvailableModels(json?.data?.availableModels || []);
      })
      .catch((err) => {
        if (!active) return;
        toast(err instanceof Error && err.message ? err.message : t("admin.imageSettings.loadFailed"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [toast, t]);

  const byId = useMemo(() => new Map(availableModels.map((m) => [m.publicId, m])), [availableModels]);

  const optionOf = useCallback(
    (m: ImageModelOption): CustomSelectOption<string> => ({
      value: m.publicId,
      label: m.displayName,
      sublabel: `${m.publicId} — ${t("admin.imageSettings.routes", { count: m.routeCount })}`,
    }),
    [t]
  );

  const primaryOptions = useMemo(() => availableModels.map(optionOf), [availableModels, optionOf]);

  // A model is either the primary or one fallback, never both
  const fallbackOptions = useMemo(
    () =>
      availableModels
        .filter((m) => m.publicId !== draft.catalogModelId && !draft.fallbackModelIds.includes(m.publicId))
        .map(optionOf),
    [availableModels, draft, optionOf]
  );

  const isDirty = !sameSettings(draft, saved);

  function setPrimary(publicId: string) {
    setDraft((prev) => ({
      catalogModelId: publicId,
      fallbackModelIds: prev.fallbackModelIds.filter((id) => id !== publicId),
    }));
  }

  function addFallback(publicId: string) {
    setDraft((prev) =>
      prev.fallbackModelIds.includes(publicId) || publicId === prev.catalogModelId
        ? prev
        : { ...prev, fallbackModelIds: [...prev.fallbackModelIds, publicId] }
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.catalogModelId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/v1/admin/settings/image", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalogModelId: draft.catalogModelId, fallbackModelIds: draft.fallbackModelIds }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error?.message);
      const updated: ImageSettingsState = {
        catalogModelId: json.data?.settings?.catalogModelId || draft.catalogModelId,
        fallbackModelIds: json.data?.settings?.fallbackModelIds || draft.fallbackModelIds,
      };
      setSaved(updated);
      setDraft(updated);
      toast(t("admin.imageSettings.saved"));
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : t("admin.imageSettings.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  const savedFallback = saved.fallbackModelIds.map((id) => byId.get(id)?.displayName ?? id).join(" → ");

  return (
    <div className="rounded-[14px] border border-[var(--border)] bg-[var(--panel)] p-5 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-indigo-500/10 text-indigo-400">
            <ImageIcon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink)]">{t("admin.imageSettings.title")}</h3>
            <p className="text-xs text-[var(--muted)]">{t("admin.imageSettings.description")}</p>
          </div>
        </div>
        {isDirty ? (
          <span className="inline-flex shrink-0 items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            {t("admin.imageSettings.unsaved")}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-[var(--muted)] gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
          <span>{t("admin.imageSettings.loading")}</span>
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-medium text-[var(--ink)]">{t("admin.imageSettings.primaryLabel")}</label>
              <Tooltip content={t("admin.imageSettings.primaryHint")}>
                <HelpCircle className="w-3.5 h-3.5 text-[var(--muted)] cursor-help shrink-0" />
              </Tooltip>
            </div>

            {primaryOptions.length > 0 ? (
              <CustomSelect<string>
                options={primaryOptions}
                value={draft.catalogModelId}
                onChange={setPrimary}
                placeholder={t("admin.imageSettings.placeholder")}
                searchable
              />
            ) : (
              <div className="p-4 rounded-[10px] border border-amber-500/20 bg-amber-500/[0.04] text-xs text-amber-300 space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                  {t("admin.imageSettings.emptyTitle")}
                </p>
                <p className="text-[11px] text-[var(--muted)]">{t("admin.imageSettings.emptyHint")}</p>
              </div>
            )}
          </div>

          {primaryOptions.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-medium text-[var(--ink)]">{t("admin.imageSettings.fallbackLabel")}</label>
                <Tooltip content={t("admin.imageSettings.fallbackHint")}>
                  <HelpCircle className="w-3.5 h-3.5 text-[var(--muted)] cursor-help shrink-0" />
                </Tooltip>
              </div>

              {draft.fallbackModelIds.length > 0 ? (
                <ol className="space-y-1.5">
                  {draft.fallbackModelIds.map((id, index) => {
                    const model = byId.get(id);
                    return (
                      <li
                        key={id}
                        className="flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
                      >
                        <span className="w-5 shrink-0 text-center text-[11px] font-semibold text-[var(--muted)]">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-[var(--ink)]">
                            {model?.displayName ?? id}
                          </span>
                          <span className="block truncate font-mono text-[10px] text-[var(--muted)]">{id}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setDraft((prev) => ({ ...prev, fallbackModelIds: moveItem(prev.fallbackModelIds, index, -1) }))}
                          disabled={index === 0}
                          aria-label={t("admin.imageSettings.moveUp")}
                          className="rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] disabled:opacity-30"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDraft((prev) => ({ ...prev, fallbackModelIds: moveItem(prev.fallbackModelIds, index, 1) }))}
                          disabled={index === draft.fallbackModelIds.length - 1}
                          aria-label={t("admin.imageSettings.moveDown")}
                          className="rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] disabled:opacity-30"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDraft((prev) => ({ ...prev, fallbackModelIds: prev.fallbackModelIds.filter((f) => f !== id) }))}
                          aria-label={t("admin.imageSettings.remove")}
                          className="rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-rose-400"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ol>
              ) : null}

              {fallbackOptions.length > 0 ? (
                <CustomSelect<string>
                  key={`fallback-${draft.fallbackModelIds.length}`}
                  options={fallbackOptions}
                  value=""
                  onChange={addFallback}
                  placeholder={t("admin.imageSettings.fallbackPlaceholder")}
                  searchable
                />
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <span className="text-[11px] text-[var(--placeholder)]">
              {t("admin.imageSettings.current")}:{" "}
              <code className="font-mono text-indigo-400">
                {saved.catalogModelId || t("admin.imageSettings.notSet")}
              </code>
              {savedFallback ? ` → ${savedFallback}` : saved.catalogModelId ? ` (${t("admin.imageSettings.noFallback")})` : ""}
            </span>
            <Button type="submit" size="sm" disabled={!isDirty || saving || primaryOptions.length === 0}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              {t("admin.imageSettings.save")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
