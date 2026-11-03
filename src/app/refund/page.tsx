import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { LegalLayout } from "@/components/legal/legal-layout";
import { LegalSections } from "@/components/legal/legal-sections";
import { getLegalSettings } from "@/lib/legal/settings";

export const metadata: Metadata = {
  title: "Kebijakan Pengembalian Dana — Devnuby AI",
  description: "Syarat dan cara pengajuan pengembalian dana (refund) paket berlangganan Devnuby AI.",
};

export default async function RefundPage() {
  const legal = await getLegalSettings();

  return (
    <LegalLayout
      badge="Transaksi & Pembayaran"
      title="Kebijakan Pengembalian Dana"
      subtitle={`Ketentuan refund dan pembatalan paket berlangganan ${legal.companyName}.`}
    >
      <LegalSections sections={legal.refundSections} />

      <div className="pt-6 border-t border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-[11px] text-[var(--placeholder)]">
          Butuh bantuan terkait transaksi? Tim support siap membantu.
        </p>
        <Link
          href="/contact"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[10px] border border-[var(--border)] bg-[var(--panel-elevated)] hover:bg-[var(--hover)] text-xs font-semibold text-[var(--ink)] transition-colors"
        >
          <MessageCircle className="w-3.5 h-3.5" />
          <span>Hubungi Support</span>
        </Link>
      </div>
    </LegalLayout>
  );
}
