"use client";

import React from "react";
import { useI18n } from "@/providers/i18n-provider";
import quickPrompts from "@/data/quick-prompts.json";
import type { QuickPrompt } from "@/types";

interface WelcomeProps {
  onSelectPrompt: (prompt: string) => void;
}

export function Welcome({ onSelectPrompt }: WelcomeProps) {
  const { t } = useI18n();
  const prompts = quickPrompts as QuickPrompt[];

  return (
    <div className="max-w-[768px] mx-auto px-4 sm:px-5 pt-6 sm:pt-10 pb-8">
      <p className="text-[13px] font-medium text-[var(--muted)] mb-2.5">
        {t("welcome.kicker")}
      </p>

      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[var(--ink)] leading-tight">
        <span className="text-[var(--accent)] mr-2 select-none">&gt;</span>
        <span>{t("welcome.title")}</span>
        <span className="inline-block w-1 h-7 ml-1.5 bg-[var(--accent)] align-middle animate-pulse" />
      </h1>

      <p className="text-sm text-[var(--muted)] mt-4 max-w-[55ch]">
        {t("welcome.hint")}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-5">
        {prompts.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectPrompt(item.prompt)}
            className="p-3.5 rounded-[10px] border border-[var(--border)] bg-[var(--panel)] text-left text-sm text-[var(--ink)] leading-relaxed hover:border-[var(--accent)] hover:-translate-y-0.5 transition-all cursor-pointer"
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
