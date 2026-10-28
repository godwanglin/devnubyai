"use client";

import React from "react";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { cn } from "@/lib/cn";
import type { Locale } from "@/types";

export function LanguageTab() {
  const { locale, setLocale, t } = useI18n();
  const { toast } = useToast();

  const options: { id: Locale; label: string; desc: string }[] = [
    { id: "id", label: "Bahasa Indonesia", desc: "Terjemahan default aplikasi" },
    { id: "en", label: "English", desc: "English localization" },
  ];

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-[var(--ink)]">
        {t("settings.languageTab")}
      </h2>
      <p className="text-xs text-[var(--muted)]">
        Pilih bahasa antarmuka aplikasi.
      </p>

      <div className="space-y-2 max-w-sm">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => {
              setLocale(opt.id);
              toast(`Bahasa diubah: ${opt.label}`);
            }}
            className={cn(
              "flex items-center justify-between w-full p-3 rounded-[10px] border text-left transition-colors cursor-pointer",
              locale === opt.id
                ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                : "border-[var(--border)] hover:bg-[var(--hover)]"
            )}
          >
            <div>
              <p className="text-sm font-semibold text-[var(--ink)]">{opt.label}</p>
              <p className="text-xs text-[var(--muted)]">{opt.desc}</p>
            </div>
            {locale === opt.id && (
              <span className="text-xs font-bold text-[var(--accent)]">Aktif</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
