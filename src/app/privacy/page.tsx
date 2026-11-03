import type { Metadata } from "next";
import { LegalLayout } from "@/components/legal/legal-layout";
import { LegalSections } from "@/components/legal/legal-sections";
import { getLegalSettings } from "@/lib/legal/settings";

export const metadata: Metadata = {
  title: "Kebijakan Privasi — Devnuby AI",
  description:
    "Komitmen perlindungan privasi, pengelolaan data pengguna, serta keamanan transaksi di platform Devnuby AI.",
};

export default async function PrivacyPage() {
  const legal = await getLegalSettings();

  return (
    <LegalLayout
      badge="Perlindungan Data"
      title="Kebijakan Privasi"
      subtitle={`Bagaimana ${legal.companyName} mengumpulkan, melindungi, dan mengelola informasi Anda secara aman dan transparan.`}
    >
      <LegalSections sections={legal.privacySections} />
    </LegalLayout>
  );
}
