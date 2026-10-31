"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { DevnubyWordmark } from "@/components/brand/devnuby-logo";
import { PlanCard } from "./plan-card";
import { PlanCheckoutModal } from "./plan-checkout-modal";
import { useI18n } from "@/providers/i18n-provider";
import { useAccount } from "@/providers/account-provider";
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
  }, []); // Run only once on mount

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

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)] flex flex-col selection:bg-[var(--accent)] selection:text-[var(--accent-text)]">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 w-full border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur-[12px]">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
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

          <div className="w-20 flex justify-end">
            {user && (
              <span className="text-[11px] font-medium text-[var(--placeholder)] truncate max-w-[120px]">
                {user.name}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-12 md:py-16 flex flex-col items-center">
        {/* Page Title & Subtitle */}
        <div className="text-center max-w-2xl mx-auto mb-10 space-y-3">
          <h1 className="text-3xl md:text-4xl font-extrabold text-[var(--ink)] tracking-tight">
            {t("plans.title")}
          </h1>
          <p className="text-sm md:text-base text-[var(--muted)] leading-relaxed">
            {t("plans.subtitle")}
          </p>
        </div>

        {/* Billing Cycle Switcher */}
        <div className="inline-flex items-center p-1 rounded-full bg-white/[0.04] border border-white/8 mb-10">
          <button
            type="button"
            onClick={() => setBillingCycle("monthly")}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
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
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
              billingCycle === "yearly"
                ? "bg-[var(--accent)] text-[var(--accent-text)] shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
          >
            <span>{t("plans.yearly")}</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
              {t("plans.savePercent", { percent: "33" })}
            </span>
          </button>
        </div>

        {/* Plans Grid */}
        {loadingPlans ? (
          <div className="py-20 flex flex-col items-center justify-center text-sm text-[var(--muted)] gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--accent)]" />
            <p>Memuat paket langganan...</p>
          </div>
        ) : plans.length === 0 ? (
          <div className="py-16 text-center text-xs text-[var(--muted)]">
            Belum ada paket langganan yang aktif.
          </div>
        ) : (
          <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
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
