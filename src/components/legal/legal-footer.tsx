import React from "react";
import Link from "next/link";
import { MessageCircle, ShieldCheck, Mail, MapPin } from "lucide-react";
import { DevnubyWordmark } from "@/components/brand/devnuby-logo";
import { getLegalSettings } from "@/lib/legal/settings";

export async function LegalFooter() {
  const legal = await getLegalSettings();

  return (
    <footer className="w-full border-t border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] text-xs mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* Brand Col */}
          <div className="space-y-3 md:col-span-1">
            <Link href="/" className="inline-flex items-center gap-2">
              <DevnubyWordmark className="h-4 w-auto text-[var(--ink)]" />
            </Link>
            <p className="text-[11px] leading-relaxed text-[var(--placeholder)]">
              {legal.brandTagline}
            </p>
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--placeholder)] pt-1">
              <MapPin className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" />
              <span>{legal.cityAddress}</span>
            </div>
          </div>

          {/* Navigasi Layanan */}
          <div className="space-y-2.5">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink)]">
              Layanan
            </h4>
            <ul className="space-y-1.5 text-[11px]">
              <li>
                <Link href="/" className="hover:text-[var(--ink)] transition-colors">
                  AI Chat & Reasoning
                </Link>
              </li>
              <li>
                <Link href="/plans" className="hover:text-[var(--ink)] transition-colors">
                  Paket & Harga
                </Link>
              </li>
              <li>
                <Link href="/about" className="hover:text-[var(--ink)] transition-colors">
                  Tentang Kami
                </Link>
              </li>
            </ul>
          </div>

          {/* Legalitas & Kebijakan (Penting untuk Payment Gateway Review) */}
          <div className="space-y-2.5">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink)]">
              Kebijakan & Hukum
            </h4>
            <ul className="space-y-1.5 text-[11px]">
              <li>
                <Link href="/terms" className="hover:text-[var(--ink)] transition-colors">
                  Syarat & Ketentuan Layanan
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="hover:text-[var(--ink)] transition-colors">
                  Kebijakan Privasi Data
                </Link>
              </li>
              <li>
                <Link href="/refund" className="hover:text-[var(--ink)] transition-colors">
                  Kebijakan Pengembalian Dana
                </Link>
              </li>
            </ul>
          </div>

          {/* Bantuan & Kontak WhatsApp */}
          <div className="space-y-2.5">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink)]">
              Bantuan & Dukungan
            </h4>
            <ul className="space-y-2 text-[11px]">
              <li>
                <Link
                  href="/contact"
                  className="inline-flex items-center gap-1.5 hover:text-[var(--ink)] transition-colors"
                >
                  <MessageCircle className="w-3.5 h-3.5 text-[var(--placeholder)] shrink-0" />
                  <span>Hubungi Kami</span>
                </Link>
              </li>
              <li className="flex items-center gap-1.5 text-[var(--muted)]">
                <Mail className="w-3.5 h-3.5 text-[var(--placeholder)] shrink-0" />
                <a href={`mailto:${legal.supportEmail}`} className="hover:text-[var(--ink)] transition-colors">
                  {legal.supportEmail}
                </a>
              </li>
              <li className="text-[10px] text-[var(--placeholder)]">
                Jam Layanan: {legal.operationalHours}
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="pt-6 border-t border-[var(--border)] flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-[var(--placeholder)]">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>
              © {new Date().getFullYear()} {legal.companyName} ({legal.entityLegalName}). Seluruh hak cipta dilindungi undang-undang.
            </span>
          </div>
          <div className="flex items-center gap-4 text-[10px]">
            <span>Pembayaran Aman & Terverifikasi</span>
            <span>Enkripsi TLS 1.3</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
