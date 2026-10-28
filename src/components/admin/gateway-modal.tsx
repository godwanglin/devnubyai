"use client";

import React, { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n-provider";
import type { SanitizedGatewayDto } from "@/lib/gateways/admin-service";

interface GatewayModalProps {
  isOpen: boolean;
  onClose: () => void;
  gateway: SanitizedGatewayDto | null; // null for create, object for edit
  onSaved: () => void;
}

interface FormInnerProps {
  gateway: SanitizedGatewayDto | null;
  onClose: () => void;
  onSaved: () => void;
}

function GatewayFormInner({ gateway, onClose, onSaved }: FormInnerProps) {
  const { t } = useI18n();
  const isEdit = Boolean(gateway);

  const [slug, setSlug] = useState(() => gateway?.slug ?? "");
  const [name, setName] = useState(() => gateway?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(() => gateway?.baseUrl ?? "");
  const [wireApi, setWireApi] = useState<"chat" | "responses">(() => gateway?.wireApi ?? "chat");
  const [modelsPath, setModelsPath] = useState(() => gateway?.modelsPath || "/models");
  const [apiKey, setApiKey] = useState("");
  const [extraHeaders, setExtraHeaders] = useState(() =>
    gateway?.extraHeaders ? JSON.stringify(gateway.extraHeaders, null, 2) : ""
  );
  const [isPrimary, setIsPrimary] = useState(() => gateway?.isPrimary ?? false);
  const [isEnabled, setIsEnabled] = useState(() => gateway?.isEnabled ?? true);
  const [priority, setPriority] = useState(() => gateway?.priority ?? 100);
  const [timeoutMs, setTimeoutMs] = useState(() => gateway?.timeoutMs ?? 120000);
  const [firstTokenTimeoutMs, setFirstTokenTimeoutMs] = useState(
    () => gateway?.firstTokenTimeoutMs ?? 20000
  );

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      let parsedHeaders: Record<string, string> | null = null;
      if (extraHeaders.trim()) {
        try {
          const parsed = JSON.parse(extraHeaders);
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new Error("Headers must be a JSON object of key-value strings");
          }
          parsedHeaders = parsed;
        } catch (err: unknown) {
          throw new Error(err instanceof Error ? err.message : "Invalid JSON for extra headers");
        }
      }

      const url = isEdit ? `/api/v1/admin/gateways/${gateway!.id}` : "/api/v1/admin/gateways";
      const method = isEdit ? "PATCH" : "POST";

      const payload: Record<string, unknown> = {
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        wireApi,
        modelsPath: modelsPath.trim(),
        extraHeaders: parsedHeaders,
        isEnabled,
        priority: Number(priority),
        timeoutMs: Number(timeoutMs),
        firstTokenTimeoutMs: Number(firstTokenTimeoutMs),
      };

      if (!isEdit) {
        payload.slug = slug.trim();
        payload.apiKey = apiKey.trim();
        payload.isPrimary = isPrimary;
      } else {
        if (apiKey.trim()) {
          payload.apiKey = apiKey.trim();
        }
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "same-origin",
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(json?.error?.message || "Failed to save gateway");
      }

      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3 rounded-[8px] bg-red-500/10 border border-red-500/20 text-xs text-red-500">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">
            {t("admin.gateways.name")}
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="OpenAI Main"
            className="w-full px-3 py-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] text-sm outline-none focus:border-[var(--accent)]"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">
            {t("admin.gateways.slug")}
          </label>
          <input
            type="text"
            required
            disabled={isEdit}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="openai-main"
            className="w-full px-3 py-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] text-sm outline-none focus:border-[var(--accent)] disabled:opacity-60"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">
            {t("admin.gateways.baseUrl")}
          </label>
          <input
            type="url"
            required
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
            className="w-full px-3 py-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] text-sm font-mono outline-none focus:border-[var(--accent)]"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">
            {t("admin.gateways.wireApi")}
          </label>
          <select
            value={wireApi}
            onChange={(e) => setWireApi(e.target.value as "chat" | "responses")}
            className="w-full px-3 py-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] text-sm outline-none focus:border-[var(--accent)]"
          >
            <option value="chat">chat (OpenAI wire)</option>
            <option value="responses">responses (Anthropic wire)</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">
            {t("admin.gateways.modelsPath")}
          </label>
          <input
            type="text"
            required
            value={modelsPath}
            onChange={(e) => setModelsPath(e.target.value)}
            placeholder="/models"
            className="w-full px-3 py-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] text-sm font-mono outline-none focus:border-[var(--accent)]"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">
            {t("admin.gateways.apiKey")}
          </label>
          <input
            type="password"
            required={!isEdit}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={isEdit && gateway?.apiKeyLast4 ? `••••${gateway.apiKeyLast4}` : "sk-..."}
            className="w-full px-3 py-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] text-sm font-mono outline-none focus:border-[var(--accent)]"
          />
          {isEdit && (
            <p className="text-[11px] text-[var(--muted)] mt-1">
              {t("admin.gateways.apiKeyPlaceholder")}
            </p>
          )}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-[var(--muted)] mb-1">
          {t("admin.gateways.extraHeaders")}
        </label>
        <textarea
          rows={2}
          value={extraHeaders}
          onChange={(e) => setExtraHeaders(e.target.value)}
          placeholder={'{\n  "anthropic-version": "2023-06-01"\n}'}
          className="w-full px-3 py-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] text-xs font-mono outline-none focus:border-[var(--accent)]"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">
            {t("admin.gateways.priority")}
          </label>
          <input
            type="number"
            min={1}
            max={65535}
            required
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            className="w-full px-3 py-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] text-sm outline-none focus:border-[var(--accent)]"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">
            {t("admin.gateways.timeoutMs")}
          </label>
          <input
            type="number"
            min={1000}
            max={600000}
            required
            value={timeoutMs}
            onChange={(e) => setTimeoutMs(Number(e.target.value))}
            className="w-full px-3 py-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] text-sm outline-none focus:border-[var(--accent)]"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">
            {t("admin.gateways.firstTokenTimeoutMs")}
          </label>
          <input
            type="number"
            min={1000}
            max={120000}
            required
            value={firstTokenTimeoutMs}
            onChange={(e) => setFirstTokenTimeoutMs(Number(e.target.value))}
            className="w-full px-3 py-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] text-sm outline-none focus:border-[var(--accent)]"
          />
        </div>
      </div>

      <div className="flex items-center gap-6 pt-2">
        <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-[var(--ink)]">
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={(e) => setIsEnabled(e.target.checked)}
            className="rounded-[4px] accent-[var(--accent)]"
          />
          <span>{t("admin.gateways.enabled")}</span>
        </label>

        {!isEdit && (
          <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-[var(--ink)]">
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
              className="rounded-[4px] accent-[var(--accent)]"
            />
            <span>{t("admin.gateways.setPrimary")}</span>
          </label>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 pt-4 border-t border-[var(--border)]">
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          {t("admin.gateways.cancel")}
        </Button>
        <Button variant="primary" type="submit" disabled={loading}>
          {loading ? "..." : t("admin.gateways.save")}
        </Button>
      </div>
    </form>
  );
}

export function GatewayModal({ isOpen, onClose, gateway, onSaved }: GatewayModalProps) {
  const { t } = useI18n();
  const isEdit = Boolean(gateway);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? t("admin.gateways.editTitle") : t("admin.gateways.createTitle")}
      maxWidth="lg"
    >
      {isOpen && (
        <GatewayFormInner
          key={gateway ? gateway.id : "new"}
          gateway={gateway}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </Modal>
  );
}
