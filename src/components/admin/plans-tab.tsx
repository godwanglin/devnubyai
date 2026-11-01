"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Pencil, Trash2, RefreshCw, Users, Layers3 } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { dispatchModelsInvalidated } from "@/providers/account-provider";
import { cn } from "@/lib/cn";
import { PlanModal, type AdminPlan } from "@/components/admin/plan-modal";
import { ConfirmModal } from "@/components/modals/confirm-modal";
import { Button } from "@/components/ui/button";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

function formatNumber(value: number | null) {
  if (value == null) return "∞";
  return new Intl.NumberFormat("id-ID").format(value);
}

function PriceLine({
  currency,
  base,
  effective,
  discountType,
  discountValue,
  suffix,
}: {
  currency: string;
  base: number;
  effective: number;
  discountType: AdminPlan["discountMonthlyType"];
  discountValue: number | null;
  suffix: string;
}) {
  const fmt = (v: number) => new Intl.NumberFormat("id-ID").format(v);
  const discounted = effective < base;

  return (
    <div className="text-xs">
      <div className="flex items-center gap-1.5">
        <span className={cn("font-semibold", discounted ? "text-emerald-600 dark:text-emerald-400" : "text-[var(--ink)]")}>
          {currency} {fmt(effective)}
          <span className="font-normal text-[var(--muted)]"> {suffix}</span>
        </span>
        {discounted && discountType && discountValue != null && (
          <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
            {discountType === "percent" ? `${discountValue}% OFF` : `-${fmt(discountValue)}`}
          </span>
        )}
      </div>
      {discounted && (
        <div className="text-[var(--muted)] line-through">
          {currency} {fmt(base)} {suffix}
        </div>
      )}
    </div>
  );
}

export function PlansTab() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalPlan, setModalPlan] = useState<AdminPlan | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<AdminPlan | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Pagination state (default 10)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const loadPlans = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/admin/plans", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Failed to load plans");
      setPlans(payload.data?.plans ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load plans");
    } finally {
      setLoading(false);
    }
  }, []);

  const hasLoadedRef = useRef(false);
  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    void loadPlans();
  }, [loadPlans]);

  const sortedPlans = useMemo(
    () => [...plans].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)),
    [plans]
  );

  const displayedPlans = useMemo(
    () => sortedPlans.slice((page - 1) * pageSize, page * pageSize),
    [sortedPlans, page, pageSize]
  );

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/v1/admin/plans/${deleteTarget.id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Failed to delete plan");
      setPlans((current) => current.filter((item) => item.id !== deleteTarget.id));
      toast(t("admin.plans.deleteSuccess"));
      dispatchModelsInvalidated();
      setDeleteTarget(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to delete plan");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink)]">{t("admin.plans.title")}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{t("admin.plans.description")}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void loadPlans()}
            disabled={loading}
          >
            <RefreshCw className={cn("h-4 w-4 mr-1.5", loading && "animate-spin")} />
            {t("admin.plans.refresh")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setModalPlan(null)}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            {t("admin.plans.add")}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-[8px] border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--panel)] shadow-xs">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-xs uppercase tracking-wider text-[var(--muted)]">
              <th className="px-4 py-3">{t("admin.plans.plan")}</th>
              <th className="px-4 py-3">{t("admin.plans.price")}</th>
              <th className="px-4 py-3">{t("admin.plans.quotas")}</th>
              <th className="px-4 py-3">{t("admin.plans.access")}</th>
              <th className="px-4 py-3">{t("admin.plans.status")}</th>
              <th className="px-4 py-3 text-right">{t("admin.plans.actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {loading && plans.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-[var(--muted)]">
                  {t("admin.plans.loading")}
                </td>
              </tr>
            ) : displayedPlans.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-[var(--muted)]">
                  {t("admin.plans.empty")}
                </td>
              </tr>
            ) : (
              displayedPlans.map((plan) => (
                <tr key={plan.id} className="hover:bg-[var(--hover)] transition-colors">
                  <td className="px-4 py-4 align-top">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[var(--ink)]">{plan.name}</span>
                      {plan.badge && (
                        <span className="rounded-full bg-[var(--primary)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--primary)]">
                          {plan.badge}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--muted)] font-mono">{plan.slug}</div>
                    {plan.description && (
                      <div className="mt-1 line-clamp-2 text-xs text-[var(--muted)]">
                        {plan.description}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-4 align-top space-y-1.5">
                    <PriceLine
                      currency={plan.currency}
                      base={plan.priceMonthly}
                      effective={plan.effectivePriceMonthly}
                      discountType={plan.discountMonthlyType}
                      discountValue={plan.discountMonthlyValue}
                      suffix="/ mo"
                    />
                    <PriceLine
                      currency={plan.currency}
                      base={plan.priceYearly}
                      effective={plan.effectivePriceYearly}
                      discountType={plan.discountYearlyType}
                      discountValue={plan.discountYearlyValue}
                      suffix="/ yr"
                    />
                  </td>
                  <td className="px-4 py-4 align-top text-xs text-[var(--muted)]">
                    <div>
                      <b className="font-medium text-[var(--ink)]">{formatNumber(plan.monthlyTokenLimit)}</b> / mo
                    </div>
                    <div className="mt-1">
                      <b className="font-medium text-[var(--ink)]">{formatNumber(plan.weeklyTokenLimit)}</b> / wk
                    </div>
                    <div className="mt-1">
                      <b className="font-medium text-[var(--ink)]">{formatNumber(plan.fiveHourTokenLimit)}</b> / 5h
                    </div>
                  </td>
                  <td className="px-4 py-4 align-top text-xs text-[var(--muted)]">
                    <div className="inline-flex items-center gap-1.5">
                      <Layers3 className="h-3.5 w-3.5" />
                      {plan.allowedModelIds.length} {t("admin.plans.models")}
                    </div>
                    <div className="mt-1 inline-flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5" />
                      {plan.userCount} {t("admin.plans.users")}
                    </div>
                  </td>
                  <td className="px-4 py-4 align-top">
                    <span
                      className={cn(
                        "rounded-full px-2 py-1 text-xs font-medium",
                        plan.isActive
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          : "bg-[var(--hover)] text-[var(--muted)]"
                      )}
                    >
                      {plan.isActive ? t("admin.plans.active") : t("admin.plans.inactive")}
                    </span>
                  </td>
                  <td className="px-4 py-4 align-top">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setModalPlan(plan)}
                        className="h-8 w-8 p-0"
                        title={t("admin.plans.edit")}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(plan)}
                        className="h-8 w-8 p-0 text-[var(--muted)] hover:text-red-500 hover:bg-red-500/10"
                        title={t("admin.plans.delete")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <DataTablePagination
          page={page}
          pageSize={pageSize}
          totalItems={sortedPlans.length}
          onPageChange={setPage}
          onPageSizeChange={(newSize) => {
            setPageSize(newSize);
            setPage(1);
          }}
          disabled={loading}
        />
      </div>

      {modalPlan !== undefined && (
        <PlanModal
          plan={modalPlan}
          onClose={() => setModalPlan(undefined)}
          onSaved={(plan) => {
            setPlans((current) => {
              const index = current.findIndex((item) => item.id === plan.id);
              if (index < 0) return [...current, plan];
              const next = [...current];
              next[index] = plan;
              return next;
            });
            setModalPlan(undefined);
            dispatchModelsInvalidated();
          }}
        />
      )}

      <ConfirmModal
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title={t("admin.plans.deleteConfirmTitle")}
        description={
          deleteTarget
            ? `${t("admin.plans.deleteConfirm")} ${deleteTarget.name}?`
            : undefined
        }
        confirmLabel={t("admin.plans.delete")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        loading={isDeleting}
      />
    </div>
  );
}
