"use client";

import React from "react";
import { Sparkles } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import modelsData from "@/data/models.json";
import type { ModelOption } from "@/types";

export function ModelsTab() {
  const { t } = useI18n();
  const models = modelsData as ModelOption[];

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-[var(--ink)]">
        {t("settings.modelsTab")}
      </h2>
      <p className="text-xs text-[var(--muted)]">
        Daftar model AI yang tersedia dalam workspace Devnuby.
      </p>

      <div className="space-y-2">
        {models.map((m) => (
          <div
            key={m.id}
            className="flex items-center justify-between p-3.5 rounded-[10px] border border-[var(--border)] bg-[var(--panel-elevated)]"
          >
            <div className="flex items-center gap-3">
              <span className="grid place-items-center w-8 h-8 rounded-full bg-[var(--accent)] text-[var(--accent-text)]">
                <Sparkles className="w-4 h-4" />
              </span>
              <div>
                <p className="text-sm font-semibold text-[var(--ink)]">{m.fullName}</p>
                <p className="text-xs text-[var(--muted)]">{m.description}</p>
              </div>
            </div>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-[4px] bg-[var(--hover)] text-[var(--placeholder)]">
              {m.category}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
