"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n-provider";
import type { TripayPaymentResult } from "@/lib/tripay/payment-kind";
import type { DirectVaResult } from "./direct-va-view";

export interface PendingInvoice {
  invoice: string;
  type?: string;
  kind?: TripayPaymentResult["kind"];
  amount: number;
  qrString?: string;
  vaNumber?: string;
  bank?: string;
  methodName?: string;
  checkoutUrl?: string;
  expiredAt?: string;
}

interface PendingInvoiceBannerProps {
  invoice: PendingInvoice;
  formatRupiah: (val: number) => string;
  onResumeTripay: (result: TripayPaymentResult) => void;
  onResumeVa: (result: DirectVaResult) => void;
}

/** Notice for a still-open invoice, with a button to reopen it instead of creating a new one */
export function PendingInvoiceBanner({
  invoice,
  formatRupiah,
  onResumeTripay,
  onResumeVa,
}: PendingInvoiceBannerProps) {
  const { t } = useI18n();
  const label = invoice.methodName || invoice.bank?.toUpperCase() || "VA";

  function handleResume() {
    if (invoice.type === "tripay" && invoice.kind && invoice.expiredAt) {
      onResumeTripay({
        invoiceNumber: invoice.invoice,
        kind: invoice.kind,
        paymentName: label,
        qrString: invoice.qrString || null,
        payCode: invoice.vaNumber || null,
        checkoutUrl: invoice.checkoutUrl || null,
        instructions: [],
        amount: invoice.amount,
        fee: 0,
        totalAmount: invoice.amount,
        expiredAt: invoice.expiredAt,
      });
      return;
    }
    onResumeVa({
      invoiceNumber: invoice.invoice,
      amount: invoice.amount,
      bank: invoice.bank || "briva",
      virtualAccountNumber: invoice.vaNumber,
      paymentCode: invoice.vaNumber,
      expiredDate: invoice.expiredAt,
    });
  }

  return (
    <div className="p-3.5 rounded-[12px] bg-amber-500/10 border border-amber-500/25 text-xs space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-amber-400">{t("plans.pendingInvoiceTitle")}</span>
        <span className="text-[10px] text-[var(--muted)] font-mono">{invoice.invoice}</span>
      </div>
      <p className="text-[11px] text-[var(--muted)] leading-relaxed">
        {invoice.qrString
          ? t("plans.pendingQrisNotice")
          : invoice.vaNumber
            ? t("plans.pendingVaNotice", { label, vaNumber: invoice.vaNumber })
            : t("plans.pendingGeneralNotice", { label })}{" "}
        <span className="text-[var(--ink)] font-semibold">{formatRupiah(invoice.amount)}</span>.
      </p>
      <div className="flex gap-2 pt-1">
        <Button variant="primary" className="text-[11px] py-1 px-3 h-auto" onClick={handleResume}>
          {t("plans.continuePendingPayment")}
        </Button>
      </div>
    </div>
  );
}
