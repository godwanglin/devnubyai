"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Link2, Copy, Check, Trash2, RefreshCw, ExternalLink } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/providers/toast-provider";
import { ConfirmModal } from "@/components/modals/confirm-modal";

interface SharedLinkItem {
  id: string;
  title: string;
  shareToken: string;
  sharedAt: string;
  url: string;
}

interface SharedLinksModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SharedLinksModal({ isOpen, onClose }: SharedLinksModalProps) {
  const { toast } = useToast();
  const [links, setLinks] = useState<SharedLinkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [targetRevokeToken, setTargetRevokeToken] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [showRevokeAllConfirm, setShowRevokeAllConfirm] = useState(false);

  const loadLinks = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/user/shared-links");
      if (res.ok) {
        const json = await res.json();
        setLinks(json.data?.links || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    fetch("/api/v1/user/shared-links", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        setLinks(json?.data?.links || []);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [isOpen]);

  const handleCopy = (token: string) => {
    const fullUrl = `${window.location.origin}/share/${token}`;
    navigator.clipboard.writeText(fullUrl);
    setCopiedToken(token);
    toast("Tautan berhasil disalin ke papan klip");
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const handleRevokeSingle = async () => {
    if (!targetRevokeToken) return;
    try {
      setRevoking(true);
      const res = await fetch(`/api/v1/user/shared-links?token=${targetRevokeToken}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast("Tautan yang dibagikan berhasil dicabut");
        setTargetRevokeToken(null);
        await loadLinks();
      } else {
        toast("Gagal mencabut tautan");
      }
    } catch {
      toast("Terjadi kesalahan jaringan");
    } finally {
      setRevoking(false);
    }
  };

  const handleRevokeAll = async () => {
    try {
      setRevoking(true);
      const res = await fetch("/api/v1/user/shared-links?all=true", {
        method: "DELETE",
      });
      if (res.ok) {
        toast("Semua tautan yang dibagikan telah dicabut");
        setShowRevokeAllConfirm(false);
        await loadLinks();
      } else {
        toast("Gagal mencabut semua tautan");
      }
    } catch {
      toast("Terjadi kesalahan jaringan");
    } finally {
      setRevoking(false);
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Tautan yang Dibagikan"
        description="Kelola percakapan yang tautan publiknya telah Anda buat. Siapa pun dengan tautan ini sebelumnya dapat melihat obrolan tersebut."
        maxWidth="lg"
      >
        <div className="space-y-4 pt-2">
          {links.length > 0 && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowRevokeAllConfirm(true)}
                className="px-3 py-1.5 rounded-[8px] bg-red-500/10 hover:bg-red-500/20 text-red-500 text-xs font-semibold transition-colors cursor-pointer"
              >
                Hapus Semua Tautan
              </button>
            </div>
          )}

          <div className="max-h-[380px] overflow-y-auto space-y-2">
            {loading ? (
              <div className="py-12 text-center text-xs text-[var(--muted)] flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-[var(--muted)]" />
                <span>Memuat tautan...</span>
              </div>
            ) : links.length === 0 ? (
              <div className="p-8 text-center text-xs text-[var(--muted)] rounded-[12px] border border-[var(--border)] bg-[var(--panel-elevated)] space-y-1">
                <Link2 className="w-6 h-6 mx-auto text-[var(--muted)]/60 mb-2" />
                <p className="font-semibold text-[var(--ink)]">Belum ada tautan dibagikan</p>
                <p>Saat Anda membagikan percakapan, tautannya akan muncul di sini.</p>
              </div>
            ) : (
              links.map((link) => (
                <div
                  key={link.id}
                  className="p-3 rounded-[10px] border border-[var(--border)] bg-[var(--panel-elevated)] flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--ink)] truncate">
                      {link.title || "Percakapan Tanpa Judul"}
                    </p>
                    <p className="text-xs text-[var(--muted)] mt-0.5">
                      Dibagikan:{" "}
                      {new Date(link.sharedAt).toLocaleDateString("id-ID", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleCopy(link.shareToken)}
                      className="p-1.5 rounded-[6px] hover:bg-[var(--hover)] text-[var(--muted)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                      title="Salin tautan"
                    >
                      {copiedToken === link.shareToken ? (
                        <Check className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1.5 rounded-[6px] hover:bg-[var(--hover)] text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
                      title="Buka tautan publik"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                    <button
                      type="button"
                      onClick={() => setTargetRevokeToken(link.shareToken)}
                      className="p-1.5 rounded-[6px] hover:bg-red-500/10 text-[var(--muted)] hover:text-red-500 transition-colors cursor-pointer"
                      title="Cabut akses tautan"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="flex justify-end pt-2 border-t border-[var(--border)]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-[8px] border border-[var(--border)] hover:bg-[var(--hover)] text-xs font-semibold text-[var(--ink)] transition-colors cursor-pointer"
            >
              Tutup
            </button>
          </div>
        </div>
      </Modal>

      {/* Confirm Revoke Single */}
      <ConfirmModal
        isOpen={Boolean(targetRevokeToken)}
        onClose={() => setTargetRevokeToken(null)}
        onConfirm={handleRevokeSingle}
        title="Hapus Tautan Bersama Ini?"
        description="Siapa pun yang memiliki tautan ini tidak akan dapat lagi melihat percakapan tersebut."
        confirmLabel="Hapus Tautan"
        cancelLabel="Batal"
        variant="danger"
        loading={revoking}
      />

      {/* Confirm Revoke All */}
      <ConfirmModal
        isOpen={showRevokeAllConfirm}
        onClose={() => setShowRevokeAllConfirm(false)}
        onConfirm={handleRevokeAll}
        title="Hapus Semua Tautan Bersama?"
        description="Semua tautan percakapan yang pernah Anda buat akan dinonaktifkan secara permanen."
        confirmLabel="Hapus Semua"
        cancelLabel="Batal"
        variant="danger"
        loading={revoking}
      />
    </>
  );
}
