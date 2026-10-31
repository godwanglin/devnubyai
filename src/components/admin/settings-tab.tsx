"use client";

import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { MAX_TOOL_ROUNDS_LIMIT, type ChatSettings } from "@/lib/chat/settings-shared";

export function SettingsTab() {
  const { t } = useI18n();
  const { toast } = useToast();

  const [saved, setSaved] = useState<ChatSettings | null>(null);
  const [maxToolRounds, setMaxToolRounds] = useState("");
  const [toolDebug, setToolDebug] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/admin/settings", { credentials: "same-origin" })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.data?.settings) throw new Error(json?.error?.message);
        if (!active) return;
        setSaved(json.data.settings);
        setMaxToolRounds(String(json.data.settings.maxToolRounds));
        setToolDebug(Boolean(json.data.settings.toolDebug));
      })
      .catch((err) => toast(err instanceof Error && err.message ? err.message : t("admin.settings.loadFailed")));
    return () => {
      active = false;
    };
  }, [t, toast]);

  const parsedRounds = Number(maxToolRounds);
  const isValid =
    Number.isInteger(parsedRounds) && parsedRounds >= 1 && parsedRounds <= MAX_TOOL_ROUNDS_LIMIT;
  const isDirty =
    saved !== null && (parsedRounds !== saved.maxToolRounds || toolDebug !== saved.toolDebug);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || !isDirty || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/v1/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ maxToolRounds: parsedRounds, toolDebug }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.data?.settings) throw new Error(json?.error?.message);
      setSaved(json.data.settings);
      setMaxToolRounds(String(json.data.settings.maxToolRounds));
      setToolDebug(Boolean(json.data.settings.toolDebug));
      toast(t("admin.settings.saved"));
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : t("admin.settings.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-[var(--ink)]">{t("admin.settings.title")}</h2>
        <p className="text-xs text-[var(--muted)]">{t("admin.settings.description")}</p>
      </div>

      {saved === null ? (
        <div className="flex items-center gap-2 text-xs text-[var(--muted)] py-6">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      ) : (
        <form
          onSubmit={handleSave}
          className="max-w-[560px] rounded-[12px] border border-[var(--border)] bg-[var(--panel)] p-4 space-y-4"
        >
          <div>
            <label
              htmlFor="max-tool-rounds"
              className="block text-xs font-medium text-[var(--muted)] mb-1"
            >
              {t("admin.settings.maxToolRounds")}
            </label>
            <input
              id="max-tool-rounds"
              type="number"
              min={1}
              max={MAX_TOOL_ROUNDS_LIMIT}
              required
              value={maxToolRounds}
              onChange={(e) => setMaxToolRounds(e.target.value)}
              className="w-32 px-3 py-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] text-sm outline-none focus:border-[var(--accent)]"
            />
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--muted)]">
              {t("admin.settings.maxToolRoundsHint", { max: String(MAX_TOOL_ROUNDS_LIMIT) })}
            </p>
          </div>

          <div className="flex items-start justify-between gap-4 pt-4 border-t border-[var(--border)]">
            <div>
              <label
                htmlFor="tool-debug"
                className="block text-xs font-medium text-[var(--ink)] mb-0.5"
              >
                {t("admin.settings.toolDebug")}
              </label>
              <p className="text-[11.5px] leading-relaxed text-[var(--muted)]">
                {t("admin.settings.toolDebugHint")}
              </p>
            </div>
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

          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!isValid || !isDirty || saving}>
              {saving ? t("admin.settings.saving") : t("admin.settings.save")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
