"use client";

import React from "react";
import { Check, Copy, RefreshCw, ThumbsDown, ThumbsUp, Volume2 } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";

interface AssistantMessageActionsProps {
  copied: boolean;
  onCopy: () => void;
  onRegenerate?: () => void;
  /** Feedback buttons only show inside a saved chat */
  showFeedback: boolean;
  feedback: "like" | "dislike" | null;
  onFeedback: (type: "like" | "dislike") => void;
  formattedTime: string;
}

const iconButton =
  "grid place-items-center w-7 h-7 rounded-[6px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer";

/** Action bar under a finished assistant reply: copy, read aloud, regenerate, like/dislike, time. */
export function AssistantMessageActions({
  copied,
  onCopy,
  onRegenerate,
  showFeedback,
  feedback,
  onFeedback,
  formattedTime,
}: AssistantMessageActionsProps) {
  const { t } = useI18n();
  const { toast } = useToast();

  const feedbackButton = (type: "like" | "dislike") => {
    const active = feedback === type;
    const Icon = type === "like" ? ThumbsUp : ThumbsDown;
    const label = t(type === "like" ? "message.like" : "message.dislike");
    return (
      <Tooltip content={label} side="top">
        <button
          type="button"
          aria-pressed={active}
          onClick={() => onFeedback(type)}
          className={cn(
            "grid place-items-center w-7 h-7 rounded-[6px] transition-colors cursor-pointer",
            active
              ? "text-[var(--ink)] bg-[var(--accent-soft)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
              : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
          )}
          aria-label={label}
        >
          <Icon className={cn("w-3.5 h-3.5", active && "fill-current")} />
        </button>
      </Tooltip>
    );
  };

  return (
    <div className="flex items-center gap-2 mt-2.5 animate-fade-in">
      <div className="flex items-center gap-0.5">
        <Tooltip content={copied ? t("message.copied") : t("message.copy")} side="top">
          <button
            type="button"
            onClick={onCopy}
            className={cn(iconButton, copied && "text-[var(--accent)]")}
            aria-label={copied ? t("message.copied") : t("message.copy")}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </Tooltip>
        <Tooltip content={t("message.readAloud")} side="top">
          <button
            type="button"
            onClick={() => toast(t("toast.featureUnavailable"))}
            className={iconButton}
            aria-label={t("message.readAloud")}
          >
            <Volume2 className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
        {onRegenerate ? (
          <Tooltip content={t("message.regenerate")} side="top">
            <button type="button" onClick={onRegenerate} className={iconButton} aria-label={t("message.regenerate")}>
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        ) : null}
        {showFeedback ? (
          <>
            <span className="w-px h-3.5 bg-[var(--border)] mx-1" aria-hidden="true" />
            {feedbackButton("like")}
            {feedbackButton("dislike")}
          </>
        ) : null}
      </div>
      {formattedTime ? (
        <span className="text-[11px] text-[var(--muted)] select-none px-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {formattedTime}
        </span>
      ) : null}
    </div>
  );
}
