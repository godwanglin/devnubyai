import type { Metadata } from "next";
import { PlansView } from "@/components/plans/plans-view";
import { LegalFooter } from "@/components/legal/legal-footer";

export const metadata: Metadata = {
  title: "Paket & Harga — Devnuby AI",
  description: "Pilih paket langganan Devnuby AI yang tepat untuk alur kerja dan kebutuhan Anda.",
};

export default function PlansPage() {
  return <PlansView footer={<LegalFooter />} />;
}
