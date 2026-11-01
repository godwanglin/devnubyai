"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  LogOut,
  MessageSquare,
  Settings,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { DropdownSeparator } from "@/components/ui/dropdown";
import { useI18n } from "@/providers/i18n-provider";

export interface AdminUserProfile {
  id: string;
  name: string;
  email: string;
  initials: string;
  avatarUrl: string | null;
  role: string;
  status: string;
  planLabel: string;
}

export function AdminProfilePopover({ user }: { user: AdminUserProfile }) {
  const { t } = useI18n();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
      window.location.href = "/";
    } catch {
      window.location.href = "/";
    }
  }

  return (
    <Popover
      side="bottom"
      align="end"
      className="w-72 p-0 overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--panel)] shadow-xl"
      trigger={
        <button
          type="button"
          className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-[10px] hover:bg-[var(--hover)] border border-[var(--border)] bg-[var(--surface)] transition-all cursor-pointer group"
          aria-label="Admin Profile"
        >
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.name}
              className="w-7 h-7 rounded-full object-cover shrink-0 ring-1 ring-[var(--border)]"
            />
          ) : (
            <span className="grid place-items-center w-7 h-7 rounded-full bg-[var(--accent)] text-[var(--accent-text)] text-xs font-bold shrink-0">
              {user.initials}
            </span>
          )}

          <div className="hidden sm:flex flex-col text-left">
            <span className="text-xs font-semibold text-[var(--ink)] leading-tight truncate max-w-[120px]">
              {user.name}
            </span>
            <span className="text-[10px] font-semibold text-[var(--accent)] uppercase tracking-wider">
              {user.role}
            </span>
          </div>

          <ChevronDown className="w-3.5 h-3.5 text-[var(--muted)] group-hover:text-[var(--ink)] transition-colors" />
        </button>
      }
    >
      <div className="p-3.5 bg-[var(--surface)] border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.name}
              className="w-10 h-10 rounded-full object-cover shrink-0 ring-2 ring-[var(--accent)]"
            />
          ) : (
            <span className="grid place-items-center w-10 h-10 rounded-full bg-[var(--accent)] text-[var(--accent-text)] text-sm font-bold shrink-0">
              {user.initials}
            </span>
          )}

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--ink)] truncate">{user.name}</p>
            <p className="text-xs text-[var(--muted)] truncate">{user.email}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-[var(--border)] text-[11px]">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium bg-[var(--accent-soft)] text-[var(--accent)]">
            <ShieldCheck className="w-3 h-3" />
            <span className="capitalize">{user.role}</span>
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-3 h-3" />
            <span className="capitalize">{user.status}</span>
          </span>
        </div>
      </div>

      <div className="p-1.5 space-y-0.5">
        <Link
          href="/"
          className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-[8px] text-xs font-medium text-[var(--ink)] hover:bg-[var(--hover)] transition-colors"
        >
          <MessageSquare className="w-4 h-4 text-[var(--accent)]" />
          <span>{t("admin.backToChat")}</span>
        </Link>

        <Link
          href="/#/settings/account"
          className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-[8px] text-xs font-medium text-[var(--ink)] hover:bg-[var(--hover)] transition-colors"
        >
          <Settings className="w-4 h-4 text-[var(--muted)]" />
          <span>{t("nav.settings")}</span>
        </Link>

        <DropdownSeparator />

        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-[8px] text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer disabled:opacity-50"
        >
          <LogOut className="w-4 h-4" />
          <span>{loggingOut ? "Logging out..." : t("nav.logout")}</span>
        </button>
      </div>
    </Popover>
  );
}
