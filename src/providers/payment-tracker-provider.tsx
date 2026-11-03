"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Modal } from "@/components/ui/modal";
import { useAccount } from "@/providers/account-provider";
import { useI18n } from "@/providers/i18n-provider";
import { TripayPaymentView } from "@/components/plans/tripay-payment-view";
import { DirectVaView, type DirectVaResult } from "@/components/plans/direct-va-view";
import { PaymentSuccessView } from "@/components/plans/payment-success-view";
import type { TripayPaymentResult } from "@/lib/tripay/payment-kind";

export interface ActivePaymentTransaction {
  invoice: string;
  type: string;
  amount: number;
  vaNumber?: string;
  bank?: string;
  methodName?: string;
  howToPayUrl?: string;
  customerPhone?: string;
  kind?: "qris" | "pay_code" | "redirect" | "push";
  checkoutUrl?: string;
  qrString?: string;
  expiredAt?: string;
  createdAt: string;
}

interface PaymentTrackerContextType {
  openTransaction: (tx: ActivePaymentTransaction) => void;
  closeActivePayment: () => void;
  activeInvoice: string | null;
}

const PaymentTrackerContext = createContext<PaymentTrackerContextType | null>(null);

export function usePaymentTracker() {
  const ctx = useContext(PaymentTrackerContext);
  if (!ctx) {
    throw new Error("usePaymentTracker must be used within PaymentTrackerProvider");
  }
  return ctx;
}

export function PaymentTrackerProvider({ children }: { children: React.ReactNode }) {
  const { user, refresh } = useAccount();
  const { t } = useI18n();

  const [activeTx, setActiveTx] = useState<ActivePaymentTransaction | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isPaid, setIsPaid] = useState(false);

  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    }).format(val);
  };

  const closeActivePayment = useCallback(() => {
    setIsOpen(false);
    setActiveTx(null);
    setIsPaid(false);
    // Remove transaction hash from URL cleanly without full reload
    if (typeof window !== "undefined" && window.location.hash.startsWith("#/transaction/")) {
      const cleanUrl = window.location.pathname + window.location.search;
      window.history.replaceState(null, "", cleanUrl);
    }
  }, []);

  const openTransaction = useCallback((tx: ActivePaymentTransaction) => {
    setActiveTx(tx);
    setIsPaid(false);
    setIsOpen(true);
    // Update hash URL with #/transaction/<invoice>
    if (typeof window !== "undefined") {
      const targetHash = `#/transaction/${tx.invoice}`;
      if (window.location.hash !== targetHash) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${targetHash}`);
      }
    }
  }, []);

  const handlePaid = useCallback(async () => {
    setIsPaid(true);
    try {
      await refresh();
    } catch (e) {
      console.error("Failed to refresh user quota:", e);
    }
  }, [refresh]);

  // 1. On page load / reload in ANY route, check user's pending transactions
  useEffect(() => {
    if (!user?.id) return;

    let mounted = true;
    const userId = encodeURIComponent(String(user.id));

    // Check if URL currently has a specific hash like #/transaction/INV-...
    const currentHash = typeof window !== "undefined" ? window.location.hash : "";
    const hashMatch = currentHash.match(/^#\/transaction\/([A-Za-z0-9_-]+)/);
    const invoiceFromHash = hashMatch ? hashMatch[1] : null;

    if (invoiceFromHash) {
      // Query specific invoice
      fetch(`/api/v1/tracking/pym:${userId}:${encodeURIComponent(invoiceFromHash)}:doku`, {
        credentials: "same-origin",
      })
        .then((res) => res.json())
        .then((json) => {
          if (!mounted) return;
          if (json?.status === "pending" && json?.transaction) {
            openTransaction(json.transaction);
          } else if (json?.status === "success") {
            handlePaid();
            setIsOpen(true);
          }
        })
        .catch(() => {});
    } else {
      // General check: fetch active pending invoices for user
      fetch(`/api/v1/tracking/pym:${userId}`, {
        credentials: "same-origin",
      })
        .then((res) => res.json())
        .then((json) => {
          if (!mounted) return;
          const invoices: ActivePaymentTransaction[] = json?.invoices || [];
          if (invoices.length > 0) {
            // Take the latest pending invoice (index 0 because ordered by createdAt desc)
            const latest = invoices[0];
            openTransaction(latest);
          }
        })
        .catch(() => {});
    }

    return () => {
      mounted = false;
    };
  }, [user?.id, openTransaction, handlePaid]);

  // Listen to hashchange events
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (!hash.startsWith("#/transaction/")) {
        if (isOpen) setIsOpen(false);
      }
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [isOpen]);

  // Adapt activeTx to Tripay or Direct VA result
  const tripayResult: TripayPaymentResult | null =
    activeTx && activeTx.type === "tripay" && activeTx.kind && activeTx.expiredAt
      ? {
          invoiceNumber: activeTx.invoice,
          kind: activeTx.kind,
          paymentName: activeTx.methodName || "Pembayaran",
          customerPhone: activeTx.customerPhone || null,
          qrString: activeTx.qrString || null,
          payCode: activeTx.vaNumber || null,
          checkoutUrl: activeTx.checkoutUrl || null,
          instructions: [],
          amount: activeTx.amount,
          fee: 0,
          totalAmount: activeTx.amount,
          expiredAt: activeTx.expiredAt,
        }
      : null;

  const directVaResult: DirectVaResult | null =
    activeTx && activeTx.type !== "tripay" && activeTx.vaNumber
      ? {
          invoiceNumber: activeTx.invoice,
          amount: activeTx.amount,
          bank: activeTx.bank || "VA",
          virtualAccountNumber: activeTx.vaNumber,
          howToPayPage: activeTx.howToPayUrl,
        }
      : null;

  const getModalTitle = () => {
    if (isPaid) return t("plans.successTitle");
    if (tripayResult) {
      if (tripayResult.kind === "qris") return t("plans.qrisTitle");
      return t("plans.methodTitle", { name: tripayResult.paymentName });
    }
    if (directVaResult) return t("plans.paymentSuccess");
    return t("plans.subscriptionPlan");
  };

  const getModalDescription = () => {
    if (isPaid) return t("plans.successDesc");
    if (tripayResult) {
      if (tripayResult.kind === "qris") return t("plans.qrisDesc");
      if (tripayResult.kind === "pay_code") return t("plans.vaDesc");
      return t("plans.ewalletDesc");
    }
    if (directVaResult) return t("plans.vaNotice");
    return t("plans.checkoutSubtitle");
  };

  return (
    <PaymentTrackerContext.Provider
      value={{
        openTransaction,
        closeActivePayment,
        activeInvoice: activeTx?.invoice || null,
      }}
    >
      {children}

      {/* Global Persistent Payment Modal across ALL pages */}
      <Modal
        isOpen={isOpen}
        onClose={closeActivePayment}
        title={getModalTitle()}
        description={getModalDescription()}
        maxWidth="md"
      >
        {isPaid ? (
          <PaymentSuccessView
            planName="Devnuby AI Plan"
            invoiceNumber={activeTx?.invoice || ""}
            amount={activeTx?.amount || 0}
            formatRupiah={formatRupiah}
            onDone={closeActivePayment}
          />
        ) : tripayResult ? (
          <TripayPaymentView
            result={tripayResult}
            formatRupiah={formatRupiah}
            onPaid={handlePaid}
            onClose={closeActivePayment}
          />
        ) : directVaResult ? (
          <DirectVaView
            vaResult={directVaResult}
            userId={user?.id}
            formatRupiah={formatRupiah}
            onPaid={handlePaid}
            onClose={closeActivePayment}
          />
        ) : null}
      </Modal>
    </PaymentTrackerContext.Provider>
  );
}
