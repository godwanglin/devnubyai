"use client";

import React, { useState, useMemo, useRef } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Upload, FileCode, CheckCircle2, AlertCircle, AlertTriangle, Loader2 } from "lucide-react";
import { useToast } from "@/providers/toast-provider";
import type { BulkImportResponse } from "@/lib/gateways/bulk-import-service";

interface BulkImportAccountsModalProps {
  providerId: string;
  providerName: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const PLACEHOLDER_JSON = `[
  {
    "accessToken": "ey...",
    "refreshToken": "rt_...",
    "idToken": "ey...",
    "email": "user@example.com"
  }
]`;

export function BulkImportAccountsModal({
  providerId,
  providerName,
  isOpen,
  onClose,
  onSuccess,
}: BulkImportAccountsModalProps) {
  const { toast } = useToast();
  const [jsonText, setJsonText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BulkImportResponse | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Client-side live preview parsing (pure, no network)
  const clientValidation = useMemo<{
    count: number;
    error: string | null;
  }>(() => {
    const trimmed = jsonText.trim();
    if (!trimmed) return { count: 0, error: null };
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      let list: unknown[] = [];
      if (Array.isArray(parsed)) list = parsed;
      else if (parsed && typeof parsed === "object") {
        const r = parsed as Record<string, unknown>;
        if (Array.isArray(r.accounts)) list = r.accounts;
        else list = [r];
      }
      if (list.length === 0) return { count: 0, error: "Array akun kosong" };
      return { count: list.length, error: null };
    } catch (err) {
      return { count: 0, error: err instanceof Error ? err.message : "JSON tidak valid" };
    }
  }, [jsonText]);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = String(evt.target?.result || "");
      setJsonText(text);
      setResult(null);
      setSubmitError(null);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  async function handleImport() {
    setSubmitting(true);
    setSubmitError(null);
    setResult(null);
    try {
      let body: unknown;
      try {
        body = JSON.parse(jsonText.trim());
      } catch (err) {
        throw new Error(`JSON tidak valid: ${err instanceof Error ? err.message : ""}`);
      }

      const res = await fetch(
        `/api/v1/admin/gateway/providers/${providerId}/connections/bulk-import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          credentials: "same-origin",
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message || "Gagal melakukan import");
      }

      const imp = json.data.import as BulkImportResponse;
      setResult(imp);
      toast(
        `Bulk import selesai: ${imp.created} dibuat, ${imp.updated} diperbarui, ${imp.failed} gagal`
      );
      if (imp.created > 0 || imp.updated > 0) {
        onSuccess();
      }
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Gagal import");
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setJsonText("");
    setResult(null);
    setSubmitError(null);
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Bulk Import Akun ${providerName}`}
      description="Paste array JSON akun (berisi accessToken, refreshToken, idToken, dan/atau email) untuk mengimpor ke pool sekaligus."
      maxWidth="lg"
    >
      <div className="space-y-4 text-xs">
        {/* Hidden file input for loading .json file */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Action bar above textarea */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={submitting}
              className="text-xs gap-1"
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>Pilih file .json</span>
            </Button>
            {jsonText.trim() && !result && (
              <button
                type="button"
                onClick={handleReset}
                className="text-[11px] text-[var(--muted)] hover:text-[var(--ink)] cursor-pointer"
              >
                Kosongkan
              </button>
            )}
          </div>

          {/* Live detection indicator */}
          <div className="text-[11px]">
            {clientValidation.error ? (
              <span className="text-red-500 font-mono flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                <span>JSON Error: {clientValidation.error}</span>
              </span>
            ) : clientValidation.count > 0 ? (
              <span className="text-emerald-500 font-medium">
                ✓ {clientValidation.count} akun terdeteksi
              </span>
            ) : (
              <span className="text-[var(--muted)]">Format: array `[...]` atau Codex auth.json</span>
            )}
          </div>
        </div>

        {/* Textarea */}
        <textarea
          rows={10}
          value={jsonText}
          onChange={(e) => {
            setJsonText(e.target.value);
            if (result) setResult(null);
            if (submitError) setSubmitError(null);
          }}
          disabled={submitting}
          placeholder={PLACEHOLDER_JSON}
          className="w-full p-2.5 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] font-mono text-[11px] text-[var(--ink)] placeholder:text-[var(--muted)]/50 focus:outline-hidden focus:border-[var(--accent)] resize-y"
        />

        {submitError && (
          <div className="p-2.5 rounded-[8px] bg-red-500/10 border border-red-500/20 text-red-500 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{submitError}</span>
          </div>
        )}

        {/* Results summary & table */}
        {result && (
          <div className="space-y-2 border border-[var(--border)] rounded-[8px] p-3 bg-[var(--surface)]/30">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2 py-0.5 rounded border bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                <span>{result.created} dibuat</span>
              </span>
              <span className="px-2 py-0.5 rounded border bg-sky-500/10 text-sky-500 border-sky-500/20 font-medium">
                {result.updated} diperbarui
              </span>
              {result.failed > 0 && (
                <span className="px-2 py-0.5 rounded border bg-red-500/10 text-red-500 border-red-500/20 font-medium flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  <span>{result.failed} gagal</span>
                </span>
              )}
            </div>

            {/* Results Table */}
            <div className="overflow-auto max-h-[220px] rounded-[6px] border border-[var(--border)] bg-[var(--panel)]">
              <table className="w-full text-left text-xs">
                <thead className="bg-[var(--surface)] text-[10px] uppercase tracking-wider text-[var(--muted)] border-b border-[var(--border)] sticky top-0">
                  <tr>
                    <th className="px-2.5 py-1.5 font-medium">#</th>
                    <th className="px-2.5 py-1.5 font-medium">Status</th>
                    <th className="px-2.5 py-1.5 font-medium">Email / Akun</th>
                    <th className="px-2.5 py-1.5 font-medium">Plan</th>
                    <th className="px-2.5 py-1.5 font-medium">Info / Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {result.results.map((r) => (
                    <tr key={r.index} className="hover:bg-[var(--surface)]/50">
                      <td className="px-2.5 py-1.5 font-mono text-[10px] text-[var(--muted)]">
                        {r.index + 1}
                      </td>
                      <td className="px-2.5 py-1.5">
                        {r.status === "created" && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded border bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-mono">
                            Dibuat
                          </span>
                        )}
                        {r.status === "updated" && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded border bg-sky-500/10 text-sky-500 border-sky-500/20 font-mono">
                            Diperbarui
                          </span>
                        )}
                        {r.status === "failed" && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded border bg-red-500/10 text-red-500 border-red-500/20 font-mono">
                            Gagal
                          </span>
                        )}
                      </td>
                      <td className="px-2.5 py-1.5 font-mono text-[11px] text-[var(--ink)] truncate max-w-[160px]">
                        {r.email || (r.id ? `ID #${r.id}` : "-")}
                      </td>
                      <td className="px-2.5 py-1.5 font-mono text-[10px] text-[var(--muted)]">
                        {r.plan || "-"}
                      </td>
                      <td className="px-2.5 py-1.5 text-[11px] text-[var(--muted)] truncate max-w-[200px]" title={r.error}>
                        {r.error || (r.status === "updated" ? "Token diperbarui, cooldown direset" : "Tersambung ke pool")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-[var(--border)]">
          <span className="text-[11px] text-[var(--muted)]">
            Token sensitif dienkripsi dengan AES-256-GCM vault server dan tidak pernah di-log.
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
              {result ? "Selesai" : "Batal"}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleImport}
              disabled={
                submitting ||
                clientValidation.count === 0 ||
                Boolean(clientValidation.error)
              }
              className="gap-1.5"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Mengimpor...</span>
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5" />
                  <span>
                    Import {clientValidation.count > 0 ? `(${clientValidation.count})` : "Semua"}
                  </span>
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
