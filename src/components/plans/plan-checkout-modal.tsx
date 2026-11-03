"use client";

import React, { useState, useEffect } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n-provider";
import { useAccount } from "@/providers/account-provider";
import { DirectVaView, type DirectVaResult } from "./direct-va-view";
import { QrisCheckoutView, type CheckoutResult } from "./qris-checkout-view";
import { TripayPaymentView } from "./tripay-payment-view";
import { PaymentSuccessView } from "./payment-success-view";
import { PaymentMethodList } from "./payment-method-list";
import { PendingInvoiceBanner, type PendingInvoice } from "./pending-invoice-banner";
import { PhoneRequiredForm } from "./phone-required-form";
import { PHONE_REQUIRED_CODE } from "@/lib/payments/phone";
import type { PublicPlanItem } from "@/app/api/v1/plans/route";
import type { PaymentMethodItem } from "@/lib/payments/types";
import type { TripayPaymentResult } from "@/lib/tripay/payment-kind";

interface PlanCheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  plan: PublicPlanItem | null;
  initialCycle: "monthly" | "yearly";
}

export function PlanCheckoutModal({
  isOpen,
  onClose,
  plan,
  initialCycle,
}: PlanCheckoutModalProps) {
  const { t } = useI18n();
  const { user, refresh } = useAccount();

  const [cycle, setCycle] = useState<"monthly" | "yearly">(initialCycle);
  const [methods, setMethods] = useState<PaymentMethodItem[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethodItem | null>(null);
  const [loadingMethods, setLoadingMethods] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsPhone, setNeedsPhone] = useState(false);
  const [vaResult, setVaResult] = useState<DirectVaResult | null>(null);
  const [checkoutResult, setCheckoutResult] = useState<CheckoutResult | null>(null);
  const [tripayResult, setTripayResult] = useState<TripayPaymentResult | null>(null);
  const [isPaid, setIsPaid] = useState(false);
  const [pendingInvoice, setPendingInvoice] = useState<PendingInvoice | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setCycle(initialCycle);
      setVaResult(null);
      setCheckoutResult(null);
      setTripayResult(null);
      setIsPaid(false);
      setError(null);
      setNeedsPhone(false);

      if (user?.id) {
        fetch(`/api/v1/tracking/pym:${encodeURIComponent(String(user.id))}`, {
          credentials: "same-origin",
        })
          .then((res) => res.json())
          .then((json) => {
            const invs = json?.invoices;
            if (Array.isArray(invs) && invs.length > 0) {
              setPendingInvoice(invs[0]);
            } else {
              setPendingInvoice(null);
            }
          })
          .catch(() => {});
      }
    }
  }, [isOpen, initialCycle, user?.id]);

  // Load active payment methods
  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;
    setLoadingMethods(true);

    fetch("/api/v1/payments/methods", { credentials: "same-origin" })
      .then((res) => res.json())
      .then((json) => {
        if (!mounted) return;
        const list: PaymentMethodItem[] = json?.data?.methods || [];
        setMethods(list);
        if (list.length > 0) {
          setSelectedMethod((prev) => prev ?? list[0]);
        }
      })
      .catch((err) => {
        if (mounted) setError(String(err));
      })
      .finally(() => {
        if (mounted) setLoadingMethods(false);
      });

    return () => {
      mounted = false;
    };
  }, [isOpen]);

  if (!plan) return null;

  const basePrice = cycle === "monthly" ? plan.priceMonthly : plan.priceYearly;
  const effectivePrice =
    cycle === "monthly" ? plan.effectivePriceMonthly : plan.effectivePriceYearly;
  const discountAmount = basePrice - effectivePrice;

  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    }).format(val);
  };

  const handlePaymentSuccess = async () => {
    setIsPaid(true);
    try {
      await refresh();
    } catch (e) {
      console.error("Failed to refresh user account state:", e);
    }
  };

  const handlePay = async (customerPhoneOverride?: string) => {
    if (!selectedMethod) {
      setError(t("plans.selectMethod"));
      return;
    }

    setSubmitting(true);
    setError(null);

    const invoiceNumber = `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    try {
      if (selectedMethod.provider === "tripay") {
        const res = await fetch("/api/v1/payments/tripay/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            methodId: selectedMethod.publicId,
            amount: effectivePrice,
            customerPhone: customerPhoneOverride,
            metadata: { planId: plan.id, cycle },
          }),
        });
        const json = await res.json();

        // The gateway needs a phone number the user hasn't saved yet: ask, then retry
        if (!res.ok && json?.error?.details?.code === PHONE_REQUIRED_CODE) {
          setNeedsPhone(true);
          return;
        }

        if (!res.ok) {
          throw new Error(json.error?.message || t("plans.createPaymentFailed"));
        }
        setNeedsPhone(false);
        setTripayResult(json.data);
      } else if (selectedMethod.flowType === "direct" && selectedMethod.code) {
        // DOKU Direct VA
        const res = await fetch("/api/v1/payments/doku/direct-va", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            invoiceNumber,
            amount: effectivePrice,
            bank: selectedMethod.code,
            customer: {
              name: user?.name || "Customer",
              email: user?.email || "customer@devnuby.ai",
              phone: customerPhoneOverride || "088220783426",
            },
            metadata: { planId: plan.id, cycle },
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error?.message || t("plans.createPaymentFailed"));
        }
        setVaResult(json.data);
      } else {
        // DOKU Checkout
        const res = await fetch("/api/v1/payments/doku/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            invoiceNumber,
            amount: effectivePrice,
            paymentMethodTypes:
              selectedMethod.code === "qris" || selectedMethod.category === "qris"
                ? ["QRIS"]
                : undefined,
            customer: {
              name: user?.name || "Customer",
              email: user?.email || "customer@devnuby.ai",
              phone: customerPhoneOverride || "088220783426",
            },
            items: [
              {
                name: `${plan.name} (${cycle === "monthly" ? t("plans.monthly") : t("plans.yearly")})`,
                price: effectivePrice,
                quantity: 1,
              },
            ],
            callbackUrl: `${window.location.origin}/plans?payment=success&invoice=${invoiceNumber}`,
            callbackUrlCancel: `${window.location.origin}/plans?payment=cancel&invoice=${invoiceNumber}`,
            metadata: { planId: plan.id, cycle },
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error?.message || t("plans.createPaymentFailed"));
        }
        if (json.data?.paymentUrl) {
          setCheckoutResult({
            paymentUrl: json.data.paymentUrl,
            invoiceNumber: json.data.invoiceNumber || invoiceNumber,
            amount: json.data.amount || effectivePrice,
            paymentMethodCode: selectedMethod.code,
          });
        } else {
          throw new Error(t("plans.paymentUrlMissing"));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("plans.paymentError"));
    } finally {
      setSubmitting(false);
    }
  };

  const getModalTitle = () => {
    if (isPaid) return t("plans.successTitle");
    if (needsPhone) return t("plans.phoneRequiredTitle");
    if (tripayResult) {
      if (tripayResult.kind === "qris") return t("plans.qrisTitle");
      return t("plans.methodTitle", { name: tripayResult.paymentName });
    }
    if (checkoutResult) return t("plans.qrisTitle");
    if (vaResult) return t("plans.paymentSuccess");
    return t("plans.checkoutTitle", { name: plan.name });
  };

  const getModalDescription = () => {
    if (isPaid) return t("plans.successDesc");
    if (needsPhone) return t("plans.phoneRequiredNotice");
    if (tripayResult) {
      if (tripayResult.kind === "qris") return t("plans.qrisDesc");
      if (tripayResult.kind === "pay_code") return t("plans.vaDesc");
      return t("plans.ewalletDesc");
    }
    if (checkoutResult) return t("plans.qrisDesc");
    if (vaResult) return t("plans.vaNotice");
    return t("plans.checkoutSubtitle");
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={getModalTitle()}
      description={getModalDescription()}
      maxWidth="md"
    >
      {isPaid ? (
        <PaymentSuccessView
          planName={plan.name}
          invoiceNumber={
            tripayResult?.invoiceNumber || checkoutResult?.invoiceNumber || vaResult?.invoiceNumber || ""
          }
          amount={tripayResult?.totalAmount || checkoutResult?.amount || vaResult?.amount || effectivePrice}
          formatRupiah={formatRupiah}
          onDone={onClose}
        />
      ) : needsPhone ? (
        <PhoneRequiredForm
          methodName={selectedMethod?.name || "E-Wallet"}
          defaultPhone={user?.phone}
          submitting={submitting}
          onSubmit={(phone) => void handlePay(phone)}
          onBack={() => {
            setNeedsPhone(false);
            setError(null);
          }}
        />
      ) : tripayResult ? (
        <TripayPaymentView
          result={tripayResult}
          formatRupiah={formatRupiah}
          onPaid={handlePaymentSuccess}
          onClose={onClose}
        />
      ) : checkoutResult ? (
        <QrisCheckoutView
          checkoutResult={checkoutResult}
          formatRupiah={formatRupiah}
          onPaid={handlePaymentSuccess}
          onClose={onClose}
        />
      ) : vaResult ? (
        <DirectVaView
          vaResult={vaResult}
          userId={user?.id}
          formatRupiah={formatRupiah}
          onPaid={handlePaymentSuccess}
          onClose={onClose}
        />
      ) : (
        <div className="space-y-5 py-1">
          {pendingInvoice && (
            <PendingInvoiceBanner
              invoice={pendingInvoice}
              formatRupiah={formatRupiah}
              onResumeTripay={setTripayResult}
              onResumeVa={setVaResult}
            />
          )}

          {/* Cycle Selector */}
          <div className="flex items-center p-1 rounded-[10px] bg-white/[0.04] border border-white/5">
            <button
              type="button"
              onClick={() => setCycle("monthly")}
              className={`flex-1 py-1.5 rounded-[8px] text-xs font-semibold transition-all cursor-pointer ${
                cycle === "monthly"
                  ? "bg-[var(--accent)] text-[var(--accent-text)] shadow-xs"
                  : "text-[var(--muted)] hover:text-[var(--ink)]"
              }`}
            >
              {t("plans.monthly")}
            </button>
            <button
              type="button"
              onClick={() => setCycle("yearly")}
              className={`flex-1 py-1.5 rounded-[8px] text-xs font-semibold transition-all cursor-pointer ${
                cycle === "yearly"
                  ? "bg-[var(--accent)] text-[var(--accent-text)] shadow-xs"
                  : "text-[var(--muted)] hover:text-[var(--ink)]"
              }`}
            >
              {t("plans.yearly")}
            </button>
          </div>

          {/* Order Summary */}
          <div className="p-3.5 rounded-[12px] bg-white/[0.02] border border-[var(--border)] space-y-2 text-xs">
            <div className="flex justify-between text-[var(--muted)]">
              <span>{t("plans.subscriptionPlan")}</span>
              <span className="font-medium text-[var(--ink)]">{plan.name}</span>
            </div>
            <div className="flex justify-between text-[var(--muted)]">
              <span>{t("plans.subtotal")}</span>
              <span className="text-[var(--ink)]">{formatRupiah(basePrice)}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-emerald-400">
                <span>{t("plans.discount")}</span>
                <span>-{formatRupiah(discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between pt-2 border-t border-[var(--border)] font-bold text-sm text-[var(--ink)]">
              <span>{t("plans.totalPayment")}</span>
              <span>{formatRupiah(effectivePrice)}</span>
            </div>
          </div>

          {/* Payment Method Selector */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-[var(--ink)]">
              {t("plans.paymentMethod")}
            </label>
            <PaymentMethodList
              methods={methods}
              selectedId={selectedMethod?.id ?? null}
              loading={loadingMethods}
              onSelect={(m) => {
                setSelectedMethod(m);
                setNeedsPhone(false);
                setError(null);
              }}
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 p-2.5 rounded-[8px] border border-red-500/20">
              {error}
            </p>
          )}

          {/* Submit Button */}
          <div className="pt-2">
            <Button
              variant="primary"
              className="w-full text-xs font-semibold py-2.5"
              onClick={() => void handlePay()}
              disabled={submitting || !selectedMethod}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />
                  {t("plans.processing")}
                </>
              ) : (
                t("plans.payNow")
              )}
            </Button>

            <p className="text-[10px] text-[var(--placeholder)] text-center mt-2.5 flex items-center justify-center gap-1">
              <ShieldCheck className="w-3 h-3 text-[var(--accent)]" />
              {t("plans.securedBy", {
                gateway: selectedMethod?.provider === "tripay" ? "Tripay" : "DOKU Payment Gateway",
              })}
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}
