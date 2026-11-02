"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { Check, Loader2, ShieldCheck } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n-provider";
import { useAccount } from "@/providers/account-provider";
import { DirectVaView, type DirectVaResult } from "./direct-va-view";
import { QrisCheckoutView, type CheckoutResult } from "./qris-checkout-view";
import { TripayQrisView, type TripayQrisResult } from "./tripay-qris-view";
import { PaymentSuccessView } from "./payment-success-view";
import type { PublicPlanItem } from "@/app/api/v1/plans/route";
import type { PaymentMethodItem } from "@/lib/payments/types";

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
  const [vaResult, setVaResult] = useState<DirectVaResult | null>(null);
  const [checkoutResult, setCheckoutResult] = useState<CheckoutResult | null>(null);
  const [tripayResult, setTripayResult] = useState<TripayQrisResult | null>(null);
  const [isPaid, setIsPaid] = useState(false);
  const [pendingInvoice, setPendingInvoice] = useState<{
    invoice: string;
    type?: string;
    amount: number;
    qrString?: string;
    vaNumber?: string;
    bank?: string;
    expiredAt?: string;
  } | null>(null);

  // Sync initial cycle & check active pending invoices when modal opens
  useEffect(() => {
    if (isOpen) {
      setCycle(initialCycle);
      setVaResult(null);
      setCheckoutResult(null);
      setTripayResult(null);
      setIsPaid(false);
      setError(null);

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

  const handlePay = async () => {
    if (!selectedMethod) {
      setError(t("plans.selectMethod"));
      return;
    }

    setSubmitting(true);
    setError(null);

    const invoiceNumber = `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    try {
      if (selectedMethod.provider === "tripay") {
        // Tripay QRIS: the server mints the invoice and returns the QR payload
        const res = await fetch("/api/v1/payments/tripay/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            methodId: selectedMethod.publicId,
            amount: effectivePrice,
            metadata: { planId: plan.id, cycle },
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error?.message || "Gagal membuat QRIS");
        }
        setTripayResult(json.data);
      } else if (selectedMethod.flowType === "direct" && selectedMethod.code) {
        // Direct VA flow (e.g. BRI, BCA, Mandiri)
        const res = await fetch("/api/v1/payments/doku/direct-va", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            invoiceNumber,
            amount: effectivePrice,
            bank: selectedMethod.code,
            customer: {
              name: user?.name || "DevNuby Customer",
              email: user?.email || "customer@devnuby.ai",
              phone: "088220783426",
            },
            metadata: {
              planId: plan.id,
              cycle,
            },
          }),
        });

        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error?.message || "Gagal membuat kode Virtual Account");
        }

        setVaResult(json.data);
      } else {
        // Checkout flow (QRIS) - in-modal iframe, no page redirect!
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
              name: user?.name || "DevNuby Customer",
              email: user?.email || "customer@devnuby.ai",
              phone: "088220783426",
            },
            items: [
              {
                name: `${plan.name} (${cycle === "monthly" ? "Bulanan" : "Tahunan"})`,
                price: effectivePrice,
                quantity: 1,
              },
            ],
            callbackUrl: `${window.location.origin}/plans?payment=success&invoice=${invoiceNumber}`,
            callbackUrlCancel: `${window.location.origin}/plans?payment=cancel&invoice=${invoiceNumber}`,
            metadata: {
              planId: plan.id,
              cycle,
            },
          }),
        });

        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error?.message || "Gagal membuat sesi pembayaran checkout");
        }

        if (json.data?.paymentUrl) {
          // Render inside the modal! No page redirection!
          setCheckoutResult({
            paymentUrl: json.data.paymentUrl,
            invoiceNumber: json.data.invoiceNumber || invoiceNumber,
            amount: json.data.amount || effectivePrice,
            paymentMethodCode: selectedMethod.code,
          });
        } else {
          throw new Error("URL pembayaran tidak ditemukan");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan pembayaran");
    } finally {
      setSubmitting(false);
    }
  };

  const getModalTitle = () => {
    if (isPaid) return "Pembayaran Berhasil";
    if (checkoutResult || tripayResult) return "Pembayaran QRIS";
    if (vaResult) return t("plans.paymentSuccess");
    return t("plans.checkoutTitle", { name: plan.name });
  };

  const getModalDescription = () => {
    if (isPaid) return "Status langganan akun Anda telah diperbarui.";
    if (checkoutResult || tripayResult) return "Pindai kode QRIS di bawah ini untuk menyelesaikan pembayaran.";
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
      ) : tripayResult ? (
        <TripayQrisView
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
            <div className="p-3.5 rounded-[12px] bg-amber-500/10 border border-amber-500/25 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-amber-400">Tagihan Belum Selesai</span>
                <span className="text-[10px] text-[var(--muted)] font-mono">{pendingInvoice.invoice}</span>
              </div>
              <p className="text-[11px] text-[var(--muted)] leading-relaxed">
                {pendingInvoice.qrString ? (
                  <>Anda memiliki tagihan QRIS aktif sebesar </>
                ) : (
                  <>
                    Anda memiliki Virtual Account ({pendingInvoice.bank?.toUpperCase() || "VA"}) aktif:{" "}
                    <span className="text-[var(--ink)] font-mono font-semibold">{pendingInvoice.vaNumber}</span> sebesar{" "}
                  </>
                )}
                <span className="text-[var(--ink)] font-semibold">{formatRupiah(pendingInvoice.amount)}</span>.
              </p>
              <div className="flex gap-2 pt-1">
                <Button
                  variant="primary"
                  className="text-[11px] py-1 px-3 h-auto"
                  onClick={() => {
                    if (pendingInvoice.qrString && pendingInvoice.expiredAt) {
                      setTripayResult({
                        invoiceNumber: pendingInvoice.invoice,
                        qrString: pendingInvoice.qrString,
                        amount: pendingInvoice.amount,
                        fee: 0,
                        totalAmount: pendingInvoice.amount,
                        expiredAt: pendingInvoice.expiredAt,
                      });
                      return;
                    }
                    setVaResult({
                      invoiceNumber: pendingInvoice.invoice,
                      amount: pendingInvoice.amount,
                      bank: pendingInvoice.bank || "briva",
                      virtualAccountNumber: pendingInvoice.vaNumber,
                      paymentCode: pendingInvoice.vaNumber,
                      expiredDate: pendingInvoice.expiredAt,
                    });
                  }}
                >
                  Lanjutkan Pembayaran Ini
                </Button>
              </div>
            </div>
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
              <span>Paket Langganan</span>
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

            {loadingMethods ? (
              <div className="py-6 flex items-center justify-center text-xs text-[var(--muted)]">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Memuat metode pembayaran...
              </div>
            ) : methods.length === 0 ? (
              <p className="text-xs text-[var(--muted)] p-3 border border-[var(--border)] rounded-[8px]">
                Belum ada metode pembayaran yang aktif.
              </p>
            ) : (
              <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1">
                {methods.map((m) => {
                  const isSelected = selectedMethod?.id === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setSelectedMethod(m)}
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
                          {m.provider === "tripay" || m.flowType !== "direct"
                            ? "Pembayaran Instan QRIS"
                            : "Virtual Account Langsung"}
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
            )}
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
              onClick={handlePay}
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
              Pembayaran aman didukung oleh{" "}
              {selectedMethod?.provider === "tripay" ? "Tripay" : "DOKU Payment Gateway"}
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}
