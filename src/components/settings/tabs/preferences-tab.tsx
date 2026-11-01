"use client";

import React from "react";
import { Sun, Moon, Globe, Check } from "lucide-react";
import { useTheme } from "@/providers/theme-provider";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { cn } from "@/lib/cn";
import type { Locale } from "@/types";

export function PreferencesTab() {
  const { theme, setTheme } = useTheme();
  const { locale, setLocale, t } = useI18n();
  const { toast } = useToast();

  const languageOptions: { id: Locale; label: string; desc: string; badge: string }[] = [
    {
      id: "id",
      label: "Bahasa Indonesia",
      desc: "Bahasa antarmuka utama Devnuby",
      badge: "ID",
    },
    {
      id: "en",
      label: "English",
      desc: "English interface localization",
      badge: "EN",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--ink)]">
          {t("settings.preferencesTab")}
        </h2>
        <p className="text-xs text-[var(--muted)] mt-0.5">
          Atur tampilan visual dan bahasa antarmuka aplikasi sesuai kenyamananmu.
        </p>
      </div>

      {/* Tema Tampilan */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--ink)] flex items-center gap-2">
            <span>{t("settings.appearanceTab")}</span>
          </h3>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Pilih mode tema tampilan terang atau gelap murni (Pure Dark).
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
          <button
            type="button"
            onClick={() => {
              setTheme("light");
              toast(t("toast.lightTheme"));
            }}
            className={cn(
              "flex items-center gap-3.5 p-3.5 rounded-[12px] border text-left transition-all cursor-pointer relative",
              theme === "light"
                ? "border-[var(--accent)] bg-[var(--accent-soft)]/20 shadow-sm ring-1 ring-[var(--accent)]"
                : "border-[var(--border)] hover:bg-[var(--hover)] bg-[var(--panel-elevated)]"
            )}
          >
            <div
              className={cn(
                "w-10 h-10 rounded-[10px] grid place-items-center shrink-0 transition-colors",
                theme === "light"
                  ? "bg-[var(--accent)] text-[var(--accent-text)]"
                  : "bg-[var(--hover)] text-[var(--muted)]"
              )}
            >
              <Sun className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--ink)]">Mode Terang</p>
              <p className="text-xs text-[var(--muted)]">Tampilan bersih dengan kontras lembut</p>
            </div>
            {theme === "light" && (
              <span className="w-5 h-5 rounded-full bg-[var(--accent)] text-[var(--accent-text)] grid place-items-center shrink-0">
                <Check className="w-3.5 h-3.5" />
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setTheme("dark");
              toast(t("toast.darkTheme"));
            }}
            className={cn(
              "flex items-center gap-3.5 p-3.5 rounded-[12px] border text-left transition-all cursor-pointer relative",
              theme === "dark"
                ? "border-[var(--accent)] bg-[var(--accent-soft)]/20 shadow-sm ring-1 ring-[var(--accent)]"
                : "border-[var(--border)] hover:bg-[var(--hover)] bg-[var(--panel-elevated)]"
            )}
          >
            <div
              className={cn(
                "w-10 h-10 rounded-[10px] grid place-items-center shrink-0 transition-colors",
                theme === "dark"
                  ? "bg-[var(--accent)] text-[var(--accent-text)]"
                  : "bg-[var(--hover)] text-[var(--muted)]"
              )}
            >
              <Moon className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--ink)]">Pure Dark</p>
              <p className="text-xs text-[var(--muted)]">Mode gelap OLED hemat daya</p>
            </div>
            {theme === "dark" && (
              <span className="w-5 h-5 rounded-full bg-[var(--accent)] text-[var(--accent-text)] grid place-items-center shrink-0">
                <Check className="w-3.5 h-3.5" />
              </span>
            )}
          </button>
        </div>
      </section>

      {/* Bahasa Antarmuka */}
      <section className="space-y-3 pt-4 border-t border-[var(--border)]">
        <div>
          <h3 className="text-sm font-semibold text-[var(--ink)] flex items-center gap-2">
            <Globe className="w-4 h-4 text-[var(--muted)]" />
            <span>{t("settings.languageTab")}</span>
          </h3>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Pilih bahasa untuk semua menu dan teks antarmuka Devnuby.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
          {languageOptions.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                setLocale(opt.id);
                toast(opt.id === "id" ? "Bahasa diubah: Bahasa Indonesia" : "Language switched to English");
              }}
              className={cn(
                "flex items-center justify-between p-3.5 rounded-[12px] border text-left transition-all cursor-pointer",
                locale === opt.id
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]/20 shadow-sm ring-1 ring-[var(--accent)]"
                  : "border-[var(--border)] hover:bg-[var(--hover)] bg-[var(--panel-elevated)]"
              )}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className={cn(
                    "w-8 h-8 rounded-[8px] grid place-items-center font-bold text-xs shrink-0",
                    locale === opt.id
                      ? "bg-[var(--accent)] text-[var(--accent-text)]"
                      : "bg-[var(--hover)] text-[var(--muted)]"
                  )}
                >
                  {opt.badge}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--ink)] truncate">{opt.label}</p>
                  <p className="text-xs text-[var(--muted)] truncate">{opt.desc}</p>
                </div>
              </div>
              {locale === opt.id && (
                <span className="w-5 h-5 rounded-full bg-[var(--accent)] text-[var(--accent-text)] grid place-items-center shrink-0 ml-2">
                  <Check className="w-3.5 h-3.5" />
                </span>
              )}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
