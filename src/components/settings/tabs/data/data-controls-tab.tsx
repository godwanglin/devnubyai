"use client";

import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { cn } from "@/lib/cn";
import { ConfirmModal } from "@/components/modals/confirm-modal";
import { SharedLinksModal } from "./shared-links-modal";
import { ExportDataModal } from "./export-data-modal";
import { ArchivedChatsTab } from "../archived-chats-tab";

export interface DataControlsTabProps {
  currentSubView?: "main" | "archived";
  onSubViewChange?: (sub: "main" | "archived") => void;
}

export function DataControlsTab({
  currentSubView = "main",
  onSubViewChange,
}: DataControlsTabProps) {
  const { t } = useI18n();
  const { toast } = useToast();

  const [internalSubView, setInternalSubView] = useState<"main" | "archived">("main");
  const effectiveSubView = currentSubView ?? internalSubView;

  const handleSubViewChange = (sub: "main" | "archived") => {
    if (onSubViewChange) {
      onSubViewChange(sub);
    } else {
      setInternalSubView(sub);
    }
  };

  // State
  const [locationEnabled, setLocationEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("devnuby_device_location_enabled") === "true";
    } catch {
      return false;
    }
  });
  const [requestingLocation, setRequestingLocation] = useState(false);

  // Modals state
  const [showSharedLinksModal, setShowSharedLinksModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showArchiveAllConfirm, setShowArchiveAllConfirm] = useState(false);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);

  // Loading states
  const [archivingAll, setArchivingAll] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);

  // Handle Location Permission
  const handleToggleLocation = () => {
    if (locationEnabled) {
      setLocationEnabled(false);
      try {
        localStorage.removeItem("devnuby_device_location_enabled");
        localStorage.removeItem("devnuby_device_coords");
      } catch {
        // ignore
      }
      toast("Izin lokasi perangkat dinonaktifkan");
      return;
    }

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast("Browser Anda tidak mendukung geolokasi");
      return;
    }

    setRequestingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocationEnabled(true);
        setRequestingLocation(false);
        const coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        try {
          localStorage.setItem("devnuby_device_location_enabled", "true");
          localStorage.setItem("devnuby_device_coords", JSON.stringify(coords));
        } catch {
          // ignore
        }
        toast("Izin lokasi berhasil diaktifkan");
      },
      (err) => {
        setRequestingLocation(false);
        if (err.code === err.PERMISSION_DENIED) {
          toast("Izin lokasi ditolak di browser. Aktifkan izin pada pengaturan browser.");
        } else {
          toast("Gagal mendapatkan lokasi perangkat.");
        }
      },
      { timeout: 10000, enableHighAccuracy: false }
    );
  };

  // Handle Archive All Chats
  const handleArchiveAll = async () => {
    try {
      setArchivingAll(true);
      const res = await fetch("/api/v1/user/chats/archive-all", { method: "POST" });
      if (res.ok) {
        toast("Semua obrolan aktif berhasil diarsipkan");
        setShowArchiveAllConfirm(false);
        window.location.reload();
      } else {
        toast("Gagal mengarsipkan obrolan");
      }
    } catch {
      toast("Terjadi kesalahan jaringan");
    } finally {
      setArchivingAll(false);
    }
  };

  // Handle Delete All Chats
  const handleDeleteAll = async () => {
    try {
      setDeletingAll(true);
      const res = await fetch("/api/v1/user/clear-history", { method: "POST" });
      if (res.ok) {
        toast("Semua obrolan berhasil dihapus secara permanen");
        setShowDeleteAllConfirm(false);
        window.location.reload();
      } else {
        toast("Gagal menghapus obrolan");
      }
    } catch {
      toast("Terjadi kesalahan jaringan");
    } finally {
      setDeletingAll(false);
    }
  };

  if (effectiveSubView === "archived") {
    return <ArchivedChatsTab onBack={() => handleSubViewChange("main")} />;
  }

  return (
    <div className="w-full">
      {/* Title & Description */}
      <div>
        <h2 className="text-lg font-semibold text-[var(--ink)]">
          {t("settings.dataControlsTab")}
        </h2>
        <p className="text-xs text-[var(--muted)] mt-1 mb-5 leading-relaxed">
          {t("settings.dataControlsDesc")}
        </p>
      </div>

      {/* SECTION 1: Preferensi / Preferences */}
      <div>
        <h3 className="text-sm font-semibold text-[var(--ink)] mb-1">
          {t("settings.dataSectionPrefs")}
        </h3>

        {/* 1. Lokasi */}
        <div className="py-3 flex items-center justify-between gap-4 border-b border-[var(--border)]/35">
          <div className="min-w-0 flex-1 pr-2">
            <p className="text-sm font-medium text-[var(--ink)]">{t("settings.locationMeta")}</p>
            <p className="text-xs text-[var(--muted)] mt-0.5 leading-relaxed">
              {t("settings.locationMetaDesc")}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {requestingLocation && <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent)]" />}
            <button
              type="button"
              role="switch"
              aria-checked={locationEnabled}
              onClick={handleToggleLocation}
              disabled={requestingLocation}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50",
                locationEnabled ? "bg-[#2563eb]" : "bg-[var(--border)]"
              )}
              aria-label={t("settings.locationMeta")}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out",
                  locationEnabled ? "translate-x-4" : "translate-x-0"
                )}
              />
            </button>
          </div>
        </div>
      </div>

      {/* SECTION 2: Data Anda / Your Data */}
      <div className="mt-8">
        <h3 className="text-sm font-semibold text-[var(--ink)] mb-1">
          {t("settings.dataSectionYourData")}
        </h3>

        {/* 1. Ekspor data */}
        <div className="py-3 flex items-center justify-between gap-4 border-b border-[var(--border)]/35">
          <div className="min-w-0 flex-1 pr-2">
            <p className="text-sm font-medium text-[var(--ink)]">{t("settings.exportData")}</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              {t("settings.exportDataDesc")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowExportModal(true)}
            className="px-3 py-1 text-xs font-medium rounded-lg bg-[var(--surface-hover)] hover:bg-[var(--surface-active)] text-[var(--ink)] border border-[var(--border)]/50 transition-colors cursor-pointer shrink-0"
          >
            {t("settings.exportDataBtn")}
          </button>
        </div>

        {/* 2. Tautan yang dibagikan */}
        <div className="py-3 flex items-center justify-between gap-4 border-b border-[var(--border)]/35">
          <div className="min-w-0 flex-1 pr-2">
            <p className="text-sm font-medium text-[var(--ink)]">{t("settings.sharedLinks")}</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              {t("settings.sharedLinksDesc")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowSharedLinksModal(true)}
            className="px-3 py-1 text-xs font-medium rounded-lg bg-[var(--surface-hover)] hover:bg-[var(--surface-active)] text-[var(--ink)] border border-[var(--border)]/50 transition-colors cursor-pointer shrink-0"
          >
            {t("settings.manage")}
          </button>
        </div>

        {/* 3. Obrolan yang diarsipkan */}
        <div className="py-3 flex items-center justify-between gap-4 border-b border-[var(--border)]/35">
          <div className="min-w-0 flex-1 pr-2">
            <p className="text-sm font-medium text-[var(--ink)]">{t("settings.archivedChats")}</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              {t("settings.archivedChatsDesc")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleSubViewChange("archived")}
            className="px-3 py-1 text-xs font-medium rounded-lg bg-[var(--surface-hover)] hover:bg-[var(--surface-active)] text-[var(--ink)] border border-[var(--border)]/50 transition-colors cursor-pointer shrink-0"
          >
            {t("settings.manage")}
          </button>
        </div>

        {/* 4. Arsipkan semua obrolan */}
        <div className="py-3 flex items-center justify-between gap-4 border-b border-[var(--border)]/35">
          <div className="min-w-0 flex-1 pr-2">
            <p className="text-sm font-medium text-[var(--ink)]">{t("settings.archiveAll")}</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              {t("settings.archiveAllDesc")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowArchiveAllConfirm(true)}
            className="px-3 py-1 text-xs font-medium rounded-lg bg-[var(--surface-hover)] hover:bg-[var(--surface-active)] text-[var(--ink)] border border-[var(--border)]/50 transition-colors cursor-pointer shrink-0"
          >
            {t("settings.archiveAllBtn")}
          </button>
        </div>

        {/* 5. Hapus semua obrolan */}
        <div className="py-3 flex items-center justify-between gap-4 border-b border-[var(--border)]/35">
          <div className="min-w-0 flex-1 pr-2">
            <p className="text-sm font-medium text-[var(--ink)]">{t("settings.deleteAll")}</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              {t("settings.deleteAllDesc")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowDeleteAllConfirm(true)}
            className="px-3 py-1 text-xs font-medium rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-colors cursor-pointer shrink-0"
          >
            {t("settings.deleteAllBtn")}
          </button>
        </div>
      </div>

      {/* Modals */}
      <SharedLinksModal
        isOpen={showSharedLinksModal}
        onClose={() => setShowSharedLinksModal(false)}
      />

      <ExportDataModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
      />

      {/* Confirm Archive All */}
      <ConfirmModal
        isOpen={showArchiveAllConfirm}
        onClose={() => setShowArchiveAllConfirm(false)}
        onConfirm={handleArchiveAll}
        title="Arsipkan Semua Obrolan?"
        description="Semua percakapan aktif Anda akan dipindahkan ke daftar arsip dan disembunyikan dari bilah samping."
        confirmLabel="Arsipkan Semua"
        cancelLabel="Batal"
        variant="primary"
        loading={archivingAll}
      />

      {/* Confirm Delete All */}
      <ConfirmModal
        isOpen={showDeleteAllConfirm}
        onClose={() => setShowDeleteAllConfirm(false)}
        onConfirm={handleDeleteAll}
        title="Hapus Semua Obrolan?"
        description="Tindakan ini tidak dapat dibatalkan. Semua riwayat percakapan dan pesan Anda akan dihapus secara permanen."
        confirmLabel="Ya, Hapus Semua"
        cancelLabel="Batal"
        variant="danger"
        loading={deletingAll}
      />
    </div>
  );
}
