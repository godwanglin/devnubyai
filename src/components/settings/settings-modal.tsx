"use client";

import React, { useState, useEffect, useRef, useCallback, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { User, Sliders, Gauge, Shield, Archive, X } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import { cn } from "@/lib/cn";
import { ProfileTab } from "./tabs/profile-tab";
import { PreferencesTab } from "./tabs/preferences-tab";
import { UsageTab } from "./tabs/usage-tab";
import { SecurityTab } from "./tabs/security-tab";
import { ArchivedChatsTab } from "./tabs/archived-chats-tab";

export type SettingsTabId = "profile" | "preferences" | "usage" | "security" | "archived";
const TAB_IDS: SettingsTabId[] = ["profile", "preferences", "usage", "security", "archived"];

function parseHashSettings(hash: string): { isOpen: boolean; tab: SettingsTabId } {
  if (!hash || !hash.startsWith("#/settings")) {
    return { isOpen: false, tab: "profile" };
  }

  // Format: #/settings or #/settings/profile or #/settings/security or #/settings?tab=usage
  const clean = hash.replace(/^#\/settings\/?/, "");
  const segment = clean.split(/[?#/]/)[0]?.toLowerCase();

  if (segment === "preferences" || segment === "appearance" || segment === "language") {
    return { isOpen: true, tab: "preferences" };
  }
  if (segment && TAB_IDS.includes(segment as SettingsTabId)) {
    return { isOpen: true, tab: segment as SettingsTabId };
  }

  // Query parameter fallback (e.g. #/settings?tab=usage)
  const qIndex = clean.indexOf("?");
  if (qIndex !== -1) {
    const params = new URLSearchParams(clean.slice(qIndex));
    const tabParam = params.get("tab") as SettingsTabId | null;
    if (tabParam && TAB_IDS.includes(tabParam)) {
      return { isOpen: true, tab: tabParam };
    }
  }

  return { isOpen: true, tab: "profile" };
}

const emptySubscribe = () => () => {};

export function SettingsModal() {
  const { t } = useI18n();
  const overlayRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTabId>("profile");

  const isMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const closeModal = useCallback(() => {
    setIsOpen(false);
    const cleanUrl = window.location.pathname + window.location.search;
    window.history.replaceState(null, "", cleanUrl);
  }, []);

  const selectTab = useCallback((tb: SettingsTabId) => {
    setActiveTab(tb);
    const newHash = `#/settings/${tb}`;
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search + newHash
    );
  }, []);

  // Sync state from URL hash, global clicks, and history changes
  useEffect(() => {
    function checkHash() {
      const parsed = parseHashSettings(window.location.hash);
      setIsOpen(parsed.isOpen);
      if (parsed.isOpen) {
        setActiveTab(parsed.tab);
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

  const tabs: { id: SettingsTabId; label: string; icon: React.ReactNode }[] = [
    { id: "profile", label: t("settings.profileTab"), icon: <User className="w-4 h-4" /> },
    { id: "preferences", label: t("settings.preferencesTab"), icon: <Sliders className="w-4 h-4" /> },
    { id: "usage", label: t("settings.usageTab"), icon: <Gauge className="w-4 h-4" /> },
    { id: "security", label: t("settings.securityTab"), icon: <Shield className="w-4 h-4" /> },
    { id: "archived", label: t("settings.archivedTab"), icon: <Archive className="w-4 h-4" /> },
  ];

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
          <nav className="hidden md:block p-4 sm:p-5 border-r border-[var(--border)] bg-[var(--panel-elevated)] space-y-1.5 overflow-y-auto">
            {tabs.map((tb) => (
              <button
                key={tb.id}
                type="button"
                onClick={() => selectTab(tb.id)}
                className={cn(
                  "flex items-center gap-3 w-full px-3.5 py-2.5 rounded-[10px] text-sm font-medium transition-colors cursor-pointer text-left",
                  activeTab === tb.id
                    ? "bg-[var(--accent-soft)] text-[var(--accent)] font-semibold"
                    : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                )}
              >
                {tb.icon}
                <span>{tb.label}</span>
              </button>
            ))}
          </nav>

          {/* Tab Content Area */}
          <main className="flex-1 overflow-y-auto p-5 sm:p-7 md:p-8 bg-[var(--panel)] min-w-0">
            {activeTab === "profile" && <ProfileTab />}
            {activeTab === "preferences" && <PreferencesTab />}
            {activeTab === "usage" && <UsageTab />}
            {activeTab === "security" && <SecurityTab />}
            {activeTab === "archived" && <ArchivedChatsTab />}
          </main>
        </div>
      </div>
    </div>,
    document.body
  );
}
