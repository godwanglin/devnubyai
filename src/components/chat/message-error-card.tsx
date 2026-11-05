"use client";

import React, { useState } from "react";
import { AlertTriangle, Check, Copy } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";

interface MessageErrorCardProps {
  /** The short, safe line the user is allowed to see. */
  message: string;
  /** Lets support find the real trace; omitted on failures from before request ids were stored. */
  requestId?: string | null;
}

/** A failed reply: a red card with the friendly message and the request id, never the trace. */
export function MessageErrorCard({ message, requestId }: MessageErrorCardProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  async function copyRequestId() {
    if (!requestId) return;
    try {
      await navigator.clipboard.writeText(requestId);
      setCopied(true);
      toast(t("message.errorRequestIdCopied"));
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be refused; the id stays visible either way
    }
  }

  return (
    <div
      role="alert"
      className="rounded-[12px] border border-red-500/30 bg-red-500/[0.06] px-4 py-3"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium text-red-400">{t("message.errorTitle")}</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--ink)]">{message}</p>
        </div>
      </div>

      {requestId ? (
        <button
          type="button"
          onClick={() => void copyRequestId()}
          className="mt-2.5 ml-6.5 inline-flex max-w-full items-center gap-1.5 rounded-[7px] border border-red-500/20 bg-red-500/[0.05] px-2 py-1 font-mono text-[11px] text-[var(--muted)] transition-colors hover:text-[var(--ink)] cursor-pointer"
          title={t("message.copy")}
        >
          <span className="shrink-0 text-[var(--muted)]">{t("message.errorRequestId")}</span>
          <span className="truncate">{requestId}</span>
          {copied ? (
            <Check className="h-3 w-3 shrink-0 text-emerald-400" />
          ) : (
            <Copy className="h-3 w-3 shrink-0" />
          )}
        </button>
      ) : null}
    </div>
  );
}
