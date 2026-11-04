"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Loader2, Sliders, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { CustomSelect, type CustomSelectOption } from "@/components/ui/custom-select";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { useAccount } from "@/providers/account-provider";
import { MAX_TOOL_ROUNDS_LIMIT, type ChatSettings } from "@/lib/chat/settings-shared";
import { DatabasePoolConfigCard } from "./database-pool-config-card";
import { NetworkRulesConfigCard } from "./network-rules-config-card";
import { LegalSettingsCard } from "./legal-settings-card";
import { ImageSettingsCard } from "./image-settings-card";

/** Sentinel for "no explicit model" (CustomSelect values are non-empty strings) */
const AUTO_MODEL = "__auto__";

export function SettingsTab() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { refresh: refreshAccount } = useAccount();

  const [saved, setSaved] = useState<ChatSettings | null>(null);
  const [maxToolRounds, setMaxToolRounds] = useState("");
  const [toolDebug, setToolDebug] = useState(false);
  const [homeSuggestionsModel, setHomeSuggestionsModel] = useState("");
  const [activeModels, setActiveModels] = useState<{ publicId: string; displayName: string }[]>([]);
  const [saving, setSaving] = useState(false);

  function applySettings(settings: ChatSettings) {
    setSaved(settings);
    setMaxToolRounds(String(settings.maxToolRounds));
    setToolDebug(Boolean(settings.toolDebug));
    setHomeSuggestionsModel(settings.homeSuggestionsModel ?? "");
  }

  useEffect(() => {
    let active = true;
    fetch("/api/v1/admin/settings", { credentials: "same-origin" })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.data?.settings) throw new Error(json?.error?.message);
        if (!active) return;
        applySettings(json.data.settings);
      })
      .catch((err) => toast(err instanceof Error && err.message ? err.message : t("admin.settings.loadFailed")));
    fetch("/api/v1/admin/model-catalog?status=active", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (active && Array.isArray(json?.data?.models)) setActiveModels(json.data.models);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [t, toast]);

  const modelOptions = useMemo<CustomSelectOption[]>(() => {
    const options: CustomSelectOption[] = [
      { value: AUTO_MODEL, label: t("admin.settings.homeSuggestionsModelAuto") },
      ...activeModels.map((m) => ({ value: m.publicId, label: m.displayName, sublabel: m.publicId })),
    ];
    // Keep a saved model visible even if it is no longer active
    if (homeSuggestionsModel && !activeModels.some((m) => m.publicId === homeSuggestionsModel)) {
      options.push({ value: homeSuggestionsModel, label: homeSuggestionsModel });
    }
    return options;
  }, [activeModels, homeSuggestionsModel, t]);

  const parsedRounds = Number(maxToolRounds);
  const isValid =
    Number.isInteger(parsedRounds) && parsedRounds >= 1 && parsedRounds <= MAX_TOOL_ROUNDS_LIMIT;
  const isDirty =
    saved !== null &&
    (parsedRounds !== saved.maxToolRounds ||
      toolDebug !== saved.toolDebug ||
      homeSuggestionsModel !== (saved.homeSuggestionsModel ?? ""));

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || !isDirty || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/v1/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ maxToolRounds: parsedRounds, toolDebug, homeSuggestionsModel }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.data?.settings) throw new Error(json?.error?.message);
      applySettings(json.data.settings);
      // Re-read /me so the chat's tool debug inspect follows the new setting
      void refreshAccount();
      toast(t("admin.settings.saved"));
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : t("admin.settings.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Page Header */}
      <div>
        <h2 className="text-base font-semibold text-[var(--ink)]">{t("admin.settings.title")}</h2>
        <p className="text-xs text-[var(--muted)]">{t("admin.settings.description")}</p>
      </div>

      {/* 2-Column Responsive Compact Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
        {/* Card 1: Chat Engine Settings */}
        <div className="rounded-[14px] border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-5 flex flex-col justify-between shadow-xs">
          {/* Card Header */}
          <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-[var(--accent)] shrink-0" />
              <h3 className="text-sm font-semibold text-[var(--ink)]">
                {t("admin.settings.title")}
              </h3>
            </div>

            {isDirty ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                Belum Disimpan
              </span>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                Tersinkron
              </span>
            )}
          </div>

          {saved === null ? (
            <div className="flex items-center justify-center py-12 text-xs text-[var(--muted)] gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
              <span>Memuat pengaturan chat...</span>
            </div>
          ) : (
            <form onSubmit={handleSave} className="mt-3.5 space-y-3.5 flex-1 flex flex-col justify-between">
              <div className="space-y-3">
                {/* Row 1: Max Tool Rounds + Tool Debug Switch */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {/* Max Tool Rounds */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-1">
                      <label htmlFor="max-tool-rounds" className="text-xs font-medium text-[var(--muted)] truncate">
                        {t("admin.settings.maxToolRounds")}
                      </label>
                      <Tooltip
                        content={t("admin.settings.maxToolRoundsHint", { max: String(MAX_TOOL_ROUNDS_LIMIT) })}
                        side="top"
                      >
                        <HelpCircle className="w-3.5 h-3.5 text-[var(--muted)] cursor-help shrink-0" />
                      </Tooltip>
                    </div>
                    <input
                      id="max-tool-rounds"
                      type="number"
                      min={1}
                      max={MAX_TOOL_ROUNDS_LIMIT}
                      required
                      value={maxToolRounds}
                      onChange={(e) => setMaxToolRounds(e.target.value)}
                      className="w-full h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] text-xs font-medium outline-none focus:border-[var(--accent)] transition-colors"
                    />
                  </div>

                  {/* Tool Debug Switch */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-1">
                      <label htmlFor="tool-debug" className="text-xs font-medium text-[var(--muted)] truncate">
                        {t("admin.settings.toolDebug")}
                      </label>
                      <Tooltip content={t("admin.settings.toolDebugHint")} side="top">
                        <HelpCircle className="w-3.5 h-3.5 text-[var(--muted)] cursor-help shrink-0" />
                      </Tooltip>
                    </div>
                    <div className="flex items-center justify-between h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
                      <span className="text-xs text-[var(--ink)] font-medium">
                        {toolDebug ? "Aktif (Log DB)" : "Nonaktif"}
                      </span>
                      <button
                        id="tool-debug"
                        type="button"
                        role="switch"
                        aria-checked={toolDebug}
                        onClick={() => setToolDebug((v) => !v)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                          toolDebug ? "bg-[var(--accent)]" : "bg-[var(--border)]"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                            toolDebug ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Row 2: Home Suggestions Model */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1">
                    <label className="text-xs font-medium text-[var(--muted)] truncate">
                      {t("admin.settings.homeSuggestionsModel")}
                    </label>
                    <Tooltip content={t("admin.settings.homeSuggestionsModelHint")} side="top">
                      <HelpCircle className="w-3.5 h-3.5 text-[var(--muted)] cursor-help shrink-0" />
                    </Tooltip>
                  </div>
                  <CustomSelect
                    options={modelOptions}
                    value={homeSuggestionsModel || AUTO_MODEL}
                    onChange={(val) => setHomeSuggestionsModel(val === AUTO_MODEL ? "" : val)}
                    searchable
                    size="sm"
                  />
                </div>
              </div>

              {/* Action Row */}
              <div className="flex items-center justify-between pt-3 border-t border-[var(--border)]">
                <span className="text-[11px] text-[var(--muted)]">
                  {isDirty ? "Ada perubahan belum disimpan" : "Pengaturan tersimpan"}
                </span>
                <Button type="submit" size="sm" disabled={!isValid || !isDirty || saving}>
                  {saving ? t("admin.settings.saving") : t("admin.settings.save")}
                </Button>
              </div>
            </form>
          )}
        </div>

        {/* Card 2: Database Connection Pool Config Card */}
        <DatabasePoolConfigCard />

        {/* Card 3: Network & SSRF Dynamic Rules */}
        <NetworkRulesConfigCard />

        {/* Card 4: Image generation catalog model */}
        <ImageSettingsCard />

        {/* Card 5: Support contact & public legal pages */}
        <LegalSettingsCard />
      </div>
    </div>
  );
}
