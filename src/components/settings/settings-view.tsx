"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowLeft, User, Palette, Globe, Cpu, Archive, Gauge } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/providers/i18n-provider";
import { cn } from "@/lib/cn";
import { ProfileTab } from "./tabs/profile-tab";
import { AppearanceTab } from "./tabs/appearance-tab";
import { LanguageTab } from "./tabs/language-tab";
import { ModelsTab } from "./tabs/models-tab";
import { UsageTab } from "./tabs/usage-tab";
import { ArchivedChatsTab } from "./tabs/archived-chats-tab";

type TabId = "profile" | "usage" | "appearance" | "language" | "models" | "archived";
const TAB_IDS: TabId[] = ["profile", "usage", "appearance", "language", "models", "archived"];

export function SettingsView() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab") as TabId | null;
  const [tab, setTab] = useState<TabId>(
    requestedTab && TAB_IDS.includes(requestedTab) ? requestedTab : "profile"
  );

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "profile", label: t("settings.profileTab"), icon: <User className="w-4 h-4" /> },
    { id: "usage", label: t("settings.usageTab"), icon: <Gauge className="w-4 h-4" /> },
    { id: "appearance", label: t("settings.appearanceTab"), icon: <Palette className="w-4 h-4" /> },
    { id: "language", label: t("settings.languageTab"), icon: <Globe className="w-4 h-4" /> },
    { id: "models", label: t("settings.modelsTab"), icon: <Cpu className="w-4 h-4" /> },
    { id: "archived", label: t("settings.archivedTab"), icon: <Archive className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-[100dvh] bg-[var(--surface)] text-[var(--ink)]">
      <header className="flex items-center justify-between h-14 px-4 border-b border-[var(--border)] bg-[var(--panel)]">
        <Link
          href="/"
          className="inline-flex items-center justify-center w-8 h-8 rounded-[8px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors sm:w-auto sm:px-2.5 sm:py-1.5 sm:gap-1.5"
          aria-label="Kembali"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline text-sm font-medium">Devnuby</span>
        </Link>
        <h1 className="text-[15px] font-semibold text-[var(--ink)]">{t("settings.title")}</h1>
        <div className="w-8 sm:w-16" />
      </header>

      {/* Mobile Horizontal Tabs Bar (Sticky under header) */}
      <div className="md:hidden border-b border-[var(--border)] bg-[var(--panel)] sticky top-0 z-20 overflow-x-auto scrollbar-none px-2">
        <div className="flex items-center gap-1 min-w-max py-1.5">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              type="button"
              onClick={() => setTab(tb.id)}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-[8px] text-[13px] font-medium transition-all whitespace-nowrap cursor-pointer",
                tab === tb.id
                  ? "bg-[var(--accent-soft)] text-[var(--accent)] font-semibold shadow-xs"
                  : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
              )}
            >
              {tb.icon}
              <span>{tb.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-[920px] mx-auto px-4 py-5 md:py-8 grid grid-cols-1 md:grid-cols-[215px_1fr] gap-6 md:gap-8">
        {/* Desktop Sidebar Navigation */}
        <nav className="hidden md:block space-y-1">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              type="button"
              onClick={() => setTab(tb.id)}
              className={cn(
                "flex items-center gap-2.5 w-full px-3 py-2.5 rounded-[8px] text-sm transition-colors cursor-pointer text-left",
                tab === tb.id
                  ? "bg-[var(--accent-soft)] text-[var(--accent)] font-semibold"
                  : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
              )}
            >
              {tb.icon}
              <span>{tb.label}</span>
            </button>
          ))}
        </nav>

        <main className="glass rounded-[12px] p-5 sm:p-6 bg-[var(--panel)] border border-[var(--glass-border)] min-w-0">
          {tab === "profile" && <ProfileTab />}
          {tab === "usage" && <UsageTab />}
          {tab === "appearance" && <AppearanceTab />}
          {tab === "language" && <LanguageTab />}
          {tab === "models" && <ModelsTab />}
          {tab === "archived" && <ArchivedChatsTab />}
        </main>
      </div>
    </div>
  );
}
