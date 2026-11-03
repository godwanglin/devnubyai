"use client";

import React, { useState } from "react";
import { Phone, ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n-provider";
import { normalizeIndonesianPhone } from "@/lib/payments/phone";

interface PhoneRequiredFormProps {
  methodName: string;
  submitting: boolean;
  onSubmit: (phone: string) => void;
  onBack: () => void;
}

/**
 * Prompt shown when a selected payment method (e.g. DANA / ShopeePay) requires
 * an active mobile number that the user has not yet entered in their profile.
 */
export function PhoneRequiredForm({
  methodName,
  submitting,
  onSubmit,
  onBack,
}: PhoneRequiredFormProps) {
  const { t } = useI18n();
  const [phone, setPhone] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = normalizeIndonesianPhone(phone);
    if (!normalized) {
      setValidationError(t("plans.phoneInvalid"));
      return;
    }
    setValidationError(null);
    onSubmit(normalized);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 py-1">
      <div className="p-3.5 rounded-[12px] bg-amber-500/10 border border-amber-500/25 text-xs space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
            <Phone className="w-3.5 h-3.5" />
          </div>
          <div>
            <h4 className="font-semibold text-amber-400">{t("plans.phoneRequiredTitle")}</h4>
            <p className="text-[11px] text-[var(--muted)] leading-relaxed mt-0.5">
              {t("plans.phoneRequiredNotice")} ({methodName})
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-1.5 text-xs">
        <label htmlFor="customer_phone_input" className="block font-semibold text-[var(--ink)]">
          {t("plans.phoneLabel")} <span className="text-red-400">*</span>
        </label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[var(--muted)]">
            <Phone className="w-3.5 h-3.5" />
          </div>
          <input
            id="customer_phone_input"
            type="tel"
            autoFocus
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              if (validationError) setValidationError(null);
            }}
            placeholder={t("plans.phonePlaceholder")}
            disabled={submitting}
            className="w-full pl-9 pr-3 py-2.5 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] font-mono text-xs focus:outline-hidden focus:border-[var(--accent)]"
          />
        </div>
        <p className="text-[10px] text-[var(--muted)]">{t("plans.phoneHint")}</p>
        {validationError && (
          <p className="text-[11px] text-red-400 bg-red-500/10 p-2 rounded-[6px] border border-red-500/20">
            {validationError}
          </p>
        )}
      </div>

      <div className="space-y-2 pt-2">
        <Button
          type="submit"
          variant="primary"
          className="w-full text-xs font-semibold py-2.5 gap-1.5"
          disabled={submitting || !phone.trim()}
        >
          {submitting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {t("plans.processing")}
            </>
          ) : (
            t("plans.phoneSaveAndPay")
          )}
        </Button>

        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          disabled={submitting}
          className="w-full text-xs text-[var(--muted)] hover:text-[var(--ink)] gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {t("plans.phoneBack")}
        </Button>
      </div>

      <p className="text-[10px] text-[var(--placeholder)] text-center flex items-center justify-center gap-1">
        <ShieldCheck className="w-3 h-3 text-[var(--accent)]" />
        {t("plans.securedByTripay")}
      </p>
    </form>
  );
}
