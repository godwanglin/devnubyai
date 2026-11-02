"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n-provider";
import { CustomSelect } from "@/components/ui/custom-select";
import { applyPlanDiscount, validatePlanDiscount, type PlanDiscountType } from "@/lib/plans/pricing";
import { parseCostLimit, parseCountLimit, validateCostLimits } from "@/lib/plans/cost-limits";
import { hasAnyText, normalizePlanFeatures, type PlanFeature } from "@/lib/plans/features";
import { PlanFeaturesEditor } from "./plan-features-editor";
import { PlanAllowedModelsPicker, type ModelItem } from "./plan-allowed-models-picker";

export interface AdminPlan {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  discountMonthlyType: PlanDiscountType | null;
  discountMonthlyValue: number | null;
  discountYearlyType: PlanDiscountType | null;
  discountYearlyValue: number | null;
  effectivePriceMonthly: number;
  effectivePriceYearly: number;
  monthlyCostLimitUsd: number | null;
  weeklyCostLimitUsd: number | null;
  fiveHourCostLimitUsd: number | null;
  features: PlanFeature[];
  dailyRequestLimit: number | null;
  requestsPerMinute: number | null;
  dailyUploadLimitMb: number | null;
  dailyAgentUploadLimitMb: number | null;
  badge: string | null;
  isActive: boolean;
  sortOrder: number;
  userCount: number;
  allowedModelIds: string[];
}

interface PlanModalProps {
  plan: AdminPlan | null;
  onClose: () => void;
  onSaved: (plan: AdminPlan) => void;
}

function parseDiscount(typeRaw: string, valRaw: string): { discountType: PlanDiscountType | null; discountValue: number | null } {
  const type: PlanDiscountType | null =
    typeRaw === "percent" || typeRaw === "flat" ? typeRaw : null;
  const val = valRaw.trim() !== "" ? Number(valRaw) : null;
  return {
    discountType: type,
    discountValue: val != null && !Number.isNaN(val) ? val : null,
  };
}

export function PlanModal({ plan, onClose, onSaved }: PlanModalProps) {
  const { t } = useI18n();
  const [slug, setSlug] = useState(plan?.slug ?? "");
  const [name, setName] = useState(plan?.name ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [priceMonthly, setPriceMonthly] = useState(plan?.priceMonthly ?? 0);
  const [priceYearly, setPriceYearly] = useState(plan?.priceYearly ?? 0);
  const [currency, setCurrency] = useState(plan?.currency ?? "IDR");
  const [monthlyDiscType, setMonthlyDiscType] = useState<string>(plan?.discountMonthlyType ?? "none");
  const [monthlyDiscValue, setMonthlyDiscValue] = useState<string>(
    plan?.discountMonthlyValue != null ? String(plan.discountMonthlyValue) : ""
  );
  const [yearlyDiscType, setYearlyDiscType] = useState<string>(plan?.discountYearlyType ?? "none");
  const [yearlyDiscValue, setYearlyDiscValue] = useState<string>(
    plan?.discountYearlyValue != null ? String(plan.discountYearlyValue) : ""
  );
  const [monthlyCostLimit, setMonthlyCostLimit] = useState<string>(
    plan?.monthlyCostLimitUsd != null ? String(plan.monthlyCostLimitUsd) : ""
  );
  const [weeklyCostLimit, setWeeklyCostLimit] = useState<string>(
    plan?.weeklyCostLimitUsd != null ? String(plan.weeklyCostLimitUsd) : ""
  );
  const [fiveHourCostLimit, setFiveHourCostLimit] = useState<string>(
    plan?.fiveHourCostLimitUsd != null ? String(plan.fiveHourCostLimitUsd) : ""
  );
  const [dailyRequestLimit, setDailyRequestLimit] = useState<string>(
    plan?.dailyRequestLimit != null ? String(plan.dailyRequestLimit) : ""
  );
  const [requestsPerMinute, setRequestsPerMinute] = useState<string>(
    plan?.requestsPerMinute != null ? String(plan.requestsPerMinute) : ""
  );
  const [uploadLimitMb, setUploadLimitMb] = useState<string>(plan?.dailyUploadLimitMb != null ? String(plan.dailyUploadLimitMb) : "");
  const [agentUploadLimitMb, setAgentUploadLimitMb] = useState<string>(
    plan?.dailyAgentUploadLimitMb != null ? String(plan.dailyAgentUploadLimitMb) : ""
  );
  const [features, setFeatures] = useState<PlanFeature[]>(() => normalizePlanFeatures(plan?.features));
  const [badge, setBadge] = useState(plan?.badge ?? "");
  const [sortOrder, setSortOrder] = useState(plan?.sortOrder ?? 100);
  const [isActive, setIsActive] = useState(plan?.isActive ?? true);
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>(plan?.allowedModelIds ?? []);
  const [allModels, setAllModels] = useState<ModelItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchModels() {
      try {
        const res = await fetch("/api/v1/admin/model-catalog");
        const json = await res.json();
        if (json.data?.models) {
          setAllModels(json.data.models);
        }
      } catch (err) {
        console.error("Failed to fetch models", err);
      }
    }
    void fetchModels();
  }, []);

  const monthlyDiscount = useMemo(
    () => parseDiscount(monthlyDiscType, monthlyDiscValue),
    [monthlyDiscType, monthlyDiscValue]
  );
  const yearlyDiscount = useMemo(
    () => parseDiscount(yearlyDiscType, yearlyDiscValue),
    [yearlyDiscType, yearlyDiscValue]
  );
  const monthlyDiscountError = validatePlanDiscount(monthlyDiscount, Number(priceMonthly) || 0, "monthly");
  const yearlyDiscountError = validatePlanDiscount(yearlyDiscount, Number(priceYearly) || 0, "yearly");
  const costLimitError = validateCostLimits({
    monthly: parseCostLimit(monthlyCostLimit),
    weekly: parseCostLimit(weeklyCostLimit),
    fiveHour: parseCostLimit(fiveHourCostLimit),
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const discountError = monthlyDiscountError ?? yearlyDiscountError ?? costLimitError;
    if (discountError) {
      setError(discountError);
      setSaving(false);
      return;
    }

    const payload = {
      slug: slug.trim(),
      name: name.trim(),
      description: description.trim() || null,
      priceMonthly: Number(priceMonthly) || 0,
      priceYearly: Number(priceYearly) || 0,
      currency: currency.trim() || "IDR",
      discountMonthlyType: monthlyDiscount.discountType,
      discountMonthlyValue: monthlyDiscount.discountValue,
      discountYearlyType: yearlyDiscount.discountType,
      discountYearlyValue: yearlyDiscount.discountValue,
      monthlyCostLimitUsd: parseCostLimit(monthlyCostLimit),
      weeklyCostLimitUsd: parseCostLimit(weeklyCostLimit),
      fiveHourCostLimitUsd: parseCostLimit(fiveHourCostLimit),
      dailyRequestLimit: parseCountLimit(dailyRequestLimit),
      requestsPerMinute: parseCountLimit(requestsPerMinute),
      dailyUploadLimitMb: parseCountLimit(uploadLimitMb),
      dailyAgentUploadLimitMb: parseCountLimit(agentUploadLimitMb),
      // Manual rows left without any text are dropped instead of saved empty
      features: features.filter((f) => f.type === "auto" || hasAnyText(f.text)),
      badge: badge.trim() || null,
      sortOrder: Number(sortOrder) || 100,
      isActive,
      allowedModelIds: selectedModelIds,
    };

    try {
      const url = plan ? `/api/v1/admin/plans/${plan.id}` : "/api/v1/admin/plans";
      const method = plan ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to save plan");
      onSaved(data.data.plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save plan");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={plan ? t("admin.plans.editTitle") : t("admin.plans.createTitle")}
      maxWidth="xl"
    >
      <form onSubmit={handleSubmit} className="flex flex-1 flex-col max-h-[75vh] overflow-y-auto pr-1 space-y-4">
          {error && (
            <div className="rounded-[8px] border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[var(--muted)]">Slug</label>
              <input
                type="text"
                required
                disabled={Boolean(plan && plan.slug === "free")}
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="e.g. pro"
                className="mt-1 h-9 w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--muted)]">Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Pro Plan"
                className="mt-1 h-9 w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--primary)]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--muted)]">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. For professional developers"
              className="mt-1 h-9 w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--primary)]"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--muted)]">Monthly Price</label>
              <input
                type="number"
                min="0"
                value={priceMonthly}
                onChange={(e) => setPriceMonthly(Number(e.target.value))}
                className="mt-1 h-9 w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--muted)]">Yearly Price</label>
              <input
                type="number"
                min="0"
                value={priceYearly}
                onChange={(e) => setPriceYearly(Number(e.target.value))}
                className="mt-1 h-9 w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--muted)]">Currency</label>
              <input
                type="text"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="mt-1 h-9 w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--primary)]"
              />
            </div>
          </div>

          {/* Monthly Discount */}
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--panel-elevated)] p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--ink)]">
                {t("admin.plans.discountMonthly")}
              </span>
              {monthlyDiscount.discountType && (
                <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  {monthlyDiscount.discountType === "percent"
                    ? `${monthlyDiscount.discountValue ?? 0}% OFF`
                    : `-${currency} ${new Intl.NumberFormat("id-ID").format(monthlyDiscount.discountValue ?? 0)}`}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                  Type
                </label>
                <CustomSelect
                  options={[
                    { value: "none", label: t("admin.plans.discountNone") },
                    { value: "percent", label: t("admin.plans.discountPercent") },
                    { value: "flat", label: `${t("admin.plans.discountFlat")} (${currency})` },
                  ]}
                  value={monthlyDiscType}
                  onChange={(val) => {
                    setMonthlyDiscType(val);
                    if (val === "none") setMonthlyDiscValue("");
                  }}
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                  {monthlyDiscType === "percent"
                    ? "Percentage (0 - 100%)"
                    : monthlyDiscType === "flat"
                    ? `Flat Amount (${currency})`
                    : "Value"}
                </label>
                <input
                  type="number"
                  min="0"
                  max={monthlyDiscType === "percent" ? "100" : undefined}
                  disabled={monthlyDiscType === "none"}
                  value={monthlyDiscValue}
                  onChange={(e) => setMonthlyDiscValue(e.target.value)}
                  placeholder={monthlyDiscType === "percent" ? "e.g. 20" : monthlyDiscType === "flat" ? "e.g. 50000" : "-"}
                  className="h-9 w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--primary)] disabled:opacity-50"
                />
              </div>
            </div>

            {monthlyDiscountError && (
              <p className="text-[11px] text-red-500 font-medium">{monthlyDiscountError}</p>
            )}

            <div className="flex items-center justify-between border-t border-[var(--border)]/60 pt-2 text-xs">
              <span className="text-[var(--muted)]">{t("admin.plans.effectivePrice")} (Monthly):</span>
              <span className="font-semibold text-[var(--ink)]">
                {currency} {new Intl.NumberFormat("id-ID").format(applyPlanDiscount(Number(priceMonthly) || 0, monthlyDiscount))}/mo
              </span>
            </div>
          </div>

          {/* Yearly Discount */}
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--panel-elevated)] p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--ink)]">
                {t("admin.plans.discountYearly")}
              </span>
              {yearlyDiscount.discountType && (
                <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  {yearlyDiscount.discountType === "percent"
                    ? `${yearlyDiscount.discountValue ?? 0}% OFF`
                    : `-${currency} ${new Intl.NumberFormat("id-ID").format(yearlyDiscount.discountValue ?? 0)}`}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                  Type
                </label>
                <CustomSelect
                  options={[
                    { value: "none", label: t("admin.plans.discountNone") },
                    { value: "percent", label: t("admin.plans.discountPercent") },
                    { value: "flat", label: `${t("admin.plans.discountFlat")} (${currency})` },
                  ]}
                  value={yearlyDiscType}
                  onChange={(val) => {
                    setYearlyDiscType(val);
                    if (val === "none") setYearlyDiscValue("");
                  }}
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                  {yearlyDiscType === "percent"
                    ? "Percentage (0 - 100%)"
                    : yearlyDiscType === "flat"
                    ? `Flat Amount (${currency})`
                    : "Value"}
                </label>
                <input
                  type="number"
                  min="0"
                  max={yearlyDiscType === "percent" ? "100" : undefined}
                  disabled={yearlyDiscType === "none"}
                  value={yearlyDiscValue}
                  onChange={(e) => setYearlyDiscValue(e.target.value)}
                  placeholder={yearlyDiscType === "percent" ? "e.g. 20" : yearlyDiscType === "flat" ? "e.g. 200000" : "-"}
                  className="h-9 w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--primary)] disabled:opacity-50"
                />
              </div>
            </div>

            {yearlyDiscountError && (
              <p className="text-[11px] text-red-500 font-medium">{yearlyDiscountError}</p>
            )}

            <div className="flex items-center justify-between border-t border-[var(--border)]/60 pt-2 text-xs">
              <span className="text-[var(--muted)]">{t("admin.plans.effectivePrice")} (Yearly):</span>
              <span className="font-semibold text-[var(--ink)]">
                {currency} {new Intl.NumberFormat("id-ID").format(applyPlanDiscount(Number(priceYearly) || 0, yearlyDiscount))}/yr
              </span>
            </div>
          </div>

          <div className="border-t border-[var(--border)] pt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
              {t("admin.plans.usageLimitsTitle")}
            </h4>
            <p className="mt-1 text-[11px] text-[var(--muted)]">{t("admin.plans.usageLimitsHint")}</p>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {(
                [
                  ["monthly", t("admin.plans.limitMonthly"), monthlyCostLimit, setMonthlyCostLimit, "5.00"],
                  ["weekly", t("admin.plans.limitWeekly"), weeklyCostLimit, setWeeklyCostLimit, "1.50"],
                  ["fiveHour", t("admin.plans.limitFiveHour"), fiveHourCostLimit, setFiveHourCostLimit, "0.40"],
                ] as const
              ).map(([key, label, value, setValue, example]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-[var(--muted)]">{label}</label>
                  <div className="relative mt-1">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--muted)]">
                      $
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      placeholder={example}
                      className="h-9 w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] pl-6 pr-3 text-sm text-[var(--ink)] tabular-nums outline-none focus:border-[var(--primary)]"
                    />
                  </div>
                </div>
              ))}
            </div>
            {costLimitError ? (
              <p className="mt-2 text-[11px] text-red-500">{costLimitError}</p>
            ) : null}

            <div className="mt-3 grid grid-cols-2 gap-3">
              {(
                [
                  ["daily", t("admin.plans.limitDailyRequests"), dailyRequestLimit, setDailyRequestLimit, "200"],
                  ["rpm", t("admin.plans.limitRequestsPerMinute"), requestsPerMinute, setRequestsPerMinute, "20"],
                  ["upload", t("admin.plans.limitUploadMb"), uploadLimitMb, setUploadLimitMb, "50"],
                  ["agentUpload", t("admin.plans.limitAgentUploadMb"), agentUploadLimitMb, setAgentUploadLimitMb, "100"],
                ] as const
              ).map(([key, label, value, setValue, example]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-[var(--muted)]">{label}</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={example}
                    className="mt-1 h-9 w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] tabular-nums outline-none focus:border-[var(--primary)]"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-[var(--border)] pt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
              {t("admin.plans.featuresTitle")}
            </h4>
            <p className="mt-1 mb-3 text-[11px] text-[var(--muted)]">{t("admin.plans.featuresHint")}</p>
            <PlanFeaturesEditor features={features} onChange={setFeatures} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--muted)]">Badge</label>
              <input
                type="text"
                value={badge}
                onChange={(e) => setBadge(e.target.value)}
                placeholder="e.g. Popular"
                className="mt-1 h-9 w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--muted)]">Sort Order</label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
                className="mt-1 h-9 w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <input
                type="checkbox"
                id="isActive"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded accent-[var(--primary)]"
              />
              <label htmlFor="isActive" className="text-xs font-medium text-[var(--ink)] cursor-pointer">
                Active Plan
              </label>
            </div>
          </div>

          <PlanAllowedModelsPicker
            allModels={allModels}
            selectedModelIds={selectedModelIds}
            onChange={setSelectedModelIds}
          />

          <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={saving}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={saving}
            >
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </form>
      </Modal>
    );
}
