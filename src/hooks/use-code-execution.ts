"use client";

import { useEffect, useRef, useState } from "react";
import {
  normalizeSandboxLanguage,
  stripCodeFences,
  type PersistedChartItem,
  type PersistedCodeExecutionResult,
  type SandboxLanguage,
} from "@/lib/tools/execute-code";
import {
  loadSessionFilesForSandbox,
  runInWasmSandbox,
  type SandboxPhase,
  type SandboxRunResult,
} from "@/lib/wasm/sandbox-runner";
import type { ToolActivity } from "@/types";

export interface LiveChartView {
  title: string;
  url: string;
  filename?: string;
  blob?: Blob;
}

export interface LiveExecutionState {
  phase: SandboxPhase | "completed" | "error";
  stdout: string;
  stderr: string;
  resultText: string;
  durationMs?: number;
  charts: LiveChartView[];
  shouldPersist: boolean;
}

export interface UseCodeExecutionOptions {
  input: unknown;
  output?: unknown;
  toolState: ToolActivity["state"];
  toolCallId: string;
  messageId?: string;
  chatId?: string;
  isMessageStreaming?: boolean;
}

// Deduplicates React Strict Mode double-mount runs within the same browser tab
const inFlightSandboxRuns = new Map<string, Promise<SandboxRunResult>>();
const persistedToolCallIds = new Set<string>();

function parseToolInput(raw: unknown): {
  title: string;
  language: SandboxLanguage;
  code: string;
} {
  let obj: Record<string, unknown> = {};
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      obj = {};
    }
  } else if (raw && typeof raw === "object") {
    obj = raw as Record<string, unknown>;
  }

  return {
    title: String(obj.title || "Eksekusi Kode").trim() || "Eksekusi Kode",
    language: normalizeSandboxLanguage(obj.language),
    code: stripCodeFences(String(obj.code ?? "")),
  };
}

function parsePersistedResult(rawOutput: unknown): PersistedCodeExecutionResult | null {
  if (!rawOutput || typeof rawOutput !== "object") return null;
  const out = rawOutput as Record<string, unknown>;
  const exec = out.executionResult;
  if (!exec || typeof exec !== "object") return null;
  const rec = exec as Record<string, unknown>;
  if (rec.status !== "completed" && rec.status !== "error") return null;

  const charts: PersistedChartItem[] = Array.isArray(rec.charts)
    ? rec.charts
        .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === "object"))
        .map((c, idx) => ({
          id: typeof c.id === "string" ? c.id : undefined,
          url: String(c.url || ""),
          title: String(c.title || `Chart ${idx + 1}`),
        }))
        .filter((c) => Boolean(c.url))
    : [];

  return {
    status: rec.status,
    stdout: typeof rec.stdout === "string" ? rec.stdout : "",
    stderr: typeof rec.stderr === "string" ? rec.stderr : "",
    resultText: typeof rec.resultText === "string" ? rec.resultText : "",
    durationMs: typeof rec.durationMs === "number" ? rec.durationMs : undefined,
    charts,
  };
}

function sanitizeChartFilename(baseTitle: string, fallbackName: string, index: number): string {
  const extMatch = /\.(png|jpe?g|webp)$/i.exec(fallbackName);
  const ext = extMatch ? extMatch[0].toLowerCase() : ".png";
  const slug = baseTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const suffix = index > 0 ? `-${index + 1}` : "";
  return `${slug || "chart"}${suffix}${ext}`;
}

export function useCodeExecution({
  input,
  output,
  toolState,
  toolCallId,
  messageId,
  chatId,
  isMessageStreaming = false,
}: UseCodeExecutionOptions) {
  const { title, language, code } = parseToolInput(input);
  const persistedResult = parsePersistedResult(output);

  const [liveState, setLiveState] = useState<LiveExecutionState | null>(null);
  const createdBlobUrlsRef = useRef<string[]>([]);
  const isPersistingRef = useRef(false);

  // Revoke any created blob: URLs when widget unmounts
  useEffect(() => {
    const urls = createdBlobUrlsRef.current;
    return () => {
      for (const u of urls) URL.revokeObjectURL(u);
      urls.length = 0;
    };
  }, []);

  const isInputStreaming = toolState === "streaming";

  // Auto-execute once in isolated WASM Worker when not already persisted in DB
  useEffect(() => {
    if (persistedResult || isInputStreaming || !code.trim()) return;

    let active = true;
    const dedupeKey = `${toolCallId}:${code.length}`;

    (async () => {
      await Promise.resolve();
      if (!active) return;

      setLiveState((prev) =>
        prev ?? {
          phase: language === "python" ? "loading_runtime" : "executing",
          stdout: "",
          stderr: "",
          resultText: "",
          charts: [],
          shouldPersist: false,
        }
      );

      let promise = inFlightSandboxRuns.get(dedupeKey);
      if (!promise) {
        promise = (async () => {
          const mountedFiles = await loadSessionFilesForSandbox(chatId, language, code);
          return runInWasmSandbox({
            language,
            code,
            files: mountedFiles,
            onPhaseChange: (nextPhase) => {
              if (active) {
                setLiveState((prev) => (prev ? { ...prev, phase: nextPhase } : prev));
              }
            },
          });
        })();
        inFlightSandboxRuns.set(dedupeKey, promise);
      }

      const res = await promise;
      if (!active) return;

      const chartViews: LiveChartView[] = res.charts.map((c, idx) => {
        const blobUrl = URL.createObjectURL(c.blob);
        createdBlobUrlsRef.current.push(blobUrl);
        return {
          title: res.charts.length > 1 ? `${title} (${idx + 1})` : title,
          url: blobUrl,
          filename: sanitizeChartFilename(title, c.filename, idx),
          blob: c.blob,
        };
      });

      setLiveState({
        phase: res.ok ? "completed" : "error",
        stdout: res.stdout,
        stderr: res.stderr,
        resultText: res.resultText,
        durationMs: res.durationMs,
        charts: chartViews,
        shouldPersist: Boolean(
          chatId && messageId && toolCallId && !persistedToolCallIds.has(toolCallId)
        ),
      });
    })();

    return () => {
      active = false;
    };
  }, [persistedResult, isInputStreaming, code, language, title, toolCallId, chatId, messageId]);

  // Persist charts to R2 (`session_files`) + result to `ChatMessage.parts` ONLY after streaming completes
  useEffect(() => {
    if (
      !liveState?.shouldPersist ||
      isMessageStreaming ||
      !chatId ||
      !messageId ||
      !toolCallId ||
      isPersistingRef.current ||
      persistedToolCallIds.has(toolCallId) ||
      (liveState.phase !== "completed" && liveState.phase !== "error")
    ) {
      return;
    }

    isPersistingRef.current = true;
    persistedToolCallIds.add(toolCallId);

    (async () => {
      try {
        const uploadedCharts: PersistedChartItem[] = [];
        for (const chart of liveState.charts) {
          if (!chart.blob) continue;
          const form = new FormData();
          form.append(
            "file",
            new File([chart.blob], chart.filename || "chart.png", {
              type: chart.blob.type || "image/png",
            })
          );
          form.append("source", "tool");

          const uploadRes = await fetch(`/api/v1/chats/${chatId}/files`, {
            method: "POST",
            body: form,
            credentials: "same-origin",
          });
          if (uploadRes.ok) {
            const json = await uploadRes.json();
            if (json?.data?.url) {
              uploadedCharts.push({
                id: json.data.id,
                url: json.data.url,
                title: chart.title,
              });
            }
          }
        }

        if (uploadedCharts.length > 0 && typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("devnuby:files-updated"));
        }

        const payload: PersistedCodeExecutionResult = {
          status: liveState.phase === "completed" ? "completed" : "error",
          ...(liveState.stdout ? { stdout: liveState.stdout } : {}),
          ...(liveState.stderr ? { stderr: liveState.stderr } : {}),
          ...(liveState.resultText ? { resultText: liveState.resultText } : {}),
          ...(liveState.durationMs !== undefined ? { durationMs: liveState.durationMs } : {}),
          ...(uploadedCharts.length > 0 ? { charts: uploadedCharts } : {}),
        };

        await fetch(`/api/v1/chats/${chatId}/messages/${messageId}/tool-state`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toolCallId, executionResult: payload }),
          credentials: "same-origin",
        });

        setLiveState((prev) => (prev ? { ...prev, shouldPersist: false } : prev));
      } catch {
        persistedToolCallIds.delete(toolCallId);
      } finally {
        isPersistingRef.current = false;
      }
    })();
  }, [liveState, isMessageStreaming, chatId, messageId, toolCallId]);

  async function rerun() {
    if (!code.trim()) return;
    setLiveState({
      phase: language === "python" ? "loading_runtime" : "executing",
      stdout: "",
      stderr: "",
      resultText: "",
      charts: [],
      shouldPersist: false,
    });

    const mountedFiles = await loadSessionFilesForSandbox(chatId, language, code);
    const res = await runInWasmSandbox({
      language,
      code,
      files: mountedFiles,
      onPhaseChange: (nextPhase) => {
        setLiveState((prev) => (prev ? { ...prev, phase: nextPhase } : prev));
      },
    });

    const chartViews: LiveChartView[] = res.charts.map((c, idx) => {
      const blobUrl = URL.createObjectURL(c.blob);
      createdBlobUrlsRef.current.push(blobUrl);
      return {
        title: res.charts.length > 1 ? `${title} (${idx + 1})` : title,
        url: blobUrl,
        filename: sanitizeChartFilename(title, c.filename, idx),
        blob: c.blob,
      };
    });

    setLiveState({
      phase: res.ok ? "completed" : "error",
      stdout: res.stdout,
      stderr: res.stderr,
      resultText: res.resultText,
      durationMs: res.durationMs,
      charts: chartViews,
      shouldPersist: false,
    });
  }

  const effectivePhase = liveState
    ? liveState.phase
    : persistedResult
      ? persistedResult.status
      : isInputStreaming
        ? "streaming"
        : language === "python"
          ? "loading_runtime"
          : "executing";

  return {
    title,
    language,
    code,
    effectivePhase,
    isBusy:
      effectivePhase === "streaming" ||
      effectivePhase === "loading_runtime" ||
      effectivePhase === "executing",
    isError: effectivePhase === "error",
    stdout: liveState ? liveState.stdout : (persistedResult?.stdout ?? ""),
    stderr: liveState ? liveState.stderr : (persistedResult?.stderr ?? ""),
    resultText: liveState ? liveState.resultText : (persistedResult?.resultText ?? ""),
    durationMs: liveState ? liveState.durationMs : persistedResult?.durationMs,
    charts: liveState
      ? liveState.charts
      : ((persistedResult?.charts ?? []) as Array<{ title: string; url: string }>),
    rerun,
  };
}
