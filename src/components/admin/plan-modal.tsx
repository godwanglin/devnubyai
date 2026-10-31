"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Check } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import { cn } from "@/lib/cn";
import { CustomSelect } from "@/components/ui/custom-select";
import { applyPlanDiscount, validatePlanDiscount, type PlanDiscountType } from "@/lib/plans/pricing";

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
  monthlyTokenLimit: number | null;
  weeklyTokenLimit: number | null;
  fiveHourTokenLimit: number | null;
  dailyRequestLimit: number | null;
  requestsPerMinute: number | null;
  badge: string | null;
  isActive: boolean;
  sortOrder: number;
  userCount: number;
  allowedModelIds: string[];
}

interface ModelItem {
  id: string;
  publicId: string;
  displayName: string;
  category: string;
  provider: { name: string };
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
  const [monthlyTokenLimit, setMonthlyTokenLimit] = useState<string>(
    plan?.monthlyTokenLimit != null ? String(plan.monthlyTokenLimit) : ""
  );
  const [weeklyTokenLimit, setWeeklyTokenLimit] = useState<string>(
    plan?.weeklyTokenLimit != null ? String(plan.weeklyTokenLimit) : ""
  );
  const [fiveHourTokenLimit, setFiveHourTokenLimit] = useState<string>(
    plan?.fiveHourTokenLimit != null ? String(plan.fiveHourTokenLimit) : ""
  );
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

  function toggleModel(id: string) {
    setSelectedModelIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  function selectAllModels() {
    setSelectedModelIds(allModels.map((m) => m.id));
  }

  function clearAllModels() {
    setSelectedModelIds([]);
  }

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const discountError = monthlyDiscountError ?? yearlyDiscountError;
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
      monthlyTokenLimit: monthlyTokenLimit.trim() ? Number(monthlyTokenLimit) : null,
      weeklyTokenLimit: weeklyTokenLimit.trim() ? Number(weeklyTokenLimit) : null,
      fiveHourTokenLimit: fiveHourTokenLimit.trim() ? Number(fiveHourTokenLimit) : null,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-[16px] border border-[var(--border)] bg-[var(--panel)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <h3 className="text-base font-semibold text-[var(--ink)]">
            {plan ? t("admin.plans.editTitle") : t("admin.plans.createTitle")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] p-1.5 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-y-auto p-6 space-y-4">
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
              Token Limits (0 or empty = Unlimited)
            </h4>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--muted)]">Monthly Tokens</label>
                <input
                  type="number"
                  min="0"
                  value={monthlyTokenLimit}
                  onChange={(e) => setMonthlyTokenLimit(e.target.value)}
                  placeholder="e.g. 50000000"
                  className="mt-1 h-9 w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--primary)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--muted)]">Weekly Tokens</label>
                <input
                  type="number"
                  min="0"
                  value={weeklyTokenLimit}
                  onChange={(e) => setWeeklyTokenLimit(e.target.value)}
                  placeholder="e.g. 15000000"
                  className="mt-1 h-9 w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--primary)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--muted)]">5-Hour Tokens</label>
                <input
                  type="number"
                  min="0"
                  value={fiveHourTokenLimit}
                  onChange={(e) => setFiveHourTokenLimit(e.target.value)}
                  placeholder="e.g. 5000000"
                  className="mt-1 h-9 w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--primary)]"
                />
              </div>
            </div>
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

          <div className="border-t border-[var(--border)] pt-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Allowed Catalog Models ({selectedModelIds.length}/{allModels.length})
              </h4>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={selectAllModels}
                  className="text-xs text-[var(--primary)] hover:underline"
                >
                  Select All
                </button>
                <span className="text-xs text-[var(--muted)]">•</span>
                <button
                  type="button"
                  onClick={clearAllModels}
                  className="text-xs text-[var(--muted)] hover:underline"
                >
                  Clear All
                </button>
              </div>
            </div>

            <div className="mt-3 grid max-h-48 grid-cols-2 gap-2 overflow-y-auto rounded-[8px] border border-[var(--border)] p-3">
              {allModels.map((m) => {
                const selected = selectedModelIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleModel(m.id)}
                    className={cn(
                      "flex items-center justify-between rounded-[6px] border p-2 text-left text-xs transition-colors",
                      selected
                        ? "border-[var(--primary)] bg-[var(--primary)]/5 text-[var(--primary)]"
                        : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--muted)]"
                    )}
                  >
                    <div>
                      <div className="font-medium text-[var(--ink)]">{m.displayName}</div>
                      <div className="text-[10px] text-[var(--muted)] font-mono">{m.publicId}</div>
                    </div>
                    {selected && <Check className="h-4 w-4 shrink-0 text-[var(--primary)]" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-[var(--border)] pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="h-9 rounded-[8px] border border-[var(--border)] px-4 text-sm font-medium text-[var(--muted)] hover:bg-[var(--hover)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="h-9 rounded-[8px] bg-[var(--primary)] px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Plan"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
