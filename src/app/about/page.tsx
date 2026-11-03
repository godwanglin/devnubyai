import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { LegalLayout } from "@/components/legal/legal-layout";
import { getLegalSettings } from "@/lib/legal/settings";

export const metadata: Metadata = {
  title: "Tentang Kami — Devnuby AI",
  description:
    "Mengenal Devnuby AI, platform asisten kecerdasan buatan terpadu untuk produktivitas, pembuatan dokumen, dan analisis kode.",
};

export default async function AboutPage() {
  const legal = await getLegalSettings();

  return (
    <LegalLayout
      badge="Profil Platform"
      title="Tentang Devnuby AI"
      subtitle={`${legal.brandTagline} yang dikembangkan oleh ${legal.entityLegalName}.`}
    >
      <div className="space-y-6">
        <div className="space-y-3">
          <h2 className="text-base sm:text-lg font-bold text-[var(--ink)]">
            Visi & Misi Kami
          </h2>
          <p className="leading-relaxed text-justify sm:text-left">
            {legal.aboutText}
          </p>
        </div>

        <div className="pt-4 border-t border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)] mb-4">
            Mengapa Memilih Devnuby AI?
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {legal.aboutHighlights.map((item, idx) => (
              <div
                key={idx}
                className="p-4 rounded-[12px] border border-[var(--border)] bg-[var(--surface)]/50 space-y-1.5"
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ink)]">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{item.title}</span>
                </div>
                <p className="text-[11px] leading-relaxed text-[var(--placeholder)] pl-6">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-6 border-t border-[var(--border)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 rounded-[12px] bg-gradient-to-r from-[var(--accent)]/10 via-[var(--surface)] to-transparent border border-[var(--accent)]/20">
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-[var(--ink)]">
              Mulai Gunakan Devnuby AI Hari Ini
            </h4>
            <p className="text-[11px] text-[var(--placeholder)]">
              Jelajahi pilihan paket berlangganan atau mulai percakapan baru sekarang.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Link
              href="/plans"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[10px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-xs font-semibold text-[var(--accent-text)] transition-colors"
            >
              <span>Lihat Paket</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </LegalLayout>
  );
}
