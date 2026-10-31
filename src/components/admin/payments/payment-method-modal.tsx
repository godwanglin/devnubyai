"use client";

import React, { useState, useEffect, useRef } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/providers/toast-provider";
import { UploadCloud, Image as ImageIcon, Loader2, X } from "lucide-react";
import type { PaymentMethodItem, PaymentMethodCategory, PaymentFlowType } from "@/lib/payments/types";
import { resolveAssetUrl } from "@/lib/storage/assets";
import { SmartImage } from "@/components/ui/smart-image";

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

  const [uploadingImage, setUploadingImage] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      if (method) {
        setName(method.name);
        setCode(method.code);
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
        // User rule: simpan path relative saja, jangan full domain!
        setImagePath(json.data.path);
        toast("Gambar berhasil di-upload ke R2");
      } else {
        toast(json?.error?.message || "Gagal meng-upload gambar");
      }
    } catch {
      toast("Terjadi kesalahan saat upload gambar");
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !code.trim()) {
      toast("Nama dan kode wajib diisi");
      return;
    }

    try {
      setSaving(true);
      const payload = {
        name: name.trim(),
        code: code.trim().toLowerCase(),
        category,
        dokuCode: dokuCode.trim() || null,
        flowType,
        imagePath: imagePath.trim() || null,
        description: description.trim() || null,
        instructions: instructions.trim() || null,
        minAmount: Number(minAmount),
        maxAmount: maxAmount !== "" ? Number(maxAmount) : null,
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
              placeholder="Contoh: bri, bca, qris"
              className="w-full px-3 py-2 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] font-mono focus:outline-hidden focus:border-[var(--accent)]"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-[var(--muted)] font-medium mb-1">Kategori</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as PaymentMethodCategory)}
              className="w-full px-2.5 py-2 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] focus:outline-hidden"
            >
              <option value="virtual_account">Virtual Account</option>
              <option value="qris">QRIS</option>
              <option value="ewallet">E-Wallet</option>
              <option value="retail">Convenience Store</option>
              <option value="card">Kartu Kredit / Debit</option>
            </select>
          </div>

          <div>
            <label className="block text-[var(--muted)] font-medium mb-1">Alur Pembayaran (Flow)</label>
            <select
              value={flowType}
              onChange={(e) => setFlowType(e.target.value as PaymentFlowType)}
              className="w-full px-2.5 py-2 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] focus:outline-hidden"
            >
              <option value="direct">Direct (Tampil Kode/VA di UI)</option>
              <option value="checkout">Checkout (Redirect DOKU)</option>
            </select>
          </div>

          <div>
            <label className="block text-[var(--muted)] font-medium mb-1">DOKU Channel Code</label>
            <input
              type="text"
              value={dokuCode}
              onChange={(e) => setDokuCode(e.target.value)}
              placeholder="Contoh: VIRTUAL_ACCOUNT_BRI"
              className="w-full px-3 py-2 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] font-mono focus:outline-hidden"
            />
          </div>
        </div>

        {/* Upload Gambar ke R2 */}
        <div className="p-3 rounded-[10px] bg-[var(--surface)] border border-[var(--border)] space-y-2">
          <label className="block text-[var(--ink)] font-medium">
            Logo / Gambar Metode
          </label>
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
                placeholder="Atau masukkan path / URL gambar..."
                className="w-full px-2.5 py-1.5 rounded-[6px] bg-[var(--panel)] border border-[var(--border)] font-mono text-[11px] text-[var(--ink)]"
              />
              <p className="text-[10px] text-[var(--muted)]">
                Tersimpan di DB sebagai path relatif R2: <code className="font-mono text-emerald-600 dark:text-emerald-400">{imagePath || "belum ada"}</code>
              </p>
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
