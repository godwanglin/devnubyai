"use client";

import React from "react";
import Image from "next/image";
import { Check, Loader2 } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import type { PaymentMethodCategory, PaymentMethodItem } from "@/lib/payments/types";

const CATEGORY_ORDER: PaymentMethodCategory[] = [
  "qris",
  "ewallet",
  "virtual_account",
  "retail",
  "card",
];

interface PaymentMethodListProps {
  methods: PaymentMethodItem[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (method: PaymentMethodItem) => void;
}

/** Active payment methods grouped by category, as selectable rows */
export function PaymentMethodList({
  methods,
  selectedId,
  loading,
  onSelect,
}: PaymentMethodListProps) {
  const { t } = useI18n();

  const getCategoryLabel = (cat: PaymentMethodCategory): string => {
    switch (cat) {
      case "qris":
        return t("plans.categoryQris");
      case "virtual_account":
        return t("plans.categoryVirtualAccount");
      case "ewallet":
        return t("plans.categoryEwallet");
      case "retail":
        return t("plans.categoryRetail");
      case "card":
        return t("plans.categoryCard");
      default:
        return cat;
    }
  };

  if (loading) {
    return (
      <div className="py-6 flex items-center justify-center text-xs text-[var(--muted)]">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        {t("plans.loadingMethods")}
      </div>
    );
  }

  if (methods.length === 0) {
    return (
      <p className="text-xs text-[var(--muted)] p-3 border border-[var(--border)] rounded-[8px]">
        {t("plans.noActiveMethods")}
      </p>
    );
  }

  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    items: methods.filter((m) => m.category === category),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
      {groups.map((group) => (
        <div key={group.category} className="space-y-1.5">
          {groups.length > 1 && (
            <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--placeholder)]">
              {getCategoryLabel(group.category)}
            </p>
          )}
          {group.items.map((m) => {
            const isSelected = selectedId === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onSelect(m)}
                className={`flex items-center gap-3 w-full p-2.5 rounded-[10px] text-left border transition-all cursor-pointer ${
                  isSelected
                    ? "bg-[var(--panel-elevated)] border-[var(--accent)] text-[var(--ink)]"
                    : "bg-transparent border-[var(--border)] text-[var(--muted)] hover:border-white/20"
                }`}
              >
                {m.imageUrl && (
                  <div className="relative w-8 h-8 rounded-[6px] bg-white/[0.06] overflow-hidden flex items-center justify-center shrink-0 p-1">
                    <Image
                      src={m.imageUrl}
                      alt={m.name}
                      width={32}
                      height={32}
                      className="object-contain max-h-6"
                      unoptimized
                    />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[var(--ink)] truncate">{m.name}</p>
                  <p className="text-[10px] text-[var(--placeholder)] truncate">
                    {m.description || getCategoryLabel(m.category)}
                  </p>
                </div>
                {isSelected && (
                  <div className="w-4 h-4 rounded-full bg-[var(--accent)] text-[var(--accent-text)] grid place-items-center shrink-0">
                    <Check className="w-2.5 h-2.5" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
