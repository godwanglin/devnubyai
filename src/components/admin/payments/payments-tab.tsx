"use client";

import React, { useState } from "react";
import { CreditCard, Receipt, Settings2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { PaymentMethodsView } from "./payment-methods-view";
import { PaymentTransactionsView } from "./payment-transactions-view";
import { PaymentGatewayConfigCard } from "./payment-gateway-config-card";

type PaymentSubTab = "methods" | "transactions" | "gateway";

export function PaymentsTab() {
  const [activeTab, setActiveTab] = useState<PaymentSubTab>("methods");

  const tabs: Array<{ id: PaymentSubTab; label: string; icon: React.ReactNode }> = [
    {
      id: "methods",
      label: "Metode Pembayaran",
      icon: <CreditCard className="w-4 h-4" />,
    },
    {
      id: "transactions",
      label: "Daftar Transaksi",
      icon: <Receipt className="w-4 h-4" />,
    },
    {
      id: "gateway",
      label: "Konfigurasi Gateway",
      icon: <Settings2 className="w-4 h-4" />,
    },
  ];

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-bold text-[var(--ink)]">Manajemen Pembayaran</h1>
        <p className="text-xs text-[var(--muted)] mt-0.5">
          Kelola metode pembayaran, logo R2, alur checkout, transaksi masuk, dan status integrasi DOKU Payment Gateway.
        </p>
      </div>

      {/* Sub-tabs Navigation */}
      <div className="flex items-center gap-1 p-1 rounded-[10px] bg-[var(--panel-elevated)] border border-[var(--border)] w-fit overflow-x-auto scrollbar-none">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-[7px] text-xs font-medium transition-all whitespace-nowrap cursor-pointer",
                isActive
                  ? "bg-[var(--accent-soft)] text-[var(--accent)] font-semibold shadow-xs border border-[var(--border)]"
                  : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] border border-transparent"
              )}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Panels */}
      <div>
        {activeTab === "methods" && <PaymentMethodsView />}
        {activeTab === "transactions" && <PaymentTransactionsView />}
        {activeTab === "gateway" && <PaymentGatewayConfigCard />}
      </div>
    </div>
  );
}
