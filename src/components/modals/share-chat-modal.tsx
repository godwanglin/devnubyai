"use client";

import React, { useState } from "react";
import { Check, Copy, ExternalLink, Link2, Link2Off } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";

export interface ShareChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatId: string | null;
  shareToken: string | null;
  onShareTokenChange: (token: string | null) => void;
}

export function ShareChatModal({
  isOpen,
  onClose,
  chatId,
  shareToken,
  onShareTokenChange,
}: ShareChatModalProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [copied, setCopied] = useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const shareUrl = shareToken ? `${origin}/share/${shareToken}` : "";

  async function copyToClipboard(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback ignored if clipboard blocked
    }
  }

  async function handleCreateShare() {
    if (!chatId || creating) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/v1/chats/${chatId}/share`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Failed");
      const json = await res.json();
      const token: string | undefined = json?.data?.shareToken;
      if (!token) throw new Error("Missing token");

      onShareTokenChange(token);
      const url = `${window.location.origin}/share/${token}`;
      await copyToClipboard(url);
      toast(t("toast.shareCreated"));
    } catch {
      toast(t("toast.actionFailed"));
    } finally {
      setCreating(false);
    }
  }

  async function handleRevokeShare() {
    if (!chatId || revoking) return;
    setRevoking(true);
    try {
      const res = await fetch(`/api/v1/chats/${chatId}/share`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Failed");
      onShareTokenChange(null);
      toast(t("toast.shareRevoked"));
    } catch {
      toast(t("toast.actionFailed"));
    } finally {
      setRevoking(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!creating && !revoking) onClose();
      }}
      title={t("shareModal.title")}
      description={
        shareToken
          ? t("shareModal.descriptionShared")
          : t("shareModal.descriptionPrivate")
      }
      maxWidth="md"
    >
      {!shareToken ? (
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={creating}>
            {t("chatModals.cancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleCreateShare}
            disabled={creating || !chatId}
          >
            <Link2 className="w-3.5 h-3.5" />
            <span>{creating ? t("shareModal.creating") : t("shareModal.createLink")}</span>
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono text-xs"
            />
            <Button
              variant="primary"
              size="md"
              onClick={async () => {
                await copyToClipboard(shareUrl);
                toast(t("toast.linkCopied"));
              }}
              className="shrink-0"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? t("shareModal.copied") : t("shareModal.copyLink")}</span>
            </Button>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <Button
              variant="danger"
              size="sm"
              onClick={handleRevokeShare}
              disabled={revoking}
              className="bg-red-500/10 border border-red-500/20 hover:bg-red-500/20"
            >
              <Link2Off className="w-3.5 h-3.5" />
              <span>{revoking ? t("shareModal.revoking") : t("shareModal.revokeLink")}</span>
            </Button>

            <a
              href={shareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 h-8 rounded-[var(--radius-sm)] text-[13px] font-medium text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors"
            >
              <span>{t("shareModal.openLink")}</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      )}
    </Modal>
  );
}
