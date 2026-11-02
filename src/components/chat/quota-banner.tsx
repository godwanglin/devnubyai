"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Gauge, X } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/providers/i18n-provider";
import type { QuotaNotice } from "@/lib/chat/quota-shared";
import { formatUsd } from "@/lib/billing/format";

interface QuotaBannerProps {
  notice: QuotaNotice;
  onDismiss: () => void;
  /** Called once the limit has freed up again */
  onExpire: () => void;
}

/** Frosted notice above the composer explaining which limit was hit and when it resets. */
export function QuotaBanner({ notice, onDismiss, onExpire }: QuotaBannerProps) {
  const { t, locale } = useI18n();
  const resetMs = new Date(notice.resetAt).getTime();
  const [now, setNow] = useState(() => Date.now());

  // Short limits count down live; long ones only need to notice when they lapse
  useEffect(() => {
    const interval = notice.kind === "rate_per_minute" ? 1000 : 60_000;
    const id = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(id);
  }, [notice.kind]);

  useEffect(() => {
    if (now >= resetMs) onExpire();
  }, [now, resetMs, onExpire]);

  const resetDate = new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-US", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(resetMs));
  const seconds = String(Math.max(1, Math.ceil((resetMs - now) / 1000)));
  const isCost =
    notice.kind === "monthly_cost" || notice.kind === "weekly_cost" || notice.kind === "five_hour_cost";
  // Spend limits are dollars, request limits are counts
  const used = isCost ? formatUsd(notice.used) : notice.used.toLocaleString();
  const limit = isCost ? formatUsd(notice.limit) : notice.limit.toLocaleString();

  const costTitles = {
    monthly_cost: "quota.monthlyTitle",
    weekly_cost: "quota.weeklyTitle",
    five_hour_cost: "quota.fiveHourTitle",
  } as const;

  const content = isCost
    ? {
        title: t(costTitles[notice.kind as keyof typeof costTitles]),
        body: t("quota.costBody", { used, limit, date: resetDate }),
      }
    : notice.kind === "daily_requests"
      ? {
          title: t("quota.dailyTitle"),
          body: t("quota.dailyBody", { used, limit, date: resetDate }),
        }
      : {
          title: t("quota.rateTitle"),
          body: t("quota.rateBody", { limit, seconds }),
        };

  // Same frosted surface as popovers (`.glass` tokens), kept to a single compact row
  return (
    <div
      role="status"
      aria-live="polite"
      className="glass flex items-center gap-2 rounded-[10px] pl-2.5 pr-1 py-1 text-[12px] animate-[fade-in_0.2s_ease-out]"
    >
      <Gauge className="w-3.5 h-3.5 shrink-0 text-amber-500" />
      <p className="min-w-0 flex-1 truncate" title={`${content.title} · ${content.body}`}>
        <span className="font-medium text-[var(--ink)]">{content.title}</span>
        <span className="text-[var(--muted)]"> · {content.body}</span>
      </p>
      {notice.kind !== "rate_per_minute" ? (
        <Link
          href="#/settings/usage"
          className="shrink-0 px-1.5 py-0.5 rounded-[6px] font-medium text-[var(--primary)] hover:bg-[var(--hover)] transition-colors"
        >
          {t("quota.viewUsage")}
        </Link>
      ) : null}
      <Tooltip content={t("quota.dismiss")} side="top" align="end">
        <button
          type="button"
          onClick={onDismiss}
          className="grid place-items-center w-6 h-6 shrink-0 rounded-[6px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
          aria-label={t("quota.dismiss")}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
    </div>
  );
}
