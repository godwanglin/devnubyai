"use client";

import React, { useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, Languages, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { IconPicker } from "@/components/ui/icon-picker";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { LOCALES, type Locale } from "@/lib/i18n/locales";
import {
  AUTO_FEATURE_KEYS,
  DEFAULT_FEATURE_ICON,
  MAX_FEATURE_TEXT,
  MAX_PLAN_FEATURES,
  defaultAutoFeature,
  hasAnyText,
  newCustomFeatureId,
  type AutoFeatureKey,
  type LocalizedText,
  type PlanFeature,
} from "@/lib/plans/features";
import { cn } from "@/lib/cn";

interface PlanFeaturesEditorProps {
  features: PlanFeature[];
  onChange: (features: PlanFeature[]) => void;
}

const AUTO_LABEL_KEYS: Record<AutoFeatureKey, string> = {
  usage: "admin.plans.featureAutoUsage",
  dailyRequests: "admin.plans.featureAutoDaily",
  requestsPerMinute: "admin.plans.featureAutoRpm",
};

const AUTO_HINT_KEYS: Record<AutoFeatureKey, string> = {
  usage: "admin.plans.featureAutoUsageHint",
  dailyRequests: "admin.plans.featureAutoCountHint",
  requestsPerMinute: "admin.plans.featureAutoCountHint",
};

const iconButton =
  "grid h-7 w-7 place-items-center rounded-[6px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer";

/**
 * Editor for the "Capacity & Quotas" rows of a plan card: reorder, pick icons,
 * edit or remove any row, hide auto rows, and write text per language (with AI
 * translation the admin can still edit before saving).
 */
export function PlanFeaturesEditor({ features, onChange }: PlanFeaturesEditorProps) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const [translatingId, setTranslatingId] = useState<string | null>(null);

  const missingAutoKeys = AUTO_FEATURE_KEYS.filter(
    (key) => !features.some((f) => f.type === "auto" && f.key === key)
  );
  const isFull = features.length >= MAX_PLAN_FEATURES;

  function update(id: string, patch: (f: PlanFeature) => PlanFeature) {
    onChange(features.map((f) => (f.id === id ? patch(f) : f)));
  }

  function setText(id: string, code: Locale, value: string) {
    update(id, (f) => ({ ...f, text: { ...(f.text ?? {}), [code]: value } }));
  }

  function move(index: number, step: -1 | 1) {
    const target = index + step;
    if (target < 0 || target >= features.length) return;
    const next = [...features];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function add(feature: PlanFeature) {
    if (isFull) return;
    onChange([...features, feature]);
  }

  /** Default (i18n) wording of an auto row, with the placeholders the admin can use. */
  function autoDefaultText(key: AutoFeatureKey): string {
    if (key === "usage") return t("plans.relativeUsage", { multiplier: "{value}", base: "{base}" });
    if (key === "dailyRequests") return t("plans.dailyRequests", { count: "{value}" });
    return t("plans.rateLimit", { count: "{value}" });
  }

  async function translate(feature: PlanFeature) {
    const text: LocalizedText = feature.text ?? {};
    // Translate from the language being typed: the UI language if filled, else the first filled one
    const filled = LOCALES.map((l) => l.code).filter((code) => text[code]?.trim());
    const source: Locale | undefined = filled.includes(locale) ? locale : filled[0];
    if (!source) {
      toast(t("admin.plans.featureTranslateEmpty"));
      return;
    }
    const targets = LOCALES.map((l) => l.code).filter((code) => code !== source);

    setTranslatingId(feature.id);
    try {
      const res = await fetch("/api/v1/admin/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ text: text[source], source, targets }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message || t("admin.plans.featureTranslateFailed"));
      const translations = (json?.data?.translations ?? {}) as LocalizedText;
      update(feature.id, (f) => ({ ...f, text: { ...(f.text ?? {}), ...translations } }));
      toast(t("admin.plans.featureTranslated"));
    } catch (err) {
      toast(err instanceof Error ? err.message : t("admin.plans.featureTranslateFailed"));
    } finally {
      setTranslatingId(null);
    }
  }

  return (
    <div className="space-y-2">
      {features.map((feature, index) => {
        const text = feature.text ?? {};
        return (
          <div
            key={feature.id}
            className={cn(
              "rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-2.5",
              feature.type === "auto" && !feature.visible && "opacity-60"
            )}
          >
            <div className="flex items-center gap-2">
              <IconPicker
                value={feature.icon}
                onChange={(icon) => update(feature.id, (f) => ({ ...f, icon }))}
              />

              <div className="min-w-0 flex-1">
                {feature.type === "auto" ? (
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="h-3 w-3 shrink-0 text-[var(--accent)]" />
                    <span className="truncate text-xs font-medium text-[var(--ink)]">
                      {t(AUTO_LABEL_KEYS[feature.key])}
                    </span>
                    <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase text-[var(--muted)] bg-[var(--hover)]">
                      {t("admin.plans.featureAutoBadge")}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs font-medium text-[var(--ink)]">{t("admin.plans.featureCustom")}</span>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => void translate(feature)}
                  disabled={translatingId !== null || !hasAnyText(text)}
                  className="inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-[11px] font-medium text-[var(--primary)] hover:bg-[var(--hover)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  title={t("admin.plans.featureTranslate")}
                >
                  {translatingId === feature.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Languages className="h-3.5 w-3.5" />
                  )}
                  {t("admin.plans.featureTranslate")}
                </button>
                {feature.type === "auto" ? (
                  <button
                    type="button"
                    onClick={() => update(feature.id, (f) => (f.type === "auto" ? { ...f, visible: !f.visible } : f))}
                    className={iconButton}
                    title={feature.visible ? t("admin.plans.featureHide") : t("admin.plans.featureShow")}
                    aria-label={feature.visible ? t("admin.plans.featureHide") : t("admin.plans.featureShow")}
                  >
                    {feature.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  className={iconButton}
                  aria-label={t("admin.catalog.moveUp")}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === features.length - 1}
                  className={iconButton}
                  aria-label={t("admin.catalog.moveDown")}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onChange(features.filter((f) => f.id !== feature.id))}
                  className="grid h-7 w-7 place-items-center rounded-[6px] text-red-400 hover:bg-red-500/10 hover:text-red-500 cursor-pointer"
                  title={t("admin.plans.featureRemove")}
                  aria-label={t("admin.plans.featureRemove")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* One input per UI language; on auto rows an empty input keeps the default wording */}
            <div className="mt-2 space-y-1.5">
              {LOCALES.map((l) => (
                <label key={l.code} className="flex items-center gap-2">
                  <span className="w-7 shrink-0 text-[10px] font-bold uppercase text-[var(--muted)]">{l.code}</span>
                  <input
                    value={text[l.code] ?? ""}
                    maxLength={MAX_FEATURE_TEXT}
                    onChange={(e) => setText(feature.id, l.code, e.target.value)}
                    placeholder={
                      feature.type === "auto"
                        ? l.code === locale
                          ? autoDefaultText(feature.key)
                          : t("admin.plans.featureAutoPlaceholder")
                        : t("admin.plans.featureTextPlaceholder", { language: l.nativeName })
                    }
                    className="h-8 w-full rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-2.5 text-xs text-[var(--ink)] placeholder:text-[var(--placeholder)] outline-none focus:border-[var(--primary)]"
                  />
                </label>
              ))}
              {feature.type === "auto" ? (
                <p className="pl-9 text-[10px] text-[var(--placeholder)]">{t(AUTO_HINT_KEYS[feature.key])}</p>
              ) : null}
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => add({ id: newCustomFeatureId(), type: "custom", icon: DEFAULT_FEATURE_ICON, text: {} })}
          disabled={isFull}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--muted)] hover:border-[var(--primary)] hover:text-[var(--ink)] disabled:opacity-40 cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("admin.plans.featureAdd")}
        </button>
        {/* Auto rows the admin removed can be put back */}
        {missingAutoKeys.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => add(defaultAutoFeature(key))}
            disabled={isFull}
            className="flex items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--muted)] hover:border-[var(--primary)] hover:text-[var(--ink)] disabled:opacity-40 cursor-pointer"
          >
            <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
            {t(AUTO_LABEL_KEYS[key])}
          </button>
        ))}
      </div>
    </div>
  );
}
