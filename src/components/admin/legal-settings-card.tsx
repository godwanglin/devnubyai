"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Phone, Mail, Clock, MapPin, Building2, FileCheck2, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/providers/toast-provider";
import { LegalSectionsEditor } from "./legal-sections-editor";
import type { LegalSettings, LegalSectionItem } from "@/lib/legal/settings";

type ActiveTab = "contact" | "terms" | "privacy" | "refund" | "about";

export function LegalSettingsCard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<ActiveTab>("contact");

  const [companyName, setCompanyName] = useState("");
  const [brandTagline, setBrandTagline] = useState("");
  const [entityLegalName, setEntityLegalName] = useState("");
  const [cityAddress, setCityAddress] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [supportWhatsappNumber, setSupportWhatsappNumber] = useState("");
  const [supportWhatsappFormatted, setSupportWhatsappFormatted] = useState("");
  const [operationalHours, setOperationalHours] = useState("");
  const [aboutText, setAboutText] = useState("");
  const [aboutHighlights, setAboutHighlights] = useState<LegalSectionItem[]>([]);
  const [termsSections, setTermsSections] = useState<LegalSectionItem[]>([]);
  const [privacySections, setPrivacySections] = useState<LegalSectionItem[]>([]);
  const [refundSections, setRefundSections] = useState<LegalSectionItem[]>([]);
  const [lastUpdatedDate, setLastUpdatedDate] = useState("");

  function applySettings(s: LegalSettings) {
    setCompanyName(s.companyName || "");
    setBrandTagline(s.brandTagline || "");
    setEntityLegalName(s.entityLegalName || "");
    setCityAddress(s.cityAddress || "");
    setSupportEmail(s.supportEmail || "");
    setSupportWhatsappNumber(s.supportWhatsappNumber || "");
    setSupportWhatsappFormatted(s.supportWhatsappFormatted || "");
    setOperationalHours(s.operationalHours || "");
    setAboutText(s.aboutText || "");
    setAboutHighlights(s.aboutHighlights || []);
    setTermsSections(s.termsSections || []);
    setPrivacySections(s.privacySections || []);
    setRefundSections(s.refundSections || []);
    setLastUpdatedDate(s.lastUpdatedDate || "");
  }

  useEffect(() => {
    let mounted = true;
    fetch("/api/v1/admin/settings/legal", { credentials: "same-origin" })
      .then((res) => {
        if (!res.ok) throw new Error("Gagal mengambil pengaturan legal");
        return res.json();
      })
      .then((json) => {
        if (mounted && json?.data?.settings) {
          applySettings(json.data.settings);
        }
      })
      .catch((err) => {
        console.error(err);
        toast("Gagal memuat pengaturan legal");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [toast]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/v1/admin/settings/legal", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName,
          brandTagline,
          entityLegalName,
          cityAddress,
          supportEmail,
          supportWhatsappNumber,
          supportWhatsappFormatted,
          operationalHours,
          aboutText,
          aboutHighlights,
          termsSections,
          privacySections,
          refundSections,
          lastUpdatedDate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Gagal menyimpan pengaturan legal");
      }
      applySettings(data.data.settings);
      toast("Pengaturan halaman legal & WhatsApp berhasil disimpan");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal menyimpan";
      toast(msg);
    } finally {
      setSaving(false);
    }
  }

  const tabs: Array<{ id: ActiveTab; label: string }> = [
    { id: "contact", label: "Kontak & Identitas" },
    { id: "terms", label: "Syarat & Ketentuan" },
    { id: "privacy", label: "Kebijakan Privasi" },
    { id: "refund", label: "Kebijakan Refund" },
    { id: "about", label: "Tentang Kami" },
  ];

  return (
    <div className="rounded-[14px] border border-[var(--border)] bg-[var(--panel)] p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[var(--accent)]/10 text-[var(--accent)]">
            <FileCheck2 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[var(--ink)]">
              Kontak Support, WhatsApp & Halaman Legal
            </h2>
            <p className="text-xs text-[var(--muted)]">
              Data dinamis yang tampil di halaman publik (/about, /terms, /privacy, /refund, /contact) dan dicache di Redis.
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--muted)]" />
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-5">
          {/* Sub-tabs */}
          <div className="flex items-center gap-1 border-b border-[var(--border)] pb-2 overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 rounded-[8px] text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                  tab === t.id
                    ? "bg-[var(--accent)] text-[var(--accent-text)]"
                    : "text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--hover)]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "contact" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--ink)] flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-[var(--accent)]" />
                    <span>Nomor WhatsApp (Angka saja untuk Link)</span>
                    <Tooltip content="Diawali kode negara tanpa tanda plus, contoh: 6281234567890">
                      <HelpCircle className="w-3.5 h-3.5 text-[var(--muted)] cursor-help" />
                    </Tooltip>
                  </label>
                  <input
                    type="text"
                    required
                    value={supportWhatsappNumber}
                    onChange={(e) => setSupportWhatsappNumber(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="6281234567890"
                    className="w-full px-3 py-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] text-xs text-[var(--ink)] focus:border-[var(--accent)]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--ink)] flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-[var(--accent)]" />
                    <span>Tampilan Nomor WhatsApp</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={supportWhatsappFormatted}
                    onChange={(e) => setSupportWhatsappFormatted(e.target.value)}
                    placeholder="+62 812-3456-7890"
                    className="w-full px-3 py-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] text-xs text-[var(--ink)] focus:border-[var(--accent)]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--ink)] flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-[var(--accent)]" />
                    <span>Email Dukungan Resmi</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={supportEmail}
                    onChange={(e) => setSupportEmail(e.target.value)}
                    placeholder="support@devnuby.id"
                    className="w-full px-3 py-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] text-xs text-[var(--ink)] focus:border-[var(--accent)]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--ink)] flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[var(--accent)]" />
                    <span>Jam Operasional Support</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={operationalHours}
                    onChange={(e) => setOperationalHours(e.target.value)}
                    placeholder="Senin – Minggu, 09:00 – 22:00 WIB"
                    className="w-full px-3 py-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] text-xs text-[var(--ink)] focus:border-[var(--accent)]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--ink)] flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-[var(--accent)]" />
                    <span>Nama Brand & Badan Usaha</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      required
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="Devnuby AI"
                      className="w-full px-3 py-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] text-xs text-[var(--ink)] focus:border-[var(--accent)]"
                    />
                    <input
                      type="text"
                      required
                      value={entityLegalName}
                      onChange={(e) => setEntityLegalName(e.target.value)}
                      placeholder="Devnuby Digital"
                      className="w-full px-3 py-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] text-xs text-[var(--ink)] focus:border-[var(--accent)]"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--ink)] flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-[var(--accent)]" />
                    <span>Domisili / Kota Usaha</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={cityAddress}
                    onChange={(e) => setCityAddress(e.target.value)}
                    placeholder="Jakarta, Indonesia"
                    className="w-full px-3 py-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] text-xs text-[var(--ink)] focus:border-[var(--accent)]"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--ink)]">
                  Tagline Brand (Tampil di Footer)
                </label>
                <input
                  type="text"
                  value={brandTagline}
                  onChange={(e) => setBrandTagline(e.target.value)}
                  className="w-full px-3 py-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] text-xs text-[var(--ink)] focus:border-[var(--accent)]"
                />
              </div>
            </div>
          )}

          {tab === "terms" && (
            <div className="space-y-3">
              <p className="text-xs text-[var(--muted)]">
                Pasal Syarat & Ketentuan Layanan yang tampil di <code className="text-[11px] font-mono">/terms</code>.
              </p>
              <LegalSectionsEditor sections={termsSections} onChange={setTermsSections} />
            </div>
          )}

          {tab === "privacy" && (
            <div className="space-y-3">
              <p className="text-xs text-[var(--muted)]">
                Pasal Kebijakan Privasi yang tampil di <code className="text-[11px] font-mono">/privacy</code>.
              </p>
              <LegalSectionsEditor sections={privacySections} onChange={setPrivacySections} />
            </div>
          )}

          {tab === "refund" && (
            <div className="space-y-3">
              <p className="text-xs text-[var(--muted)]">
                Pasal Kebijakan Refund yang tampil di <code className="text-[11px] font-mono">/refund</code>.
              </p>
              <LegalSectionsEditor sections={refundSections} onChange={setRefundSections} />
            </div>
          )}

          {tab === "about" && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--ink)]">
                  Paragraf Visi & Misi (/about)
                </label>
                <textarea
                  rows={4}
                  value={aboutText}
                  onChange={(e) => setAboutText(e.target.value)}
                  className="w-full px-3 py-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] text-xs text-[var(--ink)] focus:border-[var(--accent)] leading-relaxed"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-[var(--ink)]">
                  Poin Keunggulan Platform
                </label>
                <LegalSectionsEditor sections={aboutHighlights} onChange={setAboutHighlights} />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-3 border-t border-[var(--border)]">
            <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
              <span>Tanggal Pembaruan:</span>
              <input
                type="text"
                value={lastUpdatedDate}
                onChange={(e) => setLastUpdatedDate(e.target.value)}
                placeholder="3 November 2026"
                className="px-2 py-1 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] text-[11px] text-[var(--ink)] w-36"
              />
            </div>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
              Simpan Pengaturan Legal
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
