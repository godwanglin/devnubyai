"use client";

import React, { useState } from "react";
import { Monitor, Sun, Moon } from "lucide-react";
import { useTheme } from "@/providers/theme-provider";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { CustomSelect } from "@/components/ui/custom-select";
import { cn } from "@/lib/cn";
import type { Locale, Theme } from "@/types";

interface PreferenceRowProps {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (val: string) => void;
}

function PreferenceSelectRow({ label, value, options, onChange }: PreferenceRowProps) {
  return (
    <div className="py-3 flex items-center justify-between gap-4 border-b border-[var(--border)]/35">
      <span className="text-sm font-medium text-[var(--ink)]">{label}</span>
      <CustomSelect
        variant="inline"
        value={value}
        options={options}
        onChange={onChange}
      />
    </div>
  );
}

export function PreferencesTab() {
  const { theme, setTheme } = useTheme();
  const { locale, setLocale, t } = useI18n();
  const { toast } = useToast();

  // Preferences states with localStorage persistence
  const [uiFont, setUiFont] = useState(() => {
    if (typeof window === "undefined") return "anthropic";
    try {
      return localStorage.getItem("devnuby_pref_ui_font") || "anthropic";
    } catch {
      return "anthropic";
    }
  });
  const [responseFont, setResponseFont] = useState(() => {
    if (typeof window === "undefined") return "match";
    try {
      return localStorage.getItem("devnuby_pref_resp_font") || "match";
    } catch {
      return "match";
    }
  });
  const [chatSize, setChatSize] = useState(() => {
    if (typeof window === "undefined") return "medium";
    try {
      return localStorage.getItem("devnuby_pref_chat_size") || "medium";
    } catch {
      return "medium";
    }
  });
  const [transcriptWidth, setTranscriptWidth] = useState(() => {
    if (typeof window === "undefined") return "narrow";
    try {
      return localStorage.getItem("devnuby_pref_transcript_width") || "narrow";
    } catch {
      return "narrow";
    }
  });
  const [motion, setMotion] = useState(() => {
    if (typeof window === "undefined") return "system";
    try {
      return localStorage.getItem("devnuby_pref_motion") || "system";
    } catch {
      return "system";
    }
  });
  const [voiceStyle, setVoiceStyle] = useState(() => {
    if (typeof window === "undefined") return "select";
    try {
      return localStorage.getItem("devnuby_pref_voice_style") || "select";
    } catch {
      return "select";
    }
  });
  const [voiceSpeed, setVoiceSpeed] = useState(() => {
    if (typeof window === "undefined") return "normal";
    try {
      return localStorage.getItem("devnuby_pref_voice_speed") || "normal";
    } catch {
      return "normal";
    }
  });

  const handleThemeChange = (newTheme: Theme) => {
    setTheme(newTheme);
    if (newTheme === "system") {
      toast("Tema diatur ke Sistem");
    } else if (newTheme === "light") {
      toast(t("toast.lightTheme"));
    } else {
      toast(t("toast.darkTheme"));
    }
  };

  const handlePrefChange = (key: string, val: string, setter: (v: string) => void) => {
    setter(val);
    try {
      localStorage.setItem(key, val);
    } catch {
      // ignore
    }
  };

  const handleLocaleChange = (newLocale: string) => {
    const loc = newLocale as Locale;
    setLocale(loc);
    toast(loc === "id" ? "Bahasa diubah: Bahasa Indonesia" : "Language switched to English");
  };

  return (
    <div className="w-full">
      {/* SECTION 1: Tampilan */}
      <div>
        <h3 className="text-sm font-semibold text-[var(--ink)] mb-1">
          {t("settings.appearanceTab")}
        </h3>

        {/* 1. Tema */}
        <div className="py-3 flex items-center justify-between gap-4 border-b border-[var(--border)]/35">
          <span className="text-sm font-medium text-[var(--ink)]">Tema</span>
          <div className="inline-flex items-center p-0.5 rounded-lg bg-[var(--hover)] border border-[var(--border)]/40">
            <button
              type="button"
              onClick={() => handleThemeChange("system")}
              className={cn(
                "w-7 h-7 rounded-md grid place-items-center transition-colors cursor-pointer",
                theme === "system"
                  ? "bg-[var(--surface-active)] text-[var(--ink)] shadow-xs"
                  : "text-[var(--muted)] hover:text-[var(--ink)]"
              )}
              title="Sistem"
              aria-label="Sistem"
            >
              <Monitor className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => handleThemeChange("light")}
              className={cn(
                "w-7 h-7 rounded-md grid place-items-center transition-colors cursor-pointer",
                theme === "light"
                  ? "bg-[var(--surface-active)] text-[var(--ink)] shadow-xs"
                  : "text-[var(--muted)] hover:text-[var(--ink)]"
              )}
              title="Terang"
              aria-label="Terang"
            >
              <Sun className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => handleThemeChange("dark")}
              className={cn(
                "w-7 h-7 rounded-md grid place-items-center transition-colors cursor-pointer",
                theme === "dark"
                  ? "bg-[var(--surface-active)] text-[var(--ink)] shadow-xs"
                  : "text-[var(--muted)] hover:text-[var(--ink)]"
              )}
              title="Gelap"
              aria-label="Gelap"
            >
              <Moon className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 2. Font antarmuka */}
        <PreferenceSelectRow
          label="Font antarmuka"
          value={uiFont}
          options={[
            { value: "anthropic", label: "Anthropic Sans" },
            { value: "inter", label: "Inter" },
            { value: "geist", label: "Geist" },
            { value: "system", label: "Sistem (Default)" },
          ]}
          onChange={(val) => handlePrefChange("devnuby_pref_ui_font", val, setUiFont)}
        />

        {/* 3. Font respons */}
        <PreferenceSelectRow
          label="Font respons"
          value={responseFont}
          options={[
            { value: "match", label: "Samakan dengan antarmuka" },
            { value: "serif", label: "Serif" },
            { value: "mono", label: "Monospace" },
          ]}
          onChange={(val) => handlePrefChange("devnuby_pref_resp_font", val, setResponseFont)}
        />

        {/* 4. Ukuran teks percakapan */}
        <PreferenceSelectRow
          label="Ukuran teks percakapan"
          value={chatSize}
          options={[
            { value: "small", label: "Kecil" },
            { value: "medium", label: "Sedang" },
            { value: "large", label: "Besar" },
          ]}
          onChange={(val) => handlePrefChange("devnuby_pref_chat_size", val, setChatSize)}
        />

        {/* 5. Lebar transkrip */}
        <PreferenceSelectRow
          label="Lebar transkrip"
          value={transcriptWidth}
          options={[
            { value: "narrow", label: "Sempit" },
            { value: "standard", label: "Standar" },
            { value: "full", label: "Penuh" },
          ]}
          onChange={(val) => handlePrefChange("devnuby_pref_transcript_width", val, setTranscriptWidth)}
        />

        {/* 6. Gerakan */}
        <PreferenceSelectRow
          label="Gerakan"
          value={motion}
          options={[
            { value: "system", label: "Sistem" },
            { value: "reduce", label: "Kurangi gerakan" },
            { value: "enable", label: "Aktif" },
          ]}
          onChange={(val) => handlePrefChange("devnuby_pref_motion", val, setMotion)}
        />
      </div>

      {/* SECTION 2: Suara */}
      <div className="mt-8">
        <h3 className="text-sm font-semibold text-[var(--ink)] mb-1">
          Suara
        </h3>

        {/* 1. Bahasa */}
        <PreferenceSelectRow
          label="Bahasa"
          value={locale}
          options={[
            { value: "id", label: "Indonesia" },
            { value: "en", label: "English" },
          ]}
          onChange={handleLocaleChange}
        />

        {/* 2. Gaya */}
        <PreferenceSelectRow
          label="Gaya"
          value={voiceStyle}
          options={[
            { value: "select", label: "Pilih" },
            { value: "natural", label: "Alami" },
            { value: "formal", label: "Formal" },
            { value: "casual", label: "Santai" },
          ]}
          onChange={(val) => handlePrefChange("devnuby_pref_voice_style", val, setVoiceStyle)}
        />

        {/* 3. Kecepatan */}
        <PreferenceSelectRow
          label="Kecepatan"
          value={voiceSpeed}
          options={[
            { value: "slow", label: "Lambat (0.8x)" },
            { value: "normal", label: "Normal" },
            { value: "fast", label: "Cepat (1.2x)" },
          ]}
          onChange={(val) => handlePrefChange("devnuby_pref_voice_speed", val, setVoiceSpeed)}
        />
      </div>
    </div>
  );
}
