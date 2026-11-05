"use client";

import React, { useState } from "react";
import { Monitor, Sun, Moon } from "lucide-react";
import { useTheme } from "@/providers/theme-provider";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { CustomSelect } from "@/components/ui/custom-select";
import { cn } from "@/lib/cn";
import { saveResponseMode, useResponseMode } from "@/hooks/use-chat-prefs";
import { isResponseMode, type ResponseMode } from "@/lib/preferences/response-mode";
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
  const responseMode = useResponseMode();
  const responseModeOptions: { value: ResponseMode; label: string }[] = [
    { value: "verbose", label: t("settings.responseVerbose") },
    { value: "normal", label: t("settings.responseNormal") },
    { value: "silent", label: t("settings.responseSilent") },
  ];

  // Preferences states with localStorage persistence & defaults
  const [uiFont, setUiFont] = useState(() => {
    if (typeof window === "undefined") return "jakarta";
    try {
      return localStorage.getItem("devnuby_pref_ui_font") || "jakarta";
    } catch {
      return "jakarta";
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
      toast(t("settings.themeSystem"));
    } else if (newTheme === "light") {
      toast(t("toast.lightTheme"));
    } else {
      toast(t("toast.darkTheme"));
    }
  };

  const handlePrefChange = (
    key: string,
    val: string,
    dataAttr: string,
    setter: (v: string) => void,
    toastMsg?: string
  ) => {
    setter(val);
    try {
      localStorage.setItem(key, val);
      if (typeof document !== "undefined") {
        document.documentElement.dataset[dataAttr] = val;
      }
      if (toastMsg) toast(toastMsg);
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
      {/* SECTION 1: Tampilan / Appearance */}
      <div>
        <h3 className="text-sm font-semibold text-[var(--ink)] mb-1">
          {t("settings.appearanceTab")}
        </h3>

        {/* 1. Tema / Theme */}
        <div className="py-3 flex items-center justify-between gap-4 border-b border-[var(--border)]/35">
          <span className="text-sm font-medium text-[var(--ink)]">{t("settings.theme")}</span>
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
              title={t("settings.themeSystem")}
              aria-label={t("settings.themeSystem")}
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
              title={t("settings.themeLight")}
              aria-label={t("settings.themeLight")}
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
              title={t("settings.themeDark")}
              aria-label={t("settings.themeDark")}
            >
              <Moon className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 2. Font antarmuka / Interface font */}
        <PreferenceSelectRow
          label={t("settings.uiFont")}
          value={uiFont}
          options={[
            { value: "jakarta", label: "Plus Jakarta Sans" },
            { value: "inter", label: "Inter" },
            { value: "outfit", label: "Outfit" },
            { value: "roboto", label: "Roboto" },
            { value: "system", label: t("settings.fontSystem") },
          ]}
          onChange={(val) =>
            handlePrefChange(
              "devnuby_pref_ui_font",
              val,
              "fontUi",
              setUiFont,
              `${t("settings.uiFont")}: ${val}`
            )
          }
        />

        {/* 3. Font respons / Response font */}
        <PreferenceSelectRow
          label={t("settings.responseFont")}
          value={responseFont}
          options={[
            { value: "match", label: t("settings.fontMatch") },
            { value: "lora", label: "Lora (Serif)" },
            { value: "merriweather", label: "Merriweather (Serif)" },
            { value: "jetbrains", label: "JetBrains Mono" },
            { value: "fira", label: "Fira Code" },
          ]}
          onChange={(val) =>
            handlePrefChange(
              "devnuby_pref_resp_font",
              val,
              "fontResponse",
              setResponseFont,
              `${t("settings.responseFont")}: ${val}`
            )
          }
        />

        {/* 4. Ukuran teks percakapan / Chat text size */}
        <PreferenceSelectRow
          label={t("settings.chatSize")}
          value={chatSize}
          options={[
            { value: "small", label: t("settings.sizeSmall") },
            { value: "medium", label: t("settings.sizeMedium") },
            { value: "large", label: t("settings.sizeLarge") },
          ]}
          onChange={(val) =>
            handlePrefChange(
              "devnuby_pref_chat_size",
              val,
              "chatSize",
              setChatSize,
              `${t("settings.chatSize")}: ${val}`
            )
          }
        />

        {/* 5. Lebar transkrip / Transcript width */}
        <PreferenceSelectRow
          label={t("settings.transcriptWidth")}
          value={transcriptWidth}
          options={[
            { value: "narrow", label: t("settings.widthNarrow") },
            { value: "standard", label: t("settings.widthStandard") },
            { value: "full", label: t("settings.widthFull") },
          ]}
          onChange={(val) =>
            handlePrefChange(
              "devnuby_pref_transcript_width",
              val,
              "transcriptWidth",
              setTranscriptWidth,
              `${t("settings.transcriptWidth")}: ${val}`
            )
          }
        />

        {/* 6. Gerakan / Motion */}
        <PreferenceSelectRow
          label={t("settings.motion")}
          value={motion}
          options={[
            { value: "system", label: t("settings.motionSystem") },
            { value: "reduce", label: t("settings.motionReduce") },
            { value: "enable", label: t("settings.motionEnable") },
          ]}
          onChange={(val) =>
            handlePrefChange(
              "devnuby_pref_motion",
              val,
              "motion",
              setMotion,
              `${t("settings.motion")}: ${val}`
            )
          }
        />

        {/* 7. Tampilan respons / Response display (verbose, normal, silent) */}
        <PreferenceSelectRow
          label={t("settings.responseMode")}
          value={responseMode}
          options={responseModeOptions}
          onChange={(val) => {
            if (!isResponseMode(val) || val === responseMode) return;
            const option = responseModeOptions.find((o) => o.value === val);
            void saveResponseMode(val).then((ok) =>
              toast(ok ? `${t("settings.responseMode")}: ${option?.label ?? val}` : t("toast.actionFailed"))
            );
          }}
        />
      </div>

      {/* SECTION 2: Suara / Voice */}
      <div className="mt-8">
        <h3 className="text-sm font-semibold text-[var(--ink)] mb-1">
          {t("settings.voiceSection")}
        </h3>

        {/* 1. Bahasa / Language */}
        <PreferenceSelectRow
          label={t("settings.language")}
          value={locale}
          options={[
            { value: "id", label: "Indonesia" },
            { value: "en", label: "English" },
          ]}
          onChange={handleLocaleChange}
        />

        {/* 2. Gaya / Style */}
        <PreferenceSelectRow
          label={t("settings.voiceStyle")}
          value={voiceStyle}
          options={[
            { value: "select", label: t("settings.styleSelect") },
            { value: "natural", label: t("settings.styleNatural") },
            { value: "formal", label: t("settings.styleFormal") },
            { value: "casual", label: t("settings.styleCasual") },
          ]}
          onChange={(val) =>
            handlePrefChange("devnuby_pref_voice_style", val, "voiceStyle", setVoiceStyle)
          }
        />

        {/* 3. Kecepatan / Speed */}
        <PreferenceSelectRow
          label={t("settings.voiceSpeed")}
          value={voiceSpeed}
          options={[
            { value: "slow", label: t("settings.speedSlow") },
            { value: "normal", label: t("settings.speedNormal") },
            { value: "fast", label: t("settings.speedFast") },
          ]}
          onChange={(val) =>
            handlePrefChange("devnuby_pref_voice_speed", val, "voiceSpeed", setVoiceSpeed)
          }
        />
      </div>
    </div>
  );
}
