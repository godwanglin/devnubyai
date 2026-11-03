"use client";

import React, { useState, useEffect, useRef } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/providers/toast-provider";
import { UploadCloud, Image as ImageIcon, Loader2, X, RefreshCw } from "lucide-react";
import type {
  PaymentMethodItem,
  PaymentMethodCategory,
  PaymentFlowType,
  PaymentProvider,
} from "@/lib/payments/types";
import { resolveAssetUrl } from "@/lib/storage/assets";
import { SmartImage } from "@/components/ui/smart-image";
import { CustomSelect, type CustomSelectOption } from "@/components/ui/custom-select";
import type { TripayChannelOption } from "@/lib/tripay/channels";

const PROVIDER_OPTIONS: CustomSelectOption<PaymentProvider>[] = [
  { value: "tripay", label: "Tripay (Utama)", sublabel: "VA, E-Wallet & QRIS" },
  { value: "doku", label: "DOKU (Cadangan)", sublabel: "VA, QRIS, Checkout" },
];

const CATEGORY_OPTIONS: CustomSelectOption<PaymentMethodCategory>[] = [
  { value: "virtual_account", label: "Virtual Account" },
  { value: "qris", label: "QRIS" },
  { value: "ewallet", label: "E-Wallet" },
  { value: "retail", label: "Convenience Store" },
  { value: "card", label: "Kartu Kredit / Debit" },
];

const FLOW_OPTIONS: CustomSelectOption<PaymentFlowType>[] = [
  { value: "direct", label: "Direct", sublabel: "Tampil Kode/VA/QR di UI" },
  { value: "checkout", label: "Checkout", sublabel: "Redirect Hosted Page" },
];

interface PaymentMethodModalProps {
  isOpen: boolean;
  onClose: () => void;
  method?: PaymentMethodItem | null;
  onSaved: () => void;
}

export function PaymentMethodModal({
  isOpen,
  onClose,
  method,
  onSaved,
}: PaymentMethodModalProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [provider, setProvider] = useState<PaymentProvider>("tripay");
  const [category, setCategory] = useState<PaymentMethodCategory>("virtual_account");
  const [dokuCode, setDokuCode] = useState("");
  const [flowType, setFlowType] = useState<PaymentFlowType>("direct");
  const [imagePath, setImagePath] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [minAmount, setMinAmount] = useState(1000);
  const [maxAmount, setMaxAmount] = useState<number | "">("");
  const [sortOrder, setSortOrder] = useState(100);
  const [isActive, setIsActive] = useState(true);

  // Live Tripay channels fetched from backend
  const [tripayChannels, setTripayChannels] = useState<TripayChannelOption[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);

  const [uploadingImage, setUploadingImage] = useState(false);
  const [saving, setSaving] = useState(false);

  const isTripay = provider === "tripay";

  // Load Tripay channels whenever modal is open
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setLoadingChannels(true);

    fetch("/api/v1/admin/settings/payment/tripay")
      .then((res) => res.json())
      .then((json) => {
        if (!active) return;
        const list = json?.data?.channels;
        if (Array.isArray(list)) {
          setTripayChannels(list);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingChannels(false);
      });

    return () => {
      active = false;
    };
  }, [isOpen]);

  async function handleRefreshChannels() {
    try {
      setLoadingChannels(true);
      const res = await fetch("/api/v1/admin/settings/payment/tripay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh_channels" }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && Array.isArray(json?.data?.details?.channels)) {
        setTripayChannels(json.data.details.channels);
        toast("Daftar channel Tripay berhasil diperbarui dari API");
      } else {
        toast(json?.error?.message || "Gagal menyegarkan channel Tripay");
      }
    } catch {
      toast("Kesalahan jaringan");
    } finally {
      setLoadingChannels(false);
    }
  }

  function handleTripayChannelSelect(channelCode: string) {
    setDokuCode(channelCode);
    const found = tripayChannels.find((c) => c.code === channelCode);
    if (!found) return;

    // Auto-fill metadata from live channel if this is a new method or fields are blank
    if (!method) {
      if (!name) setName(found.name);
      if (!code) setCode(found.code.toLowerCase().replace(/[^a-z0-9_-]/g, ""));
      if (!description) {
        setDescription(`Bayar via ${found.name} (${found.group})`);
      }
      if (found.minAmount) setMinAmount(found.minAmount);
      if (found.maxAmount) setMaxAmount(found.maxAmount);
      if (!imagePath && found.iconUrl) setImagePath(found.iconUrl);
    }
    setCategory(found.category);
    setFlowType(found.flowType);
  }

  function handleProviderChange(next: PaymentProvider) {
    setProvider(next);
    if (next === "tripay") {
      if (tripayChannels.length > 0) {
        const fallback = tripayChannels[0];
        handleTripayChannelSelect(fallback.code);
      } else {
        setCategory("qris");
        setFlowType("direct");
        setDokuCode("QRIS2");
      }
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      if (method) {
        setName(method.name);
        setCode(method.code);
        setProvider(method.provider);
        setCategory(method.category);
        setDokuCode(method.dokuCode || "");
        setFlowType(method.flowType);
        setImagePath(method.imagePath || "");
        setDescription(method.description || "");
        setInstructions(method.instructions || "");
        setMinAmount(method.minAmount || 1000);
        setMaxAmount(method.maxAmount ?? "");
        setSortOrder(method.sortOrder ?? 100);
        setIsActive(method.isActive);
      } else {
        setName("");
        setCode("");
        setProvider("tripay");
        setCategory("virtual_account");
        setDokuCode("");
        setFlowType("direct");
        setImagePath("");
        setDescription("");
        setInstructions("");
        setMinAmount(1000);
        setMaxAmount("");
        setSortOrder(100);
        setIsActive(true);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [method, isOpen]);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast("Harap pilih file gambar (PNG, JPG, WebP, SVG)");
      return;
    }

    try {
      setUploadingImage(true);
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/v1/admin/payment-methods/upload", {
        method: "POST",
        body: formData,
      });

      const json = await res.json().catch(() => null);
      if (res.ok && json?.data?.path) {
        setImagePath(json.data.path);
        toast("Gambar berhasil di-upload ke R2");
      } else {
        toast(json?.error?.message || "Gagal meng-upload gambar");
      }
    } catch {
      toast("Terjadi kesalahan saat meng-upload gambar");
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !code.trim()) {
      toast("Nama dan Kode metode wajib diisi");
      return;
    }

    if (isTripay && !dokuCode.trim()) {
      toast("Pilih channel code Tripay terlebih dahulu");
      return;
    }

    try {
      setSaving(true);
      const payload = {
        name: name.trim(),
        code: code.trim(),
        provider,
        category,
        dokuCode: dokuCode.trim() || null,
        flowType,
        imagePath: imagePath.trim() || null,
        description: description.trim() || null,
        instructions: instructions.trim() || null,
        minAmount: Number(minAmount),
        maxAmount: maxAmount === "" ? null : Number(maxAmount),
        sortOrder: Number(sortOrder),
        isActive,
      };

      const url = method
        ? `/api/v1/admin/payment-methods/${method.publicId}`
        : "/api/v1/admin/payment-methods";
      const res = await fetch(url, {
        method: method ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => null);
      if (res.ok && json?.data?.method) {
        toast(method ? "Metode pembayaran diperbarui" : "Metode pembayaran berhasil ditambahkan");
        onSaved();
        onClose();
      } else {
        toast(json?.error?.message || "Gagal menyimpan metode pembayaran");
      }
    } catch {
      toast("Terjadi kesalahan saat menyimpan data");
    } finally {
      setSaving(false);
    }
  }

  const tripaySelectOptions: CustomSelectOption<string>[] = tripayChannels.map((c) => ({
    value: c.code,
    label: `${c.name} (${c.code})`,
    sublabel: `${c.group} • ${c.type === "direct" ? "Langsung (Kode/QR)" : "Redirect"} • ${c.active ? "Aktif" : "Nonaktif"}`,
  }));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={method ? "Edit Metode Pembayaran" : "Tambah Metode Pembayaran"}
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[var(--muted)] font-medium mb-1">
              Sumber (Payment Gateway)
            </label>
            <CustomSelect<PaymentProvider>
              options={PROVIDER_OPTIONS}
              value={provider}
              onChange={handleProviderChange}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[var(--muted)] font-medium">
                {isTripay ? "Channel Tripay (Live)" : "DOKU Channel Code"}
              </label>
              {isTripay && (
                <button
                  type="button"
                  onClick={handleRefreshChannels}
                  disabled={loadingChannels}
                  className="text-[10px] text-[var(--accent)] hover:underline inline-flex items-center gap-1 cursor-pointer"
                  title="Ambil ulang daftar channel dari Tripay API"
                >
                  <RefreshCw className={`w-2.5 h-2.5 ${loadingChannels ? "animate-spin" : ""}`} />
                  Sinkron Tripay
                </button>
              )}
            </div>

            {isTripay ? (
              tripayChannels.length > 0 ? (
                <CustomSelect<string>
                  options={tripaySelectOptions}
                  value={dokuCode || (tripayChannels[0]?.code ?? "")}
                  onChange={handleTripayChannelSelect}
                  searchable
                />
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={dokuCode}
                    onChange={(e) => setDokuCode(e.target.value.toUpperCase())}
                    placeholder="Contoh: BRIVA, BCAVA, QRIS2, DANA"
                    className="w-full px-3 py-2 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] font-mono focus:outline-hidden"
                  />
                  {loadingChannels && <Loader2 className="w-4 h-4 animate-spin text-[var(--muted)]" />}
                </div>
              )
            ) : (
              <input
                type="text"
                value={dokuCode}
                onChange={(e) => setDokuCode(e.target.value)}
                placeholder="Contoh: VIRTUAL_ACCOUNT_BRI"
                className="w-full px-3 py-2 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] font-mono focus:outline-hidden"
              />
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[var(--muted)] font-medium mb-1">
              Nama Metode <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contoh: BRI Virtual Account"
              className="w-full px-3 py-2 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] focus:outline-hidden focus:border-[var(--accent)]"
            />
          </div>

          <div>
            <label className="block text-[var(--muted)] font-medium mb-1">
              Kode Unik (Slug) <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
              placeholder="Contoh: briva, bcava, dana, qris"
              className="w-full px-3 py-2 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] font-mono focus:outline-hidden focus:border-[var(--accent)]"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[var(--muted)] font-medium mb-1">Kategori</label>
            <CustomSelect<PaymentMethodCategory>
              options={CATEGORY_OPTIONS}
              value={category}
              onChange={setCategory}
              disabled={isTripay}
            />
            {isTripay && (
              <span className="text-[10px] text-[var(--muted)] block mt-1">
                Kategori Tripay disesuaikan otomatis dari jenis channel.
              </span>
            )}
          </div>

          <div>
            <label className="block text-[var(--muted)] font-medium mb-1">Alur Pembayaran (Flow)</label>
            <CustomSelect<PaymentFlowType>
              options={FLOW_OPTIONS}
              value={flowType}
              onChange={setFlowType}
              disabled={isTripay}
            />
            {isTripay && (
              <span className="text-[10px] text-[var(--muted)] block mt-1">
                Alur Tripay: direct (kode bayar / QRIS di web), checkout (redirect DANA / ShopeePay).
              </span>
            )}
          </div>
        </div>

        {/* Upload Gambar ke R2 / Icon URL */}
        <div className="p-3 rounded-[10px] bg-[var(--surface)] border border-[var(--border)] space-y-2">
          <label className="block text-[var(--ink)] font-medium">Logo / Gambar Metode</label>
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="w-14 h-14 rounded-[8px] border border-[var(--border)] bg-[var(--panel)] flex items-center justify-center overflow-hidden shrink-0">
              {imagePath ? (
                <SmartImage
                  src={resolveAssetUrl(imagePath)}
                  alt="Preview"
                  loaderSize="sm"
                  containerClassName="w-full h-full bg-transparent border-0"
                  imgClassName="w-full h-full object-contain p-1"
                />
              ) : (
                <ImageIcon className="w-6 h-6 text-[var(--muted)]" />
              )}
            </div>

            <div className="flex-1 w-full space-y-1.5">
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={uploadingImage}
                  onClick={() => fileInputRef.current?.click()}
                  className="border border-[var(--border)] gap-1.5 text-xs"
                >
                  {uploadingImage ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <UploadCloud className="w-3.5 h-3.5" />
                  )}
                  {uploadingImage ? "Mengupload..." : "Upload Gambar ke R2"}
                </Button>
                {imagePath && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setImagePath("")}
                    className="text-red-500 hover:text-red-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
              <input
                type="text"
                value={imagePath}
                onChange={(e) => setImagePath(e.target.value)}
                placeholder="Atau masukkan path R2 / URL icon..."
                className="w-full px-2.5 py-1.5 rounded-[6px] bg-[var(--panel)] border border-[var(--border)] font-mono text-[11px] text-[var(--ink)]"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-[var(--muted)] font-medium mb-1">Nominal Minimal (IDR)</label>
            <input
              type="number"
              min="1000"
              value={minAmount}
              onChange={(e) => setMinAmount(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] focus:outline-hidden"
            />
          </div>

          <div>
            <label className="block text-[var(--muted)] font-medium mb-1">Nominal Maksimal (Opsional)</label>
            <input
              type="number"
              value={maxAmount}
              onChange={(e) => setMaxAmount(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder="Tanpa batas"
              className="w-full px-3 py-2 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] focus:outline-hidden"
            />
          </div>

          <div>
            <label className="block text-[var(--muted)] font-medium mb-1">Urutan Tampil (Sort)</label>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] focus:outline-hidden"
            />
          </div>
        </div>

        <div>
          <label className="block text-[var(--muted)] font-medium mb-1">Deskripsi Singkat</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Contoh: Bayar instan via Virtual Account Bank BRI / BRImo"
            className="w-full px-3 py-2 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] focus:outline-hidden"
          />
        </div>

        <div>
          <label className="block text-[var(--muted)] font-medium mb-1">Instruksi Cara Bayar (Opsional)</label>
          <textarea
            rows={2}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Panduan cara transfer via ATM / Mobile Banking..."
            className="w-full px-3 py-2 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] focus:outline-hidden resize-none"
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <input
            type="checkbox"
            id="is_active_toggle"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)] w-4 h-4 cursor-pointer"
          />
          <label htmlFor="is_active_toggle" className="text-xs text-[var(--ink)] font-medium cursor-pointer select-none">
            Aktifkan metode pembayaran ini sekarang
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" variant="primary" disabled={saving} className="gap-1.5">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {method ? "Simpan Perubahan" : "Tambah Metode"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
