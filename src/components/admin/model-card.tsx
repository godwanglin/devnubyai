"use client";

import React, { useState } from "react";
import {
  Bot,
  Copy,
  Check,
  FlaskConical,
  X,
  Brain,
  Eye,
  Wrench,
  Image as ImageIcon,
  Video,
  AudioLines,
  FileText,
  Loader2,
} from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import type { ModelCapabilities } from "@/lib/oauth/model-capabilities";

export interface ModelCardItem {
  id: string;
  modelKey: string;
  ownedBy: string | null;
  isAvailable: boolean;
  capabilities: ModelCapabilities;
}

export interface PingFeedback {
  status: "idle" | "running" | "success" | "error";
  latencyMs?: number;
  message?: string;
}

interface ModelCardProps {
  providerId: string;
  model: ModelCardItem;
  pingState?: PingFeedback;
  onPing: (modelKey: string) => void;
  onRequestDelete: (model: ModelCardItem) => void;
}

export function ModelCard({
  providerId,
  model,
  pingState,
  onPing,
  onRequestDelete,
}: ModelCardProps) {
  const [copied, setCopied] = useState(false);
  const fullRef = `${providerId}/${model.modelKey}`;

  function handleCopy() {
    void navigator.clipboard.writeText(fullRef);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const caps = model.capabilities;
  const isPinging = pingState?.status === "running";

  return (
    <div
      className={`group relative rounded-[10px] p-3.5 border transition-all flex flex-col justify-between gap-3 bg-[var(--panel)] ${
        model.isAvailable
          ? "border-[var(--border)] hover:border-[var(--border-strong)]"
          : "border-[var(--border)]/50 opacity-60"
      }`}
    >
      {/* Top row: Bot icon + Pill + Copy button + Hover actions (Ping & Delete) */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-6 h-6 rounded-[6px] bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center shrink-0 text-[var(--muted)]">
            <Bot className="w-3.5 h-3.5" />
          </div>
          <span
            className="font-mono text-[11px] font-medium text-[var(--ink)] truncate"
            title={fullRef}
          >
            {fullRef}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="p-1 rounded text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)] transition-colors cursor-pointer shrink-0"
            title="Copy provider/model"
            aria-label="Copy model reference"
          >
            {copied ? (
              <Check className="w-3 h-3 text-emerald-500" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
          </button>
        </div>

        {/* Hover action icons: Ping (flask) & Delete (x) */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
          <Tooltip content="Ping model inference">
            <button
              type="button"
              onClick={() => onPing(model.modelKey)}
              disabled={isPinging}
              className="p-1 rounded text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)] transition-colors disabled:opacity-50 cursor-pointer"
              aria-label="Ping model"
            >
              {isPinging ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--primary)]" />
              ) : (
                <FlaskConical className="w-3.5 h-3.5" />
              )}
            </button>
          </Tooltip>
          <Tooltip content="Delete model">
            <button
              type="button"
              onClick={() => onRequestDelete(model)}
              className="p-1 rounded text-[var(--muted)] hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
              aria-label="Delete model"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Ping feedback banner if active */}
      {pingState && pingState.status !== "idle" && (
        <div
          className={`text-[10px] px-2 py-1 rounded border flex items-center justify-between gap-2 ${
            pingState.status === "running"
              ? "bg-[var(--surface)] border-[var(--border)] text-[var(--muted)]"
              : pingState.status === "success"
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
              : "bg-red-500/10 border-red-500/20 text-red-500"
          }`}
        >
          <span className="truncate">
            {pingState.status === "running"
              ? "Pinging upstream..."
              : pingState.status === "success"
              ? `Active · ${pingState.latencyMs}ms`
              : pingState.message || "Ping failed"}
          </span>
          {pingState.status === "success" && pingState.latencyMs !== undefined && (
            <span className="font-mono">{pingState.latencyMs}ms</span>
          )}
        </div>
      )}

      {/* Bottom row: model name + capability icons */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-[var(--border)]/40 text-[11px]">
        <span className="text-[var(--muted)] truncate font-mono text-[10px]">
          {model.modelKey}
        </span>

        {/* Capability Icons */}
        <div className="flex items-center gap-1.5 shrink-0 text-[var(--muted)]">
          {caps.reasoning && (
            <Tooltip content="Reasoning / Thinking model">
              <span className="p-0.5 rounded text-[var(--ink)]">
                <Brain className="w-3 h-3 text-[var(--primary)]" />
              </span>
            </Tooltip>
          )}
          {caps.vision && (
            <Tooltip content="Vision / Multimodal input">
              <span className="p-0.5 rounded">
                <Eye className="w-3 h-3 text-[var(--ink)]" />
              </span>
            </Tooltip>
          )}
          {caps.tools && (
            <Tooltip content="Function Calling / Tools">
              <span className="p-0.5 rounded">
                <Wrench className="w-3 h-3" />
              </span>
            </Tooltip>
          )}
          {caps.output.includes("image") && (
            <Tooltip content="Image generation output">
              <span className="p-0.5 rounded">
                <ImageIcon className="w-3 h-3 text-purple-400" />
              </span>
            </Tooltip>
          )}
          {caps.output.includes("video") && (
            <Tooltip content="Video generation output">
              <span className="p-0.5 rounded">
                <Video className="w-3 h-3 text-sky-400" />
              </span>
            </Tooltip>
          )}
          {caps.output.includes("audio") && (
            <Tooltip content="Audio / Speech output">
              <span className="p-0.5 rounded">
                <AudioLines className="w-3 h-3 text-emerald-400" />
              </span>
            </Tooltip>
          )}
          {caps.input.includes("file") && (
            <Tooltip content="Document / PDF input">
              <span className="p-0.5 rounded">
                <FileText className="w-3 h-3" />
              </span>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}
