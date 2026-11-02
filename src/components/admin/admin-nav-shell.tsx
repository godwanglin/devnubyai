"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Server,
  Database,
  Sparkles,
  FileText,
  Settings2,
  MessageSquareText,
  CreditCard,
  Layers3,
  Users,
  BarChart3,
  Activity,
  Menu,
  X,
  ArrowLeft,
  ChevronRight,
  Shield,
} from "lucide-react";
import { DevnubyWordmark } from "@/components/brand/devnuby-logo";
import { AdminProfilePopover, type AdminUserProfile } from "./admin-profile-popover";
import { useI18n } from "@/providers/i18n-provider";
import { cn } from "@/lib/cn";

interface NavItem {
  href: string;
  labelKey: string;
  icon: React.ReactNode;
}

interface NavGroup {
  groupKey: string;
  items: NavItem[];
}

export function AdminNavShell({
  children,
  user,
}: {
  children: React.ReactNode;
  user: AdminUserProfile;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile drawer when route changes
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const navGroups: NavGroup[] = [
    {
      groupKey: "admin.groups.overview",
      items: [
        {
          href: "/admin/metrics",
          labelKey: "admin.tabs.metrics",
          icon: <BarChart3 className="w-4 h-4 shrink-0" />,
        },
        {
          href: "/admin/system-health",
          labelKey: "admin.tabs.systemHealth",
          icon: <Activity className="w-4 h-4 shrink-0" />,
        },
      ],
    },
    {
      groupKey: "admin.groups.ai",
      items: [
        {
          href: "/admin/gateway",
          labelKey: "admin.tabs.gateways",
          icon: <Server className="w-4 h-4 shrink-0" />,
        },
        {
          href: "/admin/upstream",
          labelKey: "admin.tabs.upstream",
          icon: <Database className="w-4 h-4 shrink-0" />,
        },
        {
          href: "/admin/model-catalog",
          labelKey: "admin.tabs.chatCatalog",
          icon: <Sparkles className="w-4 h-4 shrink-0" />,
        },
        {
          href: "/admin/system-prompts",
          labelKey: "admin.tabs.systemPrompts",
          icon: <MessageSquareText className="w-4 h-4 shrink-0" />,
        },
      ],
    },
    {
      groupKey: "admin.groups.management",
      items: [
        {
          href: "/admin/users",
          labelKey: "admin.tabs.users",
          icon: <Users className="w-4 h-4 shrink-0" />,
        },
        {
          href: "/admin/plans",
          labelKey: "admin.tabs.plans",
          icon: <Layers3 className="w-4 h-4 shrink-0" />,
        },
        {
          href: "/admin/payments",
          labelKey: "admin.tabs.payments",
          icon: <CreditCard className="w-4 h-4 shrink-0" />,
        },
      ],
    },
    {
      groupKey: "admin.groups.system",
      items: [
        {
          href: "/admin/logs",
          labelKey: "admin.tabs.logs",
          icon: <FileText className="w-4 h-4 shrink-0" />,
        },
        {
          href: "/admin/settings",
          labelKey: "admin.tabs.settings",
          icon: <Settings2 className="w-4 h-4 shrink-0" />,
        },
      ],
    },
  ];

  // Find active navigation item label for topbar breadcrumb
  const allItems = navGroups.flatMap((g) => g.items);
  const activeItem = allItems.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
  );
  const activeTitle = activeItem ? t(activeItem.labelKey) : t("admin.title");

  const renderNavLinks = () => (
    <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5 scrollbar-thin">
      {navGroups.map((group) => (
        <div key={group.groupKey} className="space-y-1">
          <p className="px-3 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">
            {t(group.groupKey)}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-[8px] text-[13px] font-medium transition-all group",
                    isActive
                      ? "bg-[var(--accent-soft)] text-[var(--accent)] font-semibold shadow-xs"
                      : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                  )}
                >
                  <span
                    className={cn(
                      "transition-colors",
                      isActive
                        ? "text-[var(--accent)]"
                        : "text-[var(--muted)] group-hover:text-[var(--ink)]"
                    )}
                  >
                    {item.icon}
                  </span>
                  <span className="truncate">{t(item.labelKey)}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="h-[100dvh] flex overflow-hidden bg-[var(--surface)] text-[var(--ink)]">
      {/* Desktop Left Sidebar */}
      <aside className="hidden md:flex flex-col w-64 shrink-0 h-full bg-[var(--panel)] border-r border-[var(--border)] select-none">
        {/* Brand / Logo Header */}
        <div className="h-14 px-4 flex items-center justify-between border-b border-[var(--border)] shrink-0">
          <Link
            href="/admin/metrics"
            className="flex items-center gap-2.5 group"
            aria-label={t("brand.name")}
          >
            <DevnubyWordmark className="h-7 w-auto" />
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent-soft)]">
              <Shield className="w-2.5 h-2.5" />
              {t("admin.badge")}
            </span>
          </Link>
        </div>

        {/* Navigation Menu */}
        {renderNavLinks()}

        {/* Sidebar Footer */}
        <div className="p-3 border-t border-[var(--border)] bg-[var(--panel)] shrink-0 space-y-2">
          <Link
            href="/"
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-[8px] text-xs font-medium text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors"
          >
            <ArrowLeft className="w-4 h-4 shrink-0" />
            <span className="truncate">{t("admin.backToChat")}</span>
          </Link>

          <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--muted)]">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="truncate">DevNuby Console v2.0</span>
          </div>
        </div>
      </aside>

      {/* Mobile Backdrop & Drawer */}
      {mobileOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex md:hidden"
        >
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative flex flex-col w-72 max-w-[85vw] h-full bg-[var(--panel)] border-r border-[var(--border)] shadow-2xl z-10">
            {/* Drawer Header */}
            <div className="h-14 px-4 flex items-center justify-between border-b border-[var(--border)] shrink-0">
              <Link
                href="/admin/metrics"
                className="flex items-center gap-2"
                aria-label={t("brand.name")}
              >
                <DevnubyWordmark className="h-7 w-auto" />
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent-soft)]">
                  {t("admin.badge")}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="p-1.5 rounded-[8px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mobile Nav Links */}
            {renderNavLinks()}

            {/* Mobile Footer */}
            <div className="p-3 border-t border-[var(--border)] bg-[var(--panel)] shrink-0">
              <Link
                href="/"
                className="flex items-center gap-2.5 w-full px-3 py-2 rounded-[8px] text-xs font-medium text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors"
              >
                <ArrowLeft className="w-4 h-4 shrink-0" />
                <span className="truncate">{t("admin.backToChat")}</span>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Main Layout Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Topbar */}
        <header className="h-14 shrink-0 px-4 md:px-6 flex items-center justify-between border-b border-[var(--border)] bg-[var(--panel)]/80 backdrop-blur-md sticky top-0 z-20">
          {/* Left: Mobile Toggle & Breadcrumbs */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="md:hidden p-1.5 rounded-[8px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            <nav
              aria-label="Breadcrumb"
              className="flex items-center gap-1.5 text-xs font-medium min-w-0"
            >
              <span className="text-[var(--muted)] hover:text-[var(--ink)] transition-colors hidden sm:inline">
                {t("admin.title")}
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-[var(--muted)] shrink-0 hidden sm:inline" />
              <span className="text-[var(--ink)] font-semibold truncate text-[13px] sm:text-xs">
                {activeTitle}
              </span>
            </nav>
          </div>

          {/* Right: Quick Chat Link + Profile Popover */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <Link
              href="/"
              className="hidden lg:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] border border-[var(--border)] transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{t("admin.backToChat")}</span>
            </Link>

            {/* Profile Popover with User Account Info */}
            <AdminProfilePopover user={user} />
          </div>
        </header>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 bg-[var(--surface)]">
          <div className="max-w-7xl mx-auto w-full">{children}</div>
        </main>
      </div>
    </div>
  );
}
