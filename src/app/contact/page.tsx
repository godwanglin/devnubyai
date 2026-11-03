import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircle, Mail, Clock, MapPin, ShieldCheck, ArrowRight, FileText } from "lucide-react";
import { LegalLayout } from "@/components/legal/legal-layout";
import { getLegalSettings, buildWhatsappLink } from "@/lib/legal/settings";

export const metadata: Metadata = {
  title: "Hubungi Kami & Support WhatsApp — Devnuby AI",
  description:
    "Kontak resmi tim support Devnuby AI via WhatsApp resmi, email dukungan, dan informasi operasional layanan.",
};

export default async function ContactPage() {
  const legal = await getLegalSettings();
  const waUrl = buildWhatsappLink(
    legal.supportWhatsappNumber,
    "Halo Tim Support Devnuby AI, saya ingin bertanya terkait layanan/pembayaran..."
  );

  return (
    <LegalLayout
      badge="Pusat Dukungan"
      title="Hubungi Dukungan Pelanggan"
      subtitle={`Tim ${legal.companyName} siap membantu pertanyaan seputar akun, kendala pembayaran, aktivasi paket, dan integrasi fitur.`}
    >
      <div className="space-y-8">
        {/* Main WhatsApp Card */}
        <div className="p-6 sm:p-7 rounded-[14px] border border-emerald-500/25 bg-emerald-500/[0.04] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
          <div className="space-y-2 max-w-lg">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Dukungan WhatsApp Resmi (Respon Cepat)</span>
            </div>
            <h2 className="text-base sm:text-lg font-bold text-[var(--ink)]">
              Chat Langsung via WhatsApp
            </h2>
            <p className="text-xs text-[var(--muted)] leading-relaxed">
              Dapatkan bantuan langsung dari tim representatif kami untuk kendala akun, verifikasi transfer, atau pertanyaan umum.
            </p>
            <div className="text-xs font-semibold text-emerald-400 font-mono pt-1">
              {legal.supportWhatsappFormatted}
            </div>
          </div>

          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-[12px] bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/20 transition-all cursor-pointer shrink-0"
          >
            <MessageCircle className="w-4 h-4 shrink-0" />
            <span>Kirim Pesan WhatsApp</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </a>
        </div>

        {/* Support Details Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)]/50 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ink)]">
              <Mail className="w-4 h-4 text-[var(--accent)] shrink-0" />
              <span>Email Resmi</span>
            </div>
            <p className="text-[11px] text-[var(--placeholder)] leading-relaxed">
              Untuk kerja sama formal, penawaran enterprise, atau aduan resmi.
            </p>
            <div className="text-xs text-[var(--ink)] font-medium pt-1">
              <a href={`mailto:${legal.supportEmail}`} className="hover:text-[var(--accent)] transition-colors">
                {legal.supportEmail}
              </a>
            </div>
          </div>

          <div className="p-5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)]/50 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ink)]">
              <Clock className="w-4 h-4 text-[var(--accent)] shrink-0" />
              <span>Jam Operasional</span>
            </div>
            <p className="text-[11px] text-[var(--placeholder)] leading-relaxed">
              Waktu layanan tanggap tim customer service kami.
            </p>
            <div className="text-xs text-[var(--ink)] font-medium pt-1">
              {legal.operationalHours}
            </div>
          </div>

          <div className="p-5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)]/50 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ink)]">
              <MapPin className="w-4 h-4 text-[var(--accent)] shrink-0" />
              <span>Alamat & Lokasi</span>
            </div>
            <p className="text-[11px] text-[var(--placeholder)] leading-relaxed">
              Entitas pengelola: {legal.entityLegalName}.
            </p>
            <div className="text-xs text-[var(--ink)] font-medium pt-1">
              {legal.cityAddress}
            </div>
          </div>
        </div>

        {/* Informasi Pengaduan Transaksi & Bantuan Pembayaran */}
        <div className="space-y-3 pt-4 border-t border-[var(--border)]">
          <h3 className="text-sm font-bold text-[var(--ink)] flex items-center gap-2">
            <FileText className="w-4 h-4 text-[var(--accent)]" />
            <span>Panduan Pengaduan Pembayaran & Transaksi</span>
          </h3>
          <p className="leading-relaxed">
            Jika Anda sudah menyelesaikan pembayaran melalui QRIS, Virtual Account, atau E-Wallet namun paket belum aktif dalam kurun waktu 5 menit, harap siapkan data berikut sebelum menghubungi support WhatsApp:
          </p>
          <ul className="list-disc pl-5 space-y-1.5 text-xs text-[var(--muted)]">
            <li>Alamat email akun Devnuby AI yang digunakan saat transaksi.</li>
            <li>Nomor Invoice atau Referensi Pembayaran (contoh: <code className="text-[11px] font-mono bg-white/[0.04] px-1.5 py-0.5 rounded border border-white/5">INV-202611...</code>).</li>
            <li>Tangkapan layar (screenshot) bukti transfer sukses dari aplikasi m-banking atau e-wallet Anda.</li>
          </ul>
          <p className="text-[11px] text-[var(--placeholder)] pt-1">
            Tim kami akan memverifikasi mutasi payment gateway secara real-time dan mengaktifkan paket Anda seketika.
          </p>
        </div>

        {/* Legal Link Callout */}
        <div className="p-4 rounded-[12px] border border-[var(--border)] bg-[var(--surface)]/30 flex items-center justify-between text-xs text-[var(--placeholder)]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>Lihat ketentuan pengembalian dana kami jika mengalami kendala transaksi.</span>
          </div>
          <Link href="/refund" className="text-[var(--accent)] hover:underline shrink-0 font-medium">
            Kebijakan Refund →
          </Link>
        </div>
      </div>
    </LegalLayout>
  );
}
