"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Server, Database, Sparkles, FileText, Settings2, MessageSquareText, CreditCard, Layers3, Users } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import { cn } from "@/lib/cn";

interface NavItem {
  href: string;
  labelKey: string;
  icon: React.ReactNode;
}

export function AdminNavShell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();

  const navItems: NavItem[] = [
    {
      href: "/admin/gateway",
      labelKey: "admin.tabs.gateways",
      icon: <Server className="w-4 h-4" />,
    },
    {
      href: "/admin/upstream",
      labelKey: "admin.tabs.upstream",
      icon: <Database className="w-4 h-4" />,
    },
    {
      href: "/admin/model-catalog",
      labelKey: "admin.tabs.chatCatalog",
      icon: <Sparkles className="w-4 h-4" />,
    },
    {
      href: "/admin/logs",
      labelKey: "admin.tabs.logs",
      icon: <FileText className="w-4 h-4" />,
    },
    {
      href: "/admin/system-prompts",
      labelKey: "admin.tabs.systemPrompts",
      icon: <MessageSquareText className="w-4 h-4" />,
    },
    {
      href: "/admin/users",
      labelKey: "admin.tabs.users",
      icon: <Users className="w-4 h-4" />,
    },
    {
      href: "/admin/plans",
      labelKey: "admin.tabs.plans",
      icon: <Layers3 className="w-4 h-4" />,
    },
    {
      href: "/admin/payments",
      labelKey: "admin.tabs.payments",
      icon: <CreditCard className="w-4 h-4" />,
    },
    {
      href: "/admin/settings",
      labelKey: "admin.tabs.settings",
      icon: <Settings2 className="w-4 h-4" />,
    },
  ];

  return (
    <div className="min-h-[100dvh] bg-[var(--surface)] text-[var(--ink)]">
      <header className="flex items-center justify-between h-14 px-4 border-b border-[var(--border)] bg-[var(--panel)]">
        <Link
          href="/"
          className="inline-flex items-center justify-center w-8 h-8 rounded-[8px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors sm:w-auto sm:px-2.5 sm:py-1.5 sm:gap-1.5"
          aria-label={t("admin.backToChat")}
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline text-sm font-medium">{t("admin.backToChat")}</span>
        </Link>
        <h1 className="text-[15px] font-semibold text-[var(--ink)]">{t("admin.title")}</h1>
        <div className="w-8 sm:w-16" />
      </header>

      {/* Mobile Horizontal Tabs Navigation */}
      <div className="md:hidden border-b border-[var(--border)] bg-[var(--panel)] sticky top-0 z-20 overflow-x-auto scrollbar-none px-2">
        <div className="flex items-center gap-1 min-w-max py-1.5">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-[8px] text-[13px] font-medium transition-all whitespace-nowrap",
                  isActive
                    ? "bg-[var(--accent-soft)] text-[var(--accent)] font-semibold shadow-xs"
                    : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                )}
              >
                {item.icon}
                <span>{t(item.labelKey)}</span>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="max-w-[1200px] mx-auto px-4 py-5 md:py-8 grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6 md:gap-8">
        {/* Desktop Sidebar Navigation */}
        <nav className="hidden md:block space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 w-full px-3 py-2.5 rounded-[8px] text-sm transition-colors text-left",
                  isActive
                    ? "bg-[var(--accent-soft)] text-[var(--accent)] font-semibold"
                    : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                )}
              >
                {item.icon}
                <span>{t(item.labelKey)}</span>
              </Link>
            );
          })}
        </nav>

        {/* Page Content */}
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
