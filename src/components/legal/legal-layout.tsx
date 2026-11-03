import React from "react";
import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { DevnubyWordmark } from "@/components/brand/devnuby-logo";
import { LegalFooter } from "./legal-footer";
import { getLegalSettings } from "@/lib/legal/settings";

interface LegalLayoutProps {
  title: string;
  subtitle: string;
  badge?: string;
  children: React.ReactNode;
}

export async function LegalLayout({ title, subtitle, badge, children }: LegalLayoutProps) {
  const legal = await getLegalSettings();

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)] flex flex-col selection:bg-[var(--accent)] selection:text-[var(--accent-text)] relative overflow-x-hidden">
      {/* Background Ambient Glow */}
      <div
        className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[720px] h-[360px] bg-gradient-to-b from-[var(--accent)]/10 via-[var(--accent)]/5 to-transparent blur-3xl opacity-60"
        aria-hidden="true"
      />

      {/* Top Navbar */}
      <header className="sticky top-0 z-40 w-full border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur-[12px]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Kembali ke Beranda</span>
          </Link>

          <Link href="/" className="flex items-center gap-2">
            <DevnubyWordmark className="h-4 w-auto text-[var(--ink)]" />
          </Link>

          <div className="flex items-center gap-3">
            <Link
              href="/plans"
              className="text-xs font-semibold text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
            >
              Paket & Harga
            </Link>
            <Link
              href="/contact"
              className="text-xs font-semibold text-[var(--accent)] hover:underline"
            >
              Kontak
            </Link>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-16 relative z-10">
        {/* Header Section */}
        <div className="mb-10 space-y-3">
          {badge ? (
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-white/[0.04] border border-white/10 text-[var(--muted)] shadow-sm">
              <Sparkles className="w-3.5 h-3.5 text-[var(--accent)]" />
              <span>{badge}</span>
            </div>
          ) : null}

          <h1 className="text-2xl sm:text-4xl font-extrabold text-[var(--ink)] tracking-tight">
            {title}
          </h1>
          <p className="text-xs sm:text-sm text-[var(--muted)] leading-relaxed">
            {subtitle}
          </p>
          <div className="text-[11px] text-[var(--placeholder)] pt-1">
            Terakhir Diperbarui: {legal.lastUpdatedDate}
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 sm:p-8 rounded-[16px] border border-[var(--border)] bg-[var(--panel)]/70 backdrop-blur-[6px] space-y-8 text-xs sm:text-sm leading-relaxed text-[var(--muted)] shadow-sm">
          {children}
        </div>
      </main>

      {/* Dynamic Legal Footer */}
      <LegalFooter />
    </div>
  );
}
