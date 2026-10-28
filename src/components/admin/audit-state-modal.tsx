"use client";

import React from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n-provider";
import type { SanitizedAuditLogDto } from "@/lib/logs/admin-service";

interface AuditStateModalProps {
  log: SanitizedAuditLogDto | null;
  onClose: () => void;
}

export function AuditStateModal({ log, onClose }: AuditStateModalProps) {
  const { t } = useI18n();

  if (!log) return null;

  return (
    <Modal
      isOpen={Boolean(log)}
      onClose={onClose}
      title={t("admin.logs.modalTitle", { action: log.action })}
      maxWidth="xl"
    >
      <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs">
          <span className="text-[var(--muted)]">{t("admin.logs.entity")}:</span>
          <span className="font-semibold text-[var(--ink)]">
            {log.entityType} ({log.entityId ?? "—"})
          </span>
          <span className="text-[var(--muted)] ml-auto">
            {new Date(log.createdAt).toLocaleString()}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">
              {t("admin.logs.beforeState")}
            </h4>
            <div className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] min-h-[160px] max-h-80 overflow-auto">
              {log.beforeState ? (
                <pre className="text-[11px] font-mono text-[var(--ink)] whitespace-pre-wrap break-all">
                  {JSON.stringify(log.beforeState, null, 2)}
                </pre>
              ) : (
                <p className="text-xs text-[var(--placeholder)] italic py-6 text-center">
                  {t("admin.logs.noState")}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold text-[var(--accent)] uppercase tracking-wider">
              {t("admin.logs.afterState")}
            </h4>
            <div className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] min-h-[160px] max-h-80 overflow-auto">
              {log.afterState ? (
                <pre className="text-[11px] font-mono text-[var(--ink)] whitespace-pre-wrap break-all">
                  {JSON.stringify(log.afterState, null, 2)}
                </pre>
              ) : (
                <p className="text-xs text-[var(--placeholder)] italic py-6 text-center">
                  {t("admin.logs.noState")}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("admin.logs.close")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
