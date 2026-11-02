"use client";

import React, { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, Plus, X, RotateCcw, Loader2, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/providers/toast-provider";

interface NetworkRules {
  allowlist: string[];
  blocklist: string[];
}

export function NetworkRulesConfigCard() {
  const { toast } = useToast();

  const [savedRules, setSavedRules] = useState<NetworkRules | null>(null);
  const [allowlist, setAllowlist] = useState<string[]>([]);
  const [blocklist, setBlocklist] = useState<string[]>([]);
  const [newAllowItem, setNewAllowItem] = useState<string>("");
  const [newBlockItem, setNewBlockItem] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/admin/settings/network-rules", { credentials: "same-origin" })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.data?.rules) {
          throw new Error(json?.error?.message || "Gagal memuat aturan jaringan");
        }
        if (!active) return;
        const r: NetworkRules = json.data.rules;
        setSavedRules(r);
        setAllowlist(r.allowlist || []);
        setBlocklist(r.blocklist || []);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        toast(err instanceof Error && err.message ? err.message : "Gagal memuat aturan jaringan");
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [toast]);

  const isDirty =
    savedRules !== null &&
    (JSON.stringify(allowlist) !== JSON.stringify(savedRules.allowlist) ||
      JSON.stringify(blocklist) !== JSON.stringify(savedRules.blocklist));

  const handleAddAllow = () => {
    const val = newAllowItem.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!val) return;
    if (!allowlist.includes(val)) {
      setAllowlist([...allowlist, val]);
    }
    setNewAllowItem("");
  };

  const handleRemoveAllow = (item: string) => {
    setAllowlist(allowlist.filter((x) => x !== item));
  };

  const handleAddBlock = () => {
    const val = newBlockItem.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!val) return;
    if (!blocklist.includes(val)) {
      setBlocklist([...blocklist, val]);
    }
    setNewBlockItem("");
  };

  const handleRemoveBlock = (item: string) => {
    setBlocklist(blocklist.filter((x) => x !== item));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/v1/admin/settings/network-rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ allowlist, blocklist }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.data?.rules) {
        throw new Error(json?.error?.message || "Gagal menyimpan aturan jaringan");
      }
      const updated: NetworkRules = json.data.rules;
      setSavedRules(updated);
      setAllowlist(updated.allowlist || []);
      setBlocklist(updated.blocklist || []);
      toast("Aturan SSRF & Jaringan berhasil disimpan ke config/network-rules.json dan langsung aktif!");
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : "Gagal menyimpan aturan");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm("Reset aturan SSRF ke nilai default?")) return;
    setSaving(true);
    try {
      const res = await fetch("/api/v1/admin/settings/network-rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ resetToDefault: true }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.data?.rules) {
        throw new Error(json?.error?.message || "Gagal mereset aturan jaringan");
      }
      const updated: NetworkRules = json.data.rules;
      setSavedRules(updated);
      setAllowlist(updated.allowlist || []);
      setBlocklist(updated.blocklist || []);
      toast("Aturan SSRF berhasil direset ke default");
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : "Gagal mereset aturan");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-[14px] border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-5 flex flex-col justify-between shadow-xs col-span-1 lg:col-span-2">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
          <h3 className="text-sm font-semibold text-[var(--ink)]">
            Network & SSRF Rules (Dynamic Config)
          </h3>
          <Tooltip
            content="Konfigurasi izin dan blokir jaringan untuk upstream gateway & SSRF. Disimpan di config/network-rules.json dan langsung aktif seketika tanpa perlu restart server."
            side="top"
          >
            <HelpCircle className="w-3.5 h-3.5 text-[var(--muted)] cursor-help shrink-0" />
          </Tooltip>
        </div>

        {isDirty ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            Belum Disimpan
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            Aktif (Hot-Reload)
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-xs text-[var(--muted)] gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
          <span>Memuat aturan jaringan...</span>
        </div>
      ) : (
        <div className="mt-4 space-y-5">
          {/* Section 1: Allowlist */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <label className="text-xs font-semibold text-[var(--ink)]">
                  Allowlist (Bypass SSRF Filter)
                </label>
              </div>
              <span className="text-[11px] text-[var(--muted)]">
                Format: <code>ip:port</code>, <code>domain:port</code>, atau <code>domain</code>
              </span>
            </div>

            <p className="text-[11px] text-[var(--muted)]">
              Target upstream gateway atau server lokal yang diizinkan dihubungi (contoh: <code>127.0.0.1:3026</code>, <code>localhost:2018</code>, <code>aidev.weebinhub.biz.id</code>).
            </p>

            {/* Tags Container */}
            <div className="flex flex-wrap gap-1.5 min-h-[38px] p-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] items-center">
              {allowlist.length === 0 ? (
                <span className="text-[11px] text-[var(--muted)] italic">Tidak ada entri allowlist (semua local IP diblokir).</span>
              ) : (
                allowlist.map((item) => (
                  <span
                    key={item}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[6px] text-xs font-mono font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20"
                  >
                    <span>{item}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveAllow(item)}
                      className="hover:text-red-500 cursor-pointer transition-colors"
                      title={`Hapus ${item}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))
              )}
            </div>

            {/* Input + Add button */}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Tambah target allowlist (contoh: 127.0.0.1:3026)"
                value={newAllowItem}
                onChange={(e) => setNewAllowItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddAllow();
                  }
                }}
                className="flex-1 h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] text-xs font-mono outline-none focus:border-[var(--accent)] transition-colors"
              />
              <Button type="button" size="sm" variant="secondary" onClick={handleAddAllow} disabled={!newAllowItem.trim()}>
                <Plus className="w-3.5 h-3.5 mr-1" />
                Tambah
              </Button>
            </div>
          </div>

          {/* Section 2: Blocklist */}
          <div className="space-y-2 pt-2 border-t border-[var(--border)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-red-500" />
                <label className="text-xs font-semibold text-[var(--ink)]">
                  Blocklist (Restricted Hostnames & IPs)
                </label>
              </div>
              <span className="text-[11px] text-[var(--muted)]">
                Daftar host & IP terlarang (Loopback, Cloud Metadata, VPS IP)
              </span>
            </div>

            {/* Tags Container */}
            <div className="flex flex-wrap gap-1.5 min-h-[38px] p-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] items-center">
              {blocklist.length === 0 ? (
                <span className="text-[11px] text-[var(--muted)] italic">Tidak ada entri blocklist kustom.</span>
              ) : (
                blocklist.map((item) => (
                  <span
                    key={item}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[6px] text-xs font-mono font-medium bg-red-500/10 text-red-700 dark:text-red-300 border border-red-500/20"
                  >
                    <span>{item}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveBlock(item)}
                      className="hover:text-red-600 cursor-pointer transition-colors"
                      title={`Hapus ${item}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))
              )}
            </div>

            {/* Input + Add button */}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Tambah target blocklist (contoh: 194.233.78.169)"
                value={newBlockItem}
                onChange={(e) => setNewBlockItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddBlock();
                  }
                }}
                className="flex-1 h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] text-xs font-mono outline-none focus:border-[var(--accent)] transition-colors"
              />
              <Button type="button" size="sm" variant="secondary" onClick={handleAddBlock} disabled={!newBlockItem.trim()}>
                <Plus className="w-3.5 h-3.5 mr-1" />
                Tambah
              </Button>
            </div>
          </div>

          {/* Action Row */}
          <div className="flex items-center justify-between pt-3 border-t border-[var(--border)]">
            <Button type="button" size="sm" variant="outline" onClick={handleReset} disabled={saving}>
              <RotateCcw className="w-3.5 h-3.5 mr-1 text-[var(--muted)]" />
              Reset Default
            </Button>

            <div className="flex items-center gap-3">
              <span className="text-[11px] text-[var(--muted)]">
                {isDirty ? "Ada perubahan belum disimpan" : "Tersinkron dengan config/network-rules.json"}
              </span>
              <Button type="button" size="sm" onClick={handleSave} disabled={!isDirty || saving}>
                {saving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    Menyimpan...
                  </>
                ) : (
                  "Simpan Aturan Jaringan"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
