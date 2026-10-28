"use client";

import React from "react";
import { Copy, Check } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n-provider";
import type { SanitizedUpstreamModelDetailDto } from "@/lib/upstream-models/admin-service";

interface UpstreamMetadataModalProps {
  model: SanitizedUpstreamModelDetailDto | null;
  onClose: () => void;
}

export function UpstreamMetadataModal({ model, onClose }: UpstreamMetadataModalProps) {
  const { t } = useI18n();
  const [copied, setCopied] = React.useState(false);

  async function copyMetadata() {
    if (!model?.rawMetadata) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(model.rawMetadata, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (e.g. non-secure origin).
    }
  }

  return (
    <Modal
      isOpen={!!model}
      onClose={onClose}
      title={t("admin.upstream.metadataTitle", { key: model?.modelKey ?? "" })}
      description={model ? t("admin.upstream.metadataGateway", { name: model.gateway.name, slug: model.gateway.slug }) : ""}
      maxWidth="xl"
    >
      {model && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-[var(--ink)] uppercase tracking-wider">
              JSON
            </h4>
            <Button variant="ghost" size="sm" onClick={() => void copyMetadata()} disabled={!model.rawMetadata}>
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? t("admin.upstream.copied") : t("admin.upstream.copyKey")}
            </Button>
          </div>
          <div className="max-h-80 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
            {model.rawMetadata ? (
              <pre className="text-[11px] font-mono text-[var(--ink)] whitespace-pre-wrap break-all">
                {JSON.stringify(model.rawMetadata, null, 2)}
              </pre>
            ) : (
              <p className="text-xs text-[var(--muted)]">{t("admin.upstream.noMetadata")}</p>
            )}
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-[var(--ink)] uppercase tracking-wider">
              {t("admin.upstream.linkedRoutesTitle")}
            </h4>
            {model.routes.length === 0 ? (
              <p className="text-xs text-[var(--muted)]">{t("admin.upstream.noLinkedRoutes")}</p>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {model.routes.map((route) => (
                  <div key={route.id} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] p-2 text-xs">
                    <div>
                      <p className="font-mono text-[var(--ink)]">{route.catalogModel.publicId}</p>
                      <p className="text-[var(--muted)]">{route.catalogModel.displayName}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[var(--muted)]">#{route.priority}</p>
                      <span className={route.isEnabled ? "text-emerald-500" : "text-[var(--muted)]"}>
                        {route.isEnabled ? t("admin.gateways.enabled") : t("admin.gateways.disabled")}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end pt-2">
            <Button variant="ghost" size="sm" onClick={onClose}>{t("admin.upstream.close")}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
