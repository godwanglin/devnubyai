"use client";

import React, { useEffect, useMemo, useState } from "react";
import { HelpCircle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";

interface RetrySettings {
  requestRetryAttempts: number;
  fallbackModelPattern: string;
}

interface CatalogModelOption {
  publicId: string;
  displayName: string;
}

/** Same matching as the server: case-insensitive regex, literal text when the regex is invalid. */
function matchesPattern(pattern: string, publicId: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  try {
    return new RegExp(trimmed, "i").test(publicId);
  } catch {
    return publicId.toLowerCase().includes(trimmed.toLowerCase());
  }
}

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern.trim(), "i");
    return true;
  } catch {
    return false;
  }
}

/** Admin policy for retrying a failed chat request and the models it falls back to. */
export function RequestRetrySettingsCard() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<RetrySettings | null>(null);
  const [attempts, setAttempts] = useState("");
  const [pattern, setPattern] = useState("");
  const [models, setModels] = useState<CatalogModelOption[]>([]);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/admin/settings/request-retry", { credentials: "same-origin" })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error?.message);
        if (!active) return;
        const settings: RetrySettings = json.data.settings;
        setSaved(settings);
        setAttempts(String(settings.requestRetryAttempts));
        setPattern(settings.fallbackModelPattern);
        setModels(json.data.models ?? []);
      })
      .catch((err) => {
        if (active) toast(err instanceof Error && err.message ? err.message : t("admin.requestRetry.loadFailed"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [toast, t]);

  const attemptsNumber = Number(attempts);
  const attemptsValid = Number.isInteger(attemptsNumber) && attemptsNumber >= 1 && attemptsNumber <= 10;
  const patternValid = isValidRegex(pattern);

  // Order the request falls back in: pattern matches first, then the catalog order
  const fallbackOrder = useMemo(() => {
    const matched = models.filter((m) => matchesPattern(pattern, m.publicId));
    const rest = models.filter((m) => !matchesPattern(pattern, m.publicId));
    return { matched, rest };
  }, [models, pattern]);

  const isDirty =
    saved !== null &&
    (String(saved.requestRetryAttempts) !== attempts.trim() || saved.fallbackModelPattern !== pattern.trim());

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!attemptsValid || !patternValid) return;
    setSaving(true);
    try {
      const res = await fetch("/api/v1/admin/settings/request-retry", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestRetryAttempts: attemptsNumber, fallbackModelPattern: pattern.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message);
      const updated: RetrySettings = json.data.settings;
      setSaved(updated);
      setAttempts(String(updated.requestRetryAttempts));
      setPattern(updated.fallbackModelPattern);
      toast(t("admin.requestRetry.saved"));
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : t("admin.requestRetry.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-[14px] border border-[var(--border)] bg-[var(--panel)] p-5 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-amber-500/10 text-amber-400">
            <RefreshCw className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink)]">{t("admin.requestRetry.title")}</h3>
            <p className="text-xs text-[var(--muted)]">{t("admin.requestRetry.description")}</p>
          </div>
        </div>
        {isDirty ? (
          <span className="inline-flex shrink-0 items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            {t("admin.requestRetry.unsaved")}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-[var(--muted)] gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
          <span>{t("admin.requestRetry.loading")}</span>
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <label htmlFor="request-retry-attempts" className="text-xs font-medium text-[var(--ink)]">
                  {t("admin.requestRetry.attemptsLabel")}
                </label>
                <Tooltip content={t("admin.requestRetry.attemptsHint")}>
                  <HelpCircle className="w-3.5 h-3.5 text-[var(--muted)] cursor-help shrink-0" />
                </Tooltip>
              </div>
              <Input
                id="request-retry-attempts"
                type="number"
                min={1}
                max={10}
                value={attempts}
                onChange={(e) => setAttempts(e.target.value)}
                className="h-9 text-xs"
              />
              {!attemptsValid ? (
                <p className="text-[11px] text-red-400">{t("admin.requestRetry.attemptsInvalid")}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <label htmlFor="request-retry-pattern" className="text-xs font-medium text-[var(--ink)]">
                  {t("admin.requestRetry.patternLabel")}
                </label>
                <Tooltip content={t("admin.requestRetry.patternHint")}>
                  <HelpCircle className="w-3.5 h-3.5 text-[var(--muted)] cursor-help shrink-0" />
                </Tooltip>
              </div>
              <Input
                id="request-retry-pattern"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="auto"
                className="h-9 font-mono text-xs"
              />
              {!patternValid ? (
                <p className="text-[11px] text-red-400">{t("admin.requestRetry.patternInvalid")}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-[var(--ink)]">{t("admin.requestRetry.orderLabel")}</p>
            <div className="flex flex-wrap gap-1.5">
              {fallbackOrder.matched.map((m) => (
                <span
                  key={m.publicId}
                  title={m.displayName}
                  className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] text-amber-400"
                >
                  {m.publicId}
                </span>
              ))}
              {fallbackOrder.rest.map((m) => (
                <span
                  key={m.publicId}
                  title={m.displayName}
                  className="rounded-full border border-[var(--border)] px-2 py-0.5 font-mono text-[11px] text-[var(--muted)]"
                >
                  {m.publicId}
                </span>
              ))}
            </div>
            <p className="text-[11px] text-[var(--placeholder)]">{t("admin.requestRetry.orderHint")}</p>
          </div>

          <div className="flex justify-end pt-1">
            <Button type="submit" size="sm" disabled={!isDirty || saving || !attemptsValid || !patternValid}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              {t("admin.requestRetry.save")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
