"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/providers/i18n-provider";
import { useAccount } from "@/providers/account-provider";
import { useQuota } from "@/hooks/use-quota";
import type { Locale, QuotaWindowInfo } from "@/types";

const UNITS: Record<Locale, { day: string; hour: string; minute: string }> = {
  id: { day: "hr", hour: "j", minute: "mnt" },
  en: { day: "d", hour: "h", minute: "min" },
};

/** "3 j, 32 mnt" under a day, "5 hr, 0 j" beyond it. */
function formatCountdown(targetIso: string, locale: Locale): string {
  const u = UNITS[locale];
  const totalMinutes = Math.max(1, Math.ceil((new Date(targetIso).getTime() - Date.now()) / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} ${u.day}, ${hours} ${u.hour}`;
  if (hours > 0) return `${hours} ${u.hour}, ${minutes} ${u.minute}`;
  return `${minutes} ${u.minute}`;
}

function QuotaRow({ title, window }: { title: string; window: QuotaWindowInfo }) {
  const { t, locale } = useI18n();
  const remaining = Math.max(0, 100 - window.usedPercent);

  return (
    <div>
      <p className="text-sm font-semibold text-[var(--ink)]">{title}</p>
      <div className="mt-1 flex items-center justify-between text-xs text-[var(--muted)]">
        <span>{t("usage.resetsIn", { time: formatCountdown(window.resetAt, locale) })}</span>
        <span>{t("usage.remaining", { percent: remaining })}</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
        <div
          className="h-full rounded-full bg-[var(--ink)] transition-all duration-500"
          style={{ width: `${remaining}%` }}
        />
      </div>
    </div>
  );
}

export function UsageTab() {
  const { t } = useI18n();
  const { user } = useAccount();
  const { quota, refresh } = useQuota(Boolean(user));

  // The sidebar may hold an older snapshot; refetch when the tab opens
  useEffect(() => {
    if (user) void refresh();
  }, [user, refresh]);

  // Re-render every 30s so the countdowns stay current
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!user) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-[var(--ink)]">{t("usage.title")}</h2>
        <p className="text-xs text-[var(--muted)]">{t("usage.signedOut")}</p>
        <Link
          href="/login"
          className="inline-block px-4 py-2 rounded-[10px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-sm font-semibold text-[var(--accent-text)] transition-colors"
        >
          {t("nav.login")}
        </Link>
      </div>
    );
  }

  const windows = quota?.windows;
  // Windows set to 0/empty by the admin have no limit and are hidden
  const rows = windows
    ? [
        { key: "fiveHour", title: t("usage.fiveHour"), window: windows.fiveHour },
        { key: "weekly", title: t("usage.weekly"), window: windows.weekly },
        { key: "monthly", title: t("usage.monthly"), window: windows.monthly },
      ].filter((row) => row.window.limitTokens !== null)
    : [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[var(--ink)]">{t("usage.title")}</h2>
        <p className="text-xs text-[var(--muted)]">{t("usage.description", { plan: user.planLabel })}</p>
      </div>

      <div className="space-y-5 rounded-[12px] border border-[var(--border)] bg-[var(--panel-elevated)] p-4">
        {rows.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">{t("usage.allUnlimited")}</p>
        ) : (
          rows.map((row) => <QuotaRow key={row.key} title={row.title} window={row.window} />)
        )}
      </div>
    </div>
  );
}
