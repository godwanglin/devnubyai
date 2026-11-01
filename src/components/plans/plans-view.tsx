"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Sparkles,
  ShieldCheck,
  Zap,
  RefreshCw,
  HelpCircle,
} from "lucide-react";
import { DevnubyWordmark } from "@/components/brand/devnuby-logo";
import { PlanCard } from "./plan-card";
import { PlanCheckoutModal } from "./plan-checkout-modal";
import { useI18n } from "@/providers/i18n-provider";
import { useAccount } from "@/providers/account-provider";
import { cn } from "@/lib/cn";
import type { PublicPlanItem } from "@/app/api/v1/plans/route";

interface PlansViewProps {
  initialPlans?: PublicPlanItem[];
}

const EMPTY_PLANS: PublicPlanItem[] = [];

export function PlansView({ initialPlans }: PlansViewProps) {
  const { t } = useI18n();
  const { user } = useAccount();
  const router = useRouter();

  const [plans, setPlans] = useState<PublicPlanItem[]>(initialPlans || EMPTY_PLANS);
  const [loadingPlans, setLoadingPlans] = useState(!initialPlans || initialPlans.length === 0);
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const [selectedPlanForCheckout, setSelectedPlanForCheckout] =
    useState<PublicPlanItem | null>(null);

  // Fetch plans once on mount if not provided initially
  useEffect(() => {
    if (initialPlans && initialPlans.length > 0) return;

    let mounted = true;

    fetch("/api/v1/plans")
      .then((res) => res.json())
      .then((json) => {
        if (!mounted) return;
        setPlans(json?.data?.plans || []);
      })
      .catch((err) => {
        console.error("Failed to load plans:", err);
      })
      .finally(() => {
        if (mounted) setLoadingPlans(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const handleSelectPlan = (plan: PublicPlanItem) => {
    if (!user) {
      router.push("/login?redirect=/plans");
      return;
    }

    if (plan.slug === "free") {
      router.push("/");
      return;
    }

    setSelectedPlanForCheckout(plan);
  };

  const currentPlanSlug = user?.plan || "free";

  // Calculate highest yearly savings percentage across plans
  const highestYearlySavings = plans.reduce((max, p) => {
    if (p.priceYearly <= 0) return max;
    if (p.discountYearlyType === "percent" && p.discountYearlyValue) {
      return Math.max(max, p.discountYearlyValue);
    }
    const regularAnnual = p.priceMonthly * 12;
    if (regularAnnual > 0 && p.effectivePriceYearly < regularAnnual) {
      const pct = Math.round(((regularAnnual - p.effectivePriceYearly) / regularAnnual) * 100);
      return Math.max(max, pct);
    }
    return max;
  }, 0);
  const savePercentText = highestYearlySavings > 0 ? `${highestYearlySavings}` : "33";

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)] flex flex-col selection:bg-[var(--accent)] selection:text-[var(--accent-text)] relative overflow-x-hidden">
      {/* Background Ambient Glow */}
      <div
        className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[720px] h-[360px] bg-gradient-to-b from-[var(--accent)]/10 via-[var(--accent)]/5 to-transparent blur-3xl opacity-60"
        aria-hidden="true"
      />

      {/* Top Navbar */}
      <header className="sticky top-0 z-40 w-full border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur-[12px]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{t("plans.backToChat")}</span>
          </Link>

          <Link href="/" className="flex items-center gap-2">
            <DevnubyWordmark className="h-4 w-auto text-[var(--ink)]" />
          </Link>

          <div className="w-24 flex justify-end">
            {user ? (
              <span className="text-[11px] font-medium text-[var(--placeholder)] truncate max-w-[120px]">
                {user.name}
              </span>
            ) : (
              <Link
                href="/login?redirect=/plans"
                className="text-xs font-semibold text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
              >
                {t("plans.signIn")}
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16 flex flex-col items-center relative z-10">
        {/* Page Title & Subtitle */}
        <div className="text-center max-w-3xl mx-auto mb-10 space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-white/[0.04] border border-white/10 text-[var(--muted)] mb-2 shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-[var(--accent)]" />
            <span>{t("plans.heroBadge")}</span>
          </div>

          <h1 className="text-3xl md:text-5xl font-extrabold text-[var(--ink)] tracking-tight">
            {t("plans.title")}
          </h1>
          <p className="text-sm md:text-base text-[var(--muted)] leading-relaxed max-w-2xl mx-auto">
            {t("plans.subtitle")}
          </p>
        </div>

        {/* Billing Cycle Switcher */}
        <div className="inline-flex items-center p-1 rounded-full bg-white/[0.04] border border-white/10 mb-12 shadow-inner">
          <button
            type="button"
            onClick={() => setBillingCycle("monthly")}
            className={`px-5 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer ${
              billingCycle === "monthly"
                ? "bg-[var(--accent)] text-[var(--accent-text)] shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
          >
            {t("plans.monthly")}
          </button>
          <button
            type="button"
            onClick={() => setBillingCycle("yearly")}
            className={`inline-flex items-center gap-2 px-5 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer ${
              billingCycle === "yearly"
                ? "bg-[var(--accent)] text-[var(--accent-text)] shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
          >
            <span>{t("plans.yearly")}</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
              {t("plans.savePercent", { percent: savePercentText })}
            </span>
          </button>
        </div>

        {/* Plans Grid (3 columns on PC: lg:grid-cols-3) */}
        {loadingPlans ? (
          <div className="py-24 flex flex-col items-center justify-center text-sm text-[var(--muted)] gap-3">
            <Loader2 className="w-7 h-7 animate-spin text-[var(--accent)]" />
            <p>{t("plans.loadingPlans")}</p>
          </div>
        ) : plans.length === 0 ? (
          <div className="py-16 text-center text-xs text-[var(--muted)]">
            {t("plans.emptyPlans")}
          </div>
        ) : (
          <div
            className={cn(
              "w-full grid gap-6 lg:gap-6 xl:gap-8 items-stretch mx-auto",
              plans.length === 1 && "max-w-md grid-cols-1",
              plans.length === 2 && "max-w-4xl grid-cols-1 md:grid-cols-2",
              plans.length >= 3 && "max-w-7xl grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
            )}
          >
            {plans.map((p) => {
              const isCurrent = user ? currentPlanSlug === p.slug : p.slug === "free";
              return (
                <PlanCard
                  key={p.id}
                  plan={p}
                  billingCycle={billingCycle}
                  isCurrentPlan={isCurrent}
                  onSelect={handleSelectPlan}
                />
              );
            })}
          </div>
        )}

        {/* Trust & Reassurance Badges */}
        <div className="w-full max-w-5xl mt-20 pt-12 border-t border-[var(--border)]">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="flex items-start gap-3.5 p-4 rounded-xl bg-white/[0.02] border border-white/5">
              <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
                <Zap className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-[var(--ink)]">{t("plans.trustInstantTitle")}</h4>
                <p className="text-xs text-[var(--muted)] mt-1 leading-relaxed">
                  {t("plans.trustInstantDesc")}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3.5 p-4 rounded-xl bg-white/[0.02] border border-white/5">
              <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-400 shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-[var(--ink)]">{t("plans.trustPaymentTitle")}</h4>
                <p className="text-xs text-[var(--muted)] mt-1 leading-relaxed">
                  {t("plans.trustPaymentDesc")}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3.5 p-4 rounded-xl bg-white/[0.02] border border-white/5">
              <div className="p-2.5 rounded-lg bg-purple-500/10 text-purple-400 shrink-0">
                <RefreshCw className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-[var(--ink)]">{t("plans.trustFlexibleTitle")}</h4>
                <p className="text-xs text-[var(--muted)] mt-1 leading-relaxed">
                  {t("plans.trustFlexibleDesc")}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Quick FAQ Section */}
        <div className="w-full max-w-4xl mt-16 space-y-6">
          <div className="text-center space-y-2 mb-8">
            <h3 className="text-xl md:text-2xl font-bold text-[var(--ink)]">
              {t("plans.faqTitle")}
            </h3>
            <p className="text-xs text-[var(--muted)]">
              {t("plans.faqSubtitle")}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-4 rounded-xl bg-[var(--panel)] border border-[var(--border)]">
              <h5 className="font-semibold text-[var(--ink)] mb-1.5 flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-[var(--accent)] shrink-0" />
                {t("plans.faq1Question")}
              </h5>
              <p className="text-[var(--muted)] leading-relaxed">
                {t("plans.faq1Answer")}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-[var(--panel)] border border-[var(--border)]">
              <h5 className="font-semibold text-[var(--ink)] mb-1.5 flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-[var(--accent)] shrink-0" />
                {t("plans.faq2Question")}
              </h5>
              <p className="text-[var(--muted)] leading-relaxed">
                {t("plans.faq2Answer")}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-[var(--panel)] border border-[var(--border)]">
              <h5 className="font-semibold text-[var(--ink)] mb-1.5 flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-[var(--accent)] shrink-0" />
                {t("plans.faq3Question")}
              </h5>
              <p className="text-[var(--muted)] leading-relaxed">
                {t("plans.faq3Answer")}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-[var(--panel)] border border-[var(--border)]">
              <h5 className="font-semibold text-[var(--ink)] mb-1.5 flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-[var(--accent)] shrink-0" />
                {t("plans.faq4Question")}
              </h5>
              <p className="text-[var(--muted)] leading-relaxed">
                {t("plans.faq4Answer")}
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Checkout Modal */}
      <PlanCheckoutModal
        isOpen={Boolean(selectedPlanForCheckout)}
        onClose={() => setSelectedPlanForCheckout(null)}
        plan={selectedPlanForCheckout}
        initialCycle={billingCycle}
      />
    </div>
  );
}
