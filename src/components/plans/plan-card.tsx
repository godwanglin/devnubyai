"use client";

import React from "react";
import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useI18n } from "@/providers/i18n-provider";
import { LucideIcon } from "@/components/ui/lucide-icon";
import { fillFeatureTemplate, normalizePlanFeatures, resolveLocalizedText, type PlanFeature } from "@/lib/plans/features";
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
  const baseMonthlyEquivalentYearly = Math.round(basePrice / 12);

  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat(locale === "en" ? "en-US" : "id-ID", {
      style: "currency",
      currency: plan.currency || "IDR",
      maximumFractionDigits: 0,
    }).format(val);
  };

  /** Text for one "Capacity & Quotas" row; null hides it (hidden auto row, no limit set, or empty). */
  const featureText = (feature: PlanFeature): string | null => {
    if (feature.type === "custom") return resolveLocalizedText(feature.text, locale) || null;
    if (!feature.visible) return null;
    // Admin-written wording for an auto row; empty means the default i18n text
    const override = feature.text ? resolveLocalizedText(feature.text, locale) : "";
    switch (feature.key) {
      case "usage": {
        // Usage allowance relative to the base plan (no dollar amounts shown)
        const { usage } = plan;
        if (override) {
          return fillFeatureTemplate(override, {
            value: usage.kind === "multiple" ? String(usage.multiplier) : usage.kind === "base" ? "1" : "∞",
            base: usage.kind === "multiple" ? usage.baseName : plan.name,
          });
        }
        return usage.kind === "unlimited"
          ? t("plans.unlimitedUsage")
          : usage.kind === "base"
            ? t("plans.baseUsage")
            : t("plans.relativeUsage", { multiplier: String(usage.multiplier), base: usage.baseName });
      }
      case "dailyRequests": {
        if (!plan.dailyRequestLimit) return null;
        const value = plan.dailyRequestLimit.toLocaleString();
        return override ? fillFeatureTemplate(override, { value }) : t("plans.dailyRequests", { count: value });
      }
      case "requestsPerMinute": {
        if (!plan.requestsPerMinute) return null;
        const value = plan.requestsPerMinute.toLocaleString();
        return override ? fillFeatureTemplate(override, { value }) : t("plans.rateLimit", { count: value });
      }
    }
  };
  return (
    <div
      className={cn(
        "relative flex flex-col justify-between p-6 sm:p-7 rounded-2xl transition-all duration-300 border h-full",
        isPopular
          ? "bg-[var(--panel-elevated)] border-white/25 shadow-2xl ring-1 ring-white/10 lg:-translate-y-1.5"
          : "bg-[var(--panel)] border-[var(--border)] hover:border-white/20"
      )}
    >
      {/* Top Section: Badges, Header, Price & Action CTA */}
      <div>
        {/* Uniform Badge Bar (keeps titles aligned across all cards) */}
        <div className="flex items-center justify-between min-h-[28px] mb-4 gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            {isPopular ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-white/10 text-[var(--ink)] border border-white/15 shadow-sm">
                <Sparkles className="w-3.5 h-3.5 text-[var(--accent)]" />
                {t("plans.popular")}
              </span>
            ) : plan.badge && plan.badge.toLowerCase() !== "free" ? (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-white/[0.05] text-[var(--muted)] border border-white/10">
                {plan.badge}
              </span>
            ) : null}

            {/* Discount Badge Pill if applicable */}
            {hasDiscount && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                {billingCycle === "yearly" && plan.discountYearlyType === "percent" && plan.discountYearlyValue
                  ? t("plans.savePercentBadge", { percent: plan.discountYearlyValue })
                  : billingCycle === "monthly" && plan.discountMonthlyType === "percent" && plan.discountMonthlyValue
                  ? t("plans.savePercentBadge", { percent: plan.discountMonthlyValue })
                  : t("plans.specialDiscount")}
              </span>
            )}
          </div>

          <div>
            {isCurrentPlan && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                <Check className="w-3 h-3" />
                {t("plans.currentPlan")}
              </span>
            )}
          </div>
        </div>

        {/* Plan Header */}
        <h3 className="text-2xl font-bold text-[var(--ink)] tracking-tight">
          {plan.name}
        </h3>
        <p className="text-xs text-[var(--muted)] mt-1.5 min-h-[36px] line-clamp-2 leading-relaxed">
          {plan.description || (isFree ? t("plans.defaultFreeDescription") : t("plans.defaultPaidDescription"))}
        </p>

        {/* Price Display */}
        <div className="mt-5 pb-5 border-b border-[var(--border)]">
          {isFree ? (
            <div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl lg:text-4xl font-extrabold text-[var(--ink)] tracking-tight">Rp 0</span>
                <span className="text-xs text-[var(--placeholder)]">{t("plans.perMonth")}</span>
              </div>
              <div className="min-h-[22px] mt-1.5 flex items-center">
                <span className="text-xs text-[var(--muted)]">{t("plans.freeForever")}</span>
              </div>
              <p className="text-xs text-[var(--placeholder)] mt-1.5 min-h-[20px]">
                {t("plans.freeForeverSubtitle")}
              </p>
            </div>
          ) : billingCycle === "monthly" ? (
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl lg:text-4xl font-extrabold text-[var(--ink)] tracking-tight">
                  {formatRupiah(effectivePrice)}
                </span>
                <span className="text-xs text-[var(--placeholder)]">{t("plans.perMonth")}</span>
              </div>
              <div className="min-h-[22px] mt-1.5 flex items-center gap-2 flex-wrap">
                {hasDiscount ? (
                  <>
                    <span className="text-xs line-through text-[var(--placeholder)]">
                      {formatRupiah(basePrice)}
                    </span>
                    <span className="text-[11px] font-semibold text-emerald-400">
                      {plan.discountMonthlyType === "percent" && plan.discountMonthlyValue
                        ? t("plans.discountPercentWithSave", {
                            percent: plan.discountMonthlyValue,
                            amount: formatRupiah(basePrice - effectivePrice),
                          })
                        : t("plans.saveAmount", {
                            amount: formatRupiah(basePrice - effectivePrice),
                          })}
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-[var(--muted)]">{t("plans.billedMonthly")}</span>
                )}
              </div>
              <p className="text-xs text-[var(--muted)] mt-1.5 min-h-[20px]">
                {t("plans.monthlySubNoCommitment")}
              </p>
            </div>
          ) : (
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl lg:text-4xl font-extrabold text-[var(--ink)] tracking-tight">
                  {formatRupiah(monthlyEquivalentYearly)}
                </span>
                <span className="text-xs text-[var(--placeholder)]">{t("plans.perMonth")}</span>
              </div>
              <div className="min-h-[22px] mt-1.5 flex items-center gap-2 flex-wrap">
                {hasDiscount ? (
                  <>
                    <span className="text-xs line-through text-[var(--placeholder)]">
                      {formatRupiah(baseMonthlyEquivalentYearly)}
                    </span>
                    <span className="text-[11px] font-semibold text-emerald-400">
                      {plan.discountYearlyType === "percent" && plan.discountYearlyValue
                        ? t("plans.discountPercentWithSave", {
                            percent: plan.discountYearlyValue,
                            amount: formatRupiah(basePrice - effectivePrice),
                          })
                        : t("plans.saveAmount", {
                            amount: formatRupiah(basePrice - effectivePrice),
                          })}
                    </span>
                  </>
                ) : plan.priceYearly < plan.priceMonthly * 12 ? (
                  <span className="text-[11px] font-semibold text-emerald-400">
                    {t("plans.saveTwoMonths")}
                  </span>
                ) : (
                  <span className="text-xs text-[var(--muted)]">{t("plans.billedAnnually")}</span>
                )}
              </div>
              <p className="text-xs text-[var(--muted)] mt-1.5 min-h-[20px] flex items-center gap-1.5 flex-wrap">
                <span>{t("plans.billedYearlyLabel")}</span>
                {hasDiscount ? (
                  <>
                    <span className="line-through text-[var(--placeholder)]">
                      {formatRupiah(basePrice)}
                    </span>
                    <span className="font-semibold text-[var(--ink)]">
                      {formatRupiah(effectivePrice)}{t("plans.perYear")}
                    </span>
                  </>
                ) : (
                  <span className="font-semibold text-[var(--ink)]">
                    {formatRupiah(effectivePrice)}{t("plans.perYear")}
                  </span>
                )}
              </p>
            </div>
          )}

          {/* Action CTA Button */}
          <div className="mt-5">
            {isCurrentPlan ? (
              <Button
                variant="outline"
                className="w-full text-xs h-10 opacity-60 cursor-default"
                disabled
              >
                {t("plans.activePlan")}
              </Button>
            ) : isFree ? (
              <Button
                variant="outline"
                className="w-full text-xs h-10 font-semibold"
                onClick={() => onSelect(plan)}
              >
                {t("plans.choosePlan")}
              </Button>
            ) : isPopular ? (
              <Button
                variant="primary"
                className="w-full text-xs h-10 font-semibold shadow-md"
                onClick={() => onSelect(plan)}
              >
                {t("plans.upgradeNow", { name: plan.name })}
              </Button>
            ) : (
              <Button
                variant="secondary"
                className="w-full text-xs h-10 font-semibold border-white/15 hover:border-white/25"
                onClick={() => onSelect(plan)}
              >
                {t("plans.upgradeNow", { name: plan.name })}
              </Button>
            )}
          </div>
        </div>

        {/* Quotas & Limits */}
        <div className="mt-5 space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--placeholder)]">
            {t("plans.featuresTitle")}
          </p>

          <ul className="space-y-2.5 text-xs text-[var(--ink)]">
            {normalizePlanFeatures(plan.features).map((feature) => {
              const text = featureText(feature);
              if (!text) return null;
              return (
                <li key={feature.id} className="flex items-center gap-2.5">
                  <LucideIcon name={feature.icon} className="w-4 h-4 text-[var(--accent)] shrink-0" />
                  <span>{text}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Supported Models Section (pinned to bottom) */}
      {plan.models.length > 0 && (
        <div className="mt-6 pt-5 border-t border-[var(--border)]">
          <p className="text-[11px] font-semibold text-[var(--placeholder)] mb-2.5">
            {t("plans.modelsIncluded")} ({plan.models.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {plan.models.map((m) => (
              <span
                key={m.id}
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-1 rounded-[6px] text-[11px] font-medium border",
                  m.category.toLowerCase() === "powerful" || m.category.toLowerCase() === "flagship"
                    ? "bg-white/[0.08] text-[var(--ink)] border-white/20 shadow-sm"
                    : "bg-white/[0.03] text-[var(--muted)] border-white/5"
                )}
              >
                {(m.category.toLowerCase() === "powerful" || m.category.toLowerCase() === "flagship") && (
                  <Sparkles className="w-3 h-3 text-[var(--accent)] shrink-0" />
                )}
                {m.shortName || m.displayName}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
