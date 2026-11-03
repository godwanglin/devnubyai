import type { Metadata } from "next";
import { LegalLayout } from "@/components/legal/legal-layout";
import { LegalSections } from "@/components/legal/legal-sections";
import { getLegalSettings } from "@/lib/legal/settings";

export const metadata: Metadata = {
  title: "Syarat & Ketentuan Layanan — Devnuby AI",
  description:
    "Ketentuan dan syarat penggunaan layanan asisten kecerdasan buatan dan langganan di platform Devnuby AI.",
};

export default async function TermsPage() {
  const legal = await getLegalSettings();

  return (
    <LegalLayout
      badge="Aturan Layanan"
      title="Syarat & Ketentuan Penggunaan"
      subtitle={`Ketentuan baku yang mengikat penggunaan layanan platform ${legal.companyName} (${legal.entityLegalName}).`}
    >
      <LegalSections sections={legal.termsSections} />
    </LegalLayout>
  );
}
