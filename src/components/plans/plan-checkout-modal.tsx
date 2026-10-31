"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { Check, Copy, ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n-provider";
import { useAccount } from "@/providers/account-provider";
import type { PublicPlanItem } from "@/app/api/v1/plans/route";
import type { PaymentMethodItem } from "@/lib/payments/types";

interface PlanCheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  plan: PublicPlanItem | null;
  initialCycle: "monthly" | "yearly";
}

interface DirectVaResult {
  virtualAccountNumber?: string;
  paymentCode?: string;
  invoiceNumber: string;
  amount: number;
  expiredDate?: string;
  bank: string;
  howToPayPage?: string;
}

export function PlanCheckoutModal({
  isOpen,
  onClose,
  plan,
  initialCycle,
}: PlanCheckoutModalProps) {
  const { t } = useI18n();
  const { user } = useAccount();

  const [cycle, setCycle] = useState<"monthly" | "yearly">(initialCycle);
  const [methods, setMethods] = useState<PaymentMethodItem[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethodItem | null>(null);
  const [loadingMethods, setLoadingMethods] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vaResult, setVaResult] = useState<DirectVaResult | null>(null);
  const [copied, setCopied] = useState(false);

  // Sync initial cycle when modal opens
  useEffect(() => {
    if (isOpen) {
      setCycle(initialCycle);
      setVaResult(null);
      setError(null);
      setCopied(false);
    }
  }, [isOpen, initialCycle]);

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

  const handleCopyVa = () => {
    const code = vaResult?.virtualAccountNumber || vaResult?.paymentCode;
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
      // Direct VA flow (e.g. BRI, BCA, Mandiri)
      if (selectedMethod.flowType === "direct" && selectedMethod.code) {
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
            },
          }),
        });

        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error?.message || "Gagal membuat kode Virtual Account");
        }

        setVaResult(json.data);
      } else {
        // Checkout flow (e.g. QRIS, Hosted Checkout)
        const res = await fetch("/api/v1/payments/doku/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            invoiceNumber,
            amount: effectivePrice,
            customer: {
              name: user?.name || "DevNuby Customer",
              email: user?.email || "customer@devnuby.ai",
            },
            items: [
              {
                name: `${plan.name} (${cycle === "monthly" ? "Bulanan" : "Tahunan"})`,
                price: effectivePrice,
                quantity: 1,
              },
            ],
            callbackUrl: `${window.location.origin}/plans?payment=success`,
            callbackUrlCancel: `${window.location.origin}/plans?payment=cancel`,
          }),
        });

        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error?.message || "Gagal membuat sesi pembayaran checkout");
        }

        if (json.data?.paymentUrl) {
          window.location.href = json.data.paymentUrl;
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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={vaResult ? t("plans.paymentSuccess") : t("plans.checkoutTitle", { name: plan.name })}
      description={vaResult ? t("plans.vaNotice") : t("plans.checkoutSubtitle")}
      maxWidth="md"
    >
      {vaResult ? (
        // Direct VA Success View
        <div className="space-y-5 py-1">
          <div className="p-4 rounded-[12px] bg-[var(--panel-elevated)] border border-[var(--border)] text-center space-y-3">
            <span className="text-xs uppercase font-semibold text-[var(--muted)] tracking-wider">
              Nomor Virtual Account ({vaResult.bank.toUpperCase()})
            </span>
            <div className="flex items-center justify-center gap-3">
              <span className="text-2xl font-mono font-bold text-[var(--ink)] tracking-wider select-all">
                {vaResult.virtualAccountNumber || vaResult.paymentCode}
              </span>
              <button
                type="button"
                onClick={handleCopyVa}
                className="p-1.5 rounded-[6px] hover:bg-[var(--hover)] text-[var(--muted)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                title={t("plans.copy")}
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            {copied && <p className="text-[11px] text-emerald-400 font-medium">{t("plans.copied")}</p>}
            {vaResult.howToPayPage && (
              <div className="pt-1">
                <a
                  href={vaResult.howToPayPage}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline"
                >
                  <span>Lihat Petunjuk Pembayaran</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}
          </div>

          <div className="space-y-2 text-xs text-[var(--muted)]">
            <div className="flex justify-between py-1 border-b border-[var(--border)]">
              <span>Nomor Invoice</span>
              <span className="font-mono text-[var(--ink)]">{vaResult.invoiceNumber}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[var(--border)]">
              <span>Total Tagihan</span>
              <span className="font-semibold text-[var(--ink)]">{formatRupiah(vaResult.amount)}</span>
            </div>
            {vaResult.expiredDate && (
              <div className="flex justify-between py-1 border-b border-[var(--border)]">
                <span>{t("plans.expiryTime")}</span>
                <span className="text-amber-400 font-medium">
                  {new Date(vaResult.expiredDate).toLocaleString("id-ID")}
                </span>
              </div>
            )}
          </div>

          <p className="text-xs text-[var(--muted)] bg-white/[0.03] p-3 rounded-[8px] border border-white/5">
            {t("plans.vaInstructions")}
          </p>

          <Button variant="primary" className="w-full text-xs" onClick={onClose}>
            Selesai
          </Button>
        </div>
      ) : (
        // Checkout Form View
        <div className="space-y-5 py-1">
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
                          {m.flowType === "direct"
                            ? "Virtual Account Langsung"
                            : "Pembayaran Instan (Checkout)"}
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
              ) : selectedMethod?.flowType === "direct" ? (
                t("plans.payNow")
              ) : (
                <span className="flex items-center justify-center gap-1.5">
                  {t("plans.payNow")}
                  <ExternalLink className="w-3.5 h-3.5" />
                </span>
              )}
            </Button>

            <p className="text-[10px] text-[var(--placeholder)] text-center mt-2.5 flex items-center justify-center gap-1">
              <ShieldCheck className="w-3 h-3 text-[var(--accent)]" />
              Pembayaran aman didukung oleh DOKU Payment Gateway
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}
