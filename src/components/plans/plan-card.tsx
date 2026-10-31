"use client";

import React from "react";
import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useI18n } from "@/providers/i18n-provider";
import type { PublicPlanItem } from "@/app/api/v1/plans/route";

interface PlanCardProps {
  plan: PublicPlanItem;
  billingCycle: "monthly" | "yearly";
  isCurrentPlan: boolean;
  onSelect: (plan: PublicPlanItem) => void;
}

export function PlanCard({
  plan,
  billingCycle,
  isCurrentPlan,
  onSelect,
}: PlanCardProps) {
  const { t, locale } = useI18n();
  const isFree = plan.slug === "free" || plan.priceMonthly === 0;
  const isPopular = plan.badge?.toLowerCase() === "popular" || plan.slug === "pro";

  // Price calculations
  const basePrice = billingCycle === "monthly" ? plan.priceMonthly : plan.priceYearly;
  const effectivePrice =
    billingCycle === "monthly"
      ? plan.effectivePriceMonthly
      : plan.effectivePriceYearly;
  const hasDiscount = effectivePrice < basePrice;

  // Monthly breakdown for yearly billing
  const monthlyEquivalentYearly = Math.round(effectivePrice / 12);

  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    }).format(val);
  };

  const formatTokens = (num: number | null) => {
    if (num === null || num === 0) return null;
    if (num >= 1_000_000) {
      const millions = num / 1_000_000;
      return locale === "id"
        ? `${millions} Juta`
        : `${millions}M`;
    }
    if (num >= 1_000) {
      const thousands = num / 1_000;
      return locale === "id"
        ? `${thousands} Ribu`
        : `${thousands}K`;
    }
    return num.toLocaleString();
  };

  return (
    <div
      className={cn(
        "relative flex flex-col justify-between p-6 rounded-[16px] transition-all duration-200 border",
        isPopular
          ? "bg-[var(--panel-elevated)] border-white/20 shadow-xl"
          : "bg-[var(--panel)] border-[var(--border)] hover:border-white/20"
      )}
    >
      {/* Popular or Current Badge */}
      <div className="flex items-center justify-between mb-4">
        <div>
          {isPopular && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-white/10 text-[var(--ink)] border border-white/15">
              <Sparkles className="w-3 h-3 text-[var(--accent)]" />
              {t("plans.popular")}
            </span>
          )}
        </div>
        {isCurrentPlan && (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)]/30">
            {t("plans.currentPlan")}
          </span>
        )}
      </div>

      {/* Plan Header */}
      <div>
        <h3 className="text-xl font-bold text-[var(--ink)] tracking-tight">
          {plan.name}
        </h3>
        <p className="text-xs text-[var(--muted)] mt-1.5 min-h-[32px]">
          {plan.description || (isFree ? "Akses dasar untuk eksplorasi AI" : "Kapasitas penuh untuk alur kerja intensif")}
        </p>

        {/* Price Display */}
        <div className="mt-5 pb-5 border-b border-[var(--border)]">
          {isFree ? (
            <div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-extrabold text-[var(--ink)]">Rp 0</span>
                <span className="text-xs text-[var(--placeholder)]">{t("plans.perMonth")}</span>
              </div>
              <p className="text-xs text-[var(--muted)] mt-1">{t("plans.freeForever")}</p>
            </div>
          ) : billingCycle === "monthly" ? (
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-[var(--ink)]">
                  {formatRupiah(effectivePrice)}
                </span>
                <span className="text-xs text-[var(--placeholder)]">{t("plans.perMonth")}</span>
              </div>
              {hasDiscount && (
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs line-through text-[var(--placeholder)]">
                    {formatRupiah(basePrice)}
                  </span>
                  <span className="text-[11px] font-semibold text-emerald-400">
                    Hemat {formatRupiah(basePrice - effectivePrice)}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-[var(--ink)]">
                  {formatRupiah(monthlyEquivalentYearly)}
                </span>
                <span className="text-xs text-[var(--placeholder)]">{t("plans.perMonth")}</span>
              </div>
              <p className="text-xs text-[var(--muted)] mt-1">
                {t("plans.billedYearly", { amount: effectivePrice.toLocaleString("id-ID") })}
              </p>
            </div>
          )}

          {/* Action CTA Button */}
          <div className="mt-5">
            {isCurrentPlan ? (
              <Button
                variant="outline"
                className="w-full text-xs opacity-60 cursor-default"
                disabled
              >
                {t("plans.activePlan")}
              </Button>
            ) : isFree ? (
              <Button
                variant="outline"
                className="w-full text-xs"
                onClick={() => onSelect(plan)}
              >
                {t("plans.choosePlan")}
              </Button>
            ) : (
              <Button
                variant="primary"
                className="w-full text-xs font-semibold py-2.5"
                onClick={() => onSelect(plan)}
              >
                {t("plans.upgradeNow", { name: plan.name })}
              </Button>
            )}
          </div>
        </div>

        {/* Quotas & Limits */}
        <div className="mt-5 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--placeholder)]">
            {t("plans.featuresTitle")}
          </p>

          <ul className="space-y-2.5 text-xs text-[var(--ink)]">
            {/* Monthly token limit */}
            <li className="flex items-center gap-2.5">
              <Check className="w-4 h-4 text-[var(--accent)] shrink-0" />
              <span>
                {plan.monthlyTokenLimit
                  ? t("plans.monthlyTokens", { count: formatTokens(plan.monthlyTokenLimit) || "0" })
                  : t("plans.unlimitedTokens")}
              </span>
            </li>

            {/* 5-Hour token limit */}
            {plan.fiveHourTokenLimit !== null && plan.fiveHourTokenLimit > 0 && (
              <li className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-[var(--accent)] shrink-0" />
                <span>
                  {t("plans.fiveHourTokens", { count: formatTokens(plan.fiveHourTokenLimit) || "0" })}
                </span>
              </li>
            )}

            {/* Weekly token limit */}
            {plan.weeklyTokenLimit !== null && plan.weeklyTokenLimit > 0 && (
              <li className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-[var(--accent)] shrink-0" />
                <span>
                  {t("plans.weeklyTokens", { count: formatTokens(plan.weeklyTokenLimit) || "0" })}
                </span>
              </li>
            )}

            {/* Daily requests limit */}
            {plan.dailyRequestLimit && (
              <li className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-[var(--accent)] shrink-0" />
                <span>
                  {t("plans.dailyRequests", { count: plan.dailyRequestLimit.toLocaleString() })}
                </span>
              </li>
            )}

            {/* Rate limit (RPM) */}
            {plan.requestsPerMinute && (
              <li className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-[var(--accent)] shrink-0" />
                <span>
                  {t("plans.rateLimit", { count: plan.requestsPerMinute })}
                </span>
              </li>
            )}
          </ul>
        </div>

        {/* Supported Models */}
        {plan.models.length > 0 && (
          <div className="mt-6 pt-5 border-t border-[var(--border)]">
            <p className="text-[11px] font-semibold text-[var(--placeholder)] mb-2.5">
              {t("plans.modelsIncluded")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {plan.models.map((m) => (
                <span
                  key={m.id}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-1 rounded-[6px] text-[11px] font-medium border",
                    m.category.toLowerCase() === "powerful"
                      ? "bg-white/[0.08] text-[var(--ink)] border-white/15"
                      : "bg-white/[0.03] text-[var(--muted)] border-white/5"
                  )}
                >
                  {m.category.toLowerCase() === "powerful" && (
                    <Sparkles className="w-3 h-3 text-[var(--accent)] shrink-0" />
                  )}
                  {m.shortName || m.displayName}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
