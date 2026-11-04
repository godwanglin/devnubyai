"use client";

import React, { useState, useEffect, useRef, useCallback, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { User, Sliders, Brain, Gauge, Shield, Database, Search, X } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import { cn } from "@/lib/cn";
import { ProfileTab } from "./tabs/profile-tab";
import { PreferencesTab } from "./tabs/preferences-tab";
import { UsageTab } from "./tabs/usage-tab";
import { SecurityTab } from "./tabs/security-tab";
import { DataControlsTab } from "./tabs/data/data-controls-tab";
import { MemoryTab } from "./tabs/memory-tab";

export type SettingsTabId = "profile" | "preferences" | "memory" | "usage" | "security" | "data" | "archived";
const TAB_IDS: SettingsTabId[] = ["profile", "preferences", "memory", "usage", "security", "data", "archived"];

interface ParsedSettingsHash {
  isOpen: boolean;
  tab: SettingsTabId;
  subView?: string;
}

function parseHashSettings(hash: string): ParsedSettingsHash {
  if (!hash || !hash.startsWith("#/settings")) {
    return { isOpen: false, tab: "profile" };
  }

  // Format: #/settings or #/settings/profile or #/settings/data/archived
  const clean = hash.replace(/^#\/settings\/?/, "");
  const parts = clean.split(/[?#]/)[0]?.split("/").filter(Boolean) || [];
  const primary = parts[0]?.toLowerCase();
  const subView = parts[1]?.toLowerCase();

  let tab: SettingsTabId = "profile";

  if (primary === "account") {
    tab = "profile";
  } else if (primary === "preferences" || primary === "appearance" || primary === "language") {
    tab = "preferences";
  } else if (primary === "data") {
    tab = "data";
  } else if (primary === "archived") {
    tab = "data";
    return { isOpen: true, tab: "data", subView: "archived" };
  } else if (primary && TAB_IDS.includes(primary as SettingsTabId)) {
    tab = primary as SettingsTabId;
  } else {
    // Query parameter fallback (e.g. #/settings?tab=usage)
    const qIndex = clean.indexOf("?");
    if (qIndex !== -1) {
      const params = new URLSearchParams(clean.slice(qIndex));
      const tabParam = params.get("tab") as SettingsTabId | null;
      if (tabParam && TAB_IDS.includes(tabParam)) {
        tab = tabParam;
      }
    }
  }

  return { isOpen: true, tab, subView };
}

const emptySubscribe = () => () => {};

export function SettingsModal() {
  const { t } = useI18n();
  const overlayRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTabId>("profile");
  const [activeSubView, setActiveSubView] = useState<string | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState("");

  const isMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const closeModal = useCallback(() => {
    setIsOpen(false);
    setActiveSubView(undefined);
    const cleanUrl = window.location.pathname + window.location.search;
    window.history.replaceState(null, "", cleanUrl);
  }, []);

  const selectTab = useCallback((tb: SettingsTabId) => {
    setActiveTab(tb);
    setActiveSubView(undefined);
    const targetPath = tb === "profile" ? "account" : tb;
    const newHash = `#/settings/${targetPath}`;
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search + newHash
    );
  }, []);

  const handleSecuritySubViewChange = useCallback((sub: "main" | "sessions" | "history") => {
    setActiveSubView(sub === "main" ? undefined : sub);
    const targetHash = sub === "main" ? "#/settings/security" : `#/settings/security/${sub}`;
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search + targetHash
    );
  }, []);

  const handleDataSubViewChange = useCallback((sub: "main" | "archived") => {
    setActiveSubView(sub === "main" ? undefined : sub);
    const targetHash = sub === "main" ? "#/settings/data" : `#/settings/data/${sub}`;
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search + targetHash
    );
  }, []);

  // Sync state from URL hash, global clicks, and history changes
  useEffect(() => {
    function checkHash() {
      const parsed = parseHashSettings(window.location.hash);
      setIsOpen(parsed.isOpen);
      if (parsed.isOpen) {
        setActiveTab(parsed.tab);
        setActiveSubView(parsed.subView);
      }
    }

    // Initial check on page load / reload
    checkHash();

    window.addEventListener("hashchange", checkHash);
    window.addEventListener("popstate", checkHash);

    // Global click delegate for any settings link across the whole app
    function onDocumentClick(e: MouseEvent) {
      const target = (e.target as HTMLElement)?.closest(
        'a[href*="#/settings"], a[href="/settings"], a[href^="/settings?"]'
      );
      if (!target) return;

      const href = target.getAttribute("href") || "";

      // Legacy direct path (/settings or /settings?tab=...)
      if (href === "/settings" || href.startsWith("/settings?")) {
        e.preventDefault();
        e.stopPropagation();
        const tab = href.includes("tab=usage") ? "usage" : "profile";
        setIsOpen(true);
        setActiveTab(tab);
        setActiveSubView(undefined);
        window.history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search + `#/settings/${tab}`
        );
        return;
      }

      // Hash link (#/settings or #/settings/...)
      const hashIndex = href.indexOf("#/settings");
      if (hashIndex !== -1) {
        const hash = href.slice(hashIndex);
        const parsed = parseHashSettings(hash);
        if (parsed.isOpen) {
          setIsOpen(true);
          setActiveTab(parsed.tab);
          setActiveSubView(parsed.subView);
          window.history.replaceState(
            null,
            "",
            window.location.pathname + window.location.search + hash
          );
        }
      }
    }

    document.addEventListener("click", onDocumentClick, true);

    return () => {
      window.removeEventListener("hashchange", checkHash);
      window.removeEventListener("popstate", checkHash);
      document.removeEventListener("click", onDocumentClick, true);
    };
  }, []);

  // Keyboard Escape listener
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closeModal();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, closeModal]);

  if (!isMounted || !isOpen) return null;

  const tabs: { id: SettingsTabId; label: string; icon: React.ReactNode; keywords?: string }[] = [
    { id: "profile", label: t("settings.profileTab"), icon: <User className="w-4 h-4" />, keywords: "akun profile email foto avatar paket" },
    { id: "preferences", label: t("settings.preferencesTab"), icon: <Sliders className="w-4 h-4" />, keywords: "tampilan tema font bahasa suara kecepatan" },
    { id: "memory", label: t("settings.memoryTab"), icon: <Brain className="w-4 h-4" />, keywords: "memory memori ingat catatan preferensi ekspor impor" },
    { id: "usage", label: t("settings.usageTab"), icon: <Gauge className="w-4 h-4" />, keywords: "penggunaan kuota token limit pemakaian" },
    { id: "security", label: t("settings.securityTab"), icon: <Shield className="w-4 h-4" />, keywords: "keamanan sandi password pin passkey sesi aktif" },
    { id: "data", label: t("settings.dataControlsTab"), icon: <Database className="w-4 h-4" />, keywords: "data kontrol lokasi tautan arsip hapus ekspor" },
  ];

  const filteredTabs = searchQuery.trim()
    ? tabs.filter((tb) =>
        tb.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (tb.keywords && tb.keywords.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : tabs;

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 md:p-6"
      onClick={(e) => {
        if (e.target === overlayRef.current) closeModal();
      }}
    >
      <div className="w-full h-[100dvh] sm:h-[88vh] sm:max-h-[820px] sm:max-w-[1040px] md:max-w-[1080px] bg-[var(--panel)] sm:rounded-[20px] border-0 sm:border border-[var(--border)] shadow-2xl flex flex-col overflow-hidden animate-in fade-in sm:zoom-in-95 duration-200">
        {/* Modal Top Header */}
        <header className="flex items-center justify-between h-14 px-4 sm:px-6 border-b border-[var(--border)] bg-[var(--panel)] shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-[var(--ink)]">
              {t("settings.title")}
            </h2>
          </div>
          <button
            type="button"
            onClick={closeModal}
            className="w-9 h-9 rounded-[8px] grid place-items-center text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
            aria-label="Tutup pengaturan"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Mobile Horizontal Tabs Bar (Sticky under header with hidden scrollbar) */}
        <div className="md:hidden border-b border-[var(--border)] bg-[var(--panel-elevated)] overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden px-2 shrink-0">
          <div className="flex items-center gap-1.5 min-w-max py-2">
            {tabs.map((tb) => (
              <button
                key={tb.id}
                type="button"
                onClick={() => selectTab(tb.id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-[8px] text-[13px] font-medium transition-all whitespace-nowrap cursor-pointer",
                  activeTab === tb.id
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

        {/* Layout Grid: Desktop Sidebar + Content Area */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-[260px_1fr] min-h-0 overflow-hidden">
          {/* Desktop Navigation */}
          <nav className="hidden md:flex flex-col p-4 sm:p-5 border-r border-[var(--border)] bg-[var(--panel-elevated)] overflow-y-auto">
            {/* Search Box (Claude style) */}
            <div className="relative mb-3.5">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("settings.search")}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--surface-hover)] border border-[var(--border)]/50 text-[var(--ink)] placeholder-[var(--muted)] outline-none focus:border-[var(--accent)] transition-colors"
              />
            </div>

            <div className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider px-2 mb-1.5">
              {t("settings.preferencesTab")}
            </div>

            <div className="space-y-1 flex-1">
              {filteredTabs.map((tb) => (
                <button
                  key={tb.id}
                  type="button"
                  onClick={() => selectTab(tb.id)}
                  className={cn(
                    "flex items-center gap-2.5 w-full px-3 py-2 rounded-[8px] text-[13px] font-medium transition-colors cursor-pointer text-left",
                    activeTab === tb.id
                      ? "bg-[var(--hover)] text-[var(--ink)] font-semibold"
                      : "text-[var(--muted)] hover:bg-[var(--hover)]/60 hover:text-[var(--ink)]"
                  )}
                >
                  <span className={activeTab === tb.id ? "text-[var(--accent)]" : "text-[var(--muted)]"}>
                    {tb.icon}
                  </span>
                  <span>{tb.label}</span>
                </button>
              ))}

              {filteredTabs.length === 0 && (
                <p className="text-xs text-[var(--muted)] px-3 py-4 text-center">
                  {t("settings.noResults")}
                </p>
              )}
            </div>
          </nav>

          {/* Tab Content Area */}
          <main className="flex-1 overflow-y-auto p-5 sm:p-7 md:p-8 bg-[var(--panel)] min-w-0">
            {activeTab === "profile" && <ProfileTab />}
            {activeTab === "preferences" && <PreferencesTab />}
            {activeTab === "memory" && <MemoryTab />}
            {activeTab === "usage" && <UsageTab />}
            {activeTab === "security" && (
              <SecurityTab
                currentSubView={
                  activeSubView === "sessions" || activeSubView === "history"
                    ? activeSubView
                    : "main"
                }
                onSubViewChange={handleSecuritySubViewChange}
              />
            )}
            {activeTab === "data" && (
              <DataControlsTab
                currentSubView={activeSubView === "archived" ? "archived" : "main"}
                onSubViewChange={handleDataSubViewChange}
              />
            )}
            {activeTab === "archived" && (
              <DataControlsTab
                currentSubView="archived"
                onSubViewChange={handleDataSubViewChange}
              />
            )}
          </main>
        </div>
      </div>
    </div>,
    document.body
  );
}
