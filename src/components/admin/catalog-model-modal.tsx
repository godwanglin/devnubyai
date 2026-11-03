"use client";

import React, { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n-provider";
import { Plus, Trash2, ArrowUp, ArrowDown, ShieldCheck, AlertCircle } from "lucide-react";
import { UpstreamModelSelect } from "./upstream-model-select";
import { CustomSelect } from "@/components/ui/custom-select";
import type {
  SanitizedCatalogModelDto,
  SanitizedProviderSummaryDto,
  UpstreamModelOptionDto,
  CreateCatalogModelInput,
} from "@/lib/catalog-models/admin-service";

interface CatalogModelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: CreateCatalogModelInput) => Promise<void>;
  model: SanitizedCatalogModelDto | null;
  providers: SanitizedProviderSummaryDto[];
  upstreamOptions: UpstreamModelOptionDto[];
  loading: boolean;
}

type RoutingStrategy = "priority" | "round_robin";

interface FormRouteItem {
  upstreamModelId: string;
  priority: number;
  weight: number;
  isEnabled: boolean;
}

export function CatalogModelModal({
  isOpen,
  onClose,
  onSave,
  model,
  providers,
  upstreamOptions,
  loading,
}: CatalogModelModalProps) {
  if (!isOpen) return null;

  return (
    <CatalogModelModalInner
      key={model?.id ?? "new"}
      onClose={onClose}
      onSave={onSave}
      model={model}
      providers={providers}
      upstreamOptions={upstreamOptions}
      loading={loading}
    />
  );
}

function CatalogModelModalInner({
  onClose,
  onSave,
  model,
  providers,
  upstreamOptions,
  loading,
}: Omit<CatalogModelModalProps, "isOpen">) {
  const { t } = useI18n();

  // Public Info states
  const [publicId, setPublicId] = useState(() => model?.publicId ?? "");
  const [displayName, setDisplayName] = useState(() => model?.displayName ?? "");
  const [shortName, setShortName] = useState(() => model?.shortName ?? "");
  const [description, setDescription] = useState(() => model?.description ?? "");
  const [providerId, setProviderId] = useState(() => model?.providerId ?? (providers[0]?.id ?? ""));
  const [category, setCategory] = useState<"powerful" | "fast" | "balanced" | "flagship" | "image">(() => (model?.category as "powerful") ?? "powerful");
  const [badge, setBadge] = useState(() => model?.badge ?? "");
  const [contextWindow, setContextWindow] = useState<string>(() => model?.contextWindow ? String(model.contextWindow) : "");
  const [maxOutputTokens, setMaxOutputTokens] = useState<string>(() => model?.maxOutputTokens ? String(model.maxOutputTokens) : "");
  const [supportsVision, setSupportsVision] = useState(() => model?.supportsVision ?? false);
  const [supportsTools, setSupportsTools] = useState(() => model?.supportsTools ?? false);
  const [supportsReasoning, setSupportsReasoning] = useState(() => model?.supportsReasoning ?? false);
  const [inputPricePerMillion, setInputPricePerMillion] = useState<string>(() =>
    model?.inputPricePerMillion !== undefined ? String(model.inputPricePerMillion) : "0"
  );
  const [outputPricePerMillion, setOutputPricePerMillion] = useState<string>(() =>
    model?.outputPricePerMillion !== undefined ? String(model.outputPricePerMillion) : "0"
  );
  const [pricingCurrency, setPricingCurrency] = useState(() => model?.pricingCurrency ?? "USD");
  const [status, setStatus] = useState<"active" | "draft" | "deprecated">(() => (model?.status as "active") ?? "active");
  const [sortOrder, setSortOrder] = useState<number>(() => model?.sortOrder ?? 100);
  const [routingStrategy, setRoutingStrategy] = useState<RoutingStrategy>(() =>
    model?.routingStrategy === "round_robin" ? "round_robin" : "priority"
  );
  const [routeCooldownSeconds, setRouteCooldownSeconds] = useState<number>(() => model?.routeCooldownSeconds ?? 30);

  // Routing Multi-Upstream states
  const [routes, setRoutes] = useState<FormRouteItem[]>(() => {
    if (model && model.routes.length > 0) {
      return model.routes.map((r) => ({
        upstreamModelId: r.upstreamModelId,
        priority: r.priority,
        weight: r.weight ?? 1,
        isEnabled: r.isEnabled,
      }));
    }
    return [];
  });

  const [selectedToAdd, setSelectedToAdd] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // Filter options to exclude already selected
  const availableToAdd = upstreamOptions.filter(
    (opt) => !routes.some((r) => r.upstreamModelId === opt.id)
  );

  function handleAddRoute() {
    if (!selectedToAdd) return;
    setRoutes((prev) => [
      ...prev,
      {
        upstreamModelId: selectedToAdd,
        priority: prev.length + 1,
        weight: 1,
        isEnabled: true,
      },
    ]);
    setSelectedToAdd("");
  }

  function handleRemoveRoute(idx: number) {
    setRoutes((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      // Re-index priorities 1..N
      return next.map((r, i) => ({ ...r, priority: i + 1 }));
    });
  }

  function handleMoveRoute(idx: number, direction: "up" | "down") {
    setRoutes((prev) => {
      const targetIdx = direction === "up" ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const copy = [...prev];
      const temp = copy[idx];
      copy[idx] = copy[targetIdx];
      copy[targetIdx] = temp;
      return copy.map((r, i) => ({ ...r, priority: i + 1 }));
    });
  }

  function handleRouteWeightChange(idx: number, value: string) {
    const weight = Math.min(100, Math.max(1, parseInt(value, 10) || 1));
    setRoutes((prev) => prev.map((r, i) => (i === idx ? { ...r, weight } : r)));
  }

  const isRoundRobin = routingStrategy === "round_robin";
  const totalEnabledWeight = routes.reduce((sum, r) => (r.isEnabled ? sum + r.weight : sum), 0);

  function handleToggleRouteEnabled(idx: number) {
    setRoutes((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, isEnabled: !r.isEnabled } : r))
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!publicId.includes("/")) {
      setError("Format ID Model harus provider/model (contoh: openai/gpt-6-luna atau gemini/gemini-3.8-flash)");
      return;
    }

    try {
      await onSave({
        publicId: publicId.trim(),
        displayName: displayName.trim(),
        shortName: shortName.trim(),
        description: description.trim() ? description.trim() : null,
        providerId,
        category,
        badge: badge.trim() ? badge.trim() : null,
        contextWindow: contextWindow ? parseInt(contextWindow, 10) : null,
        maxOutputTokens: maxOutputTokens ? parseInt(maxOutputTokens, 10) : null,
        supportsVision,
        supportsTools,
        supportsReasoning,
        inputPricePerMillion: parseFloat(inputPricePerMillion) || 0,
        outputPricePerMillion: parseFloat(outputPricePerMillion) || 0,
        pricingCurrency: pricingCurrency.trim() || "USD",
        status,
        sortOrder,
        routingStrategy,
        routeCooldownSeconds,
        routes: routes.map((r) => ({
          upstreamModelId: r.upstreamModelId,
          priority: r.priority,
          weight: r.weight,
          isEnabled: r.isEnabled,
        })),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save model");
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={model ? t("admin.catalog.editTitle", { name: model.displayName }) : t("admin.catalog.createTitle")}
      maxWidth="xl"
    >
      <form onSubmit={handleSubmit} className="space-y-6 max-h-[80vh] overflow-y-auto pr-1">
        {error && (
          <div className="flex items-center gap-2 p-3 text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Section 1: Public Info */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)] border-b border-[var(--border)] pb-1">
            {t("admin.catalog.sectionPublicInfo")}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--ink)] mb-1">
                {t("admin.catalog.publicId")} *
              </label>
              <input
                type="text"
                required
                value={publicId}
                onChange={(e) => setPublicId(e.target.value)}
                placeholder="openai/gpt-6-luna"
                className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--ink)] focus:border-[var(--accent)] outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--ink)] mb-1">
                {t("admin.catalog.provider")} *
              </label>
              <CustomSelect
                options={providers.map((p) => ({
                  value: p.id,
                  label: p.name,
                  sublabel: `(${p.slug})`,
                }))}
                value={providerId}
                onChange={setProviderId}
                searchable
                placeholder="Pilih Provider..."
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--ink)] mb-1">
                {t("admin.catalog.displayName")} *
              </label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="GPT-6 Luna (OpenAI)"
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--ink)] focus:border-[var(--accent)] outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--ink)] mb-1">
                {t("admin.catalog.shortName")} *
              </label>
              <input
                type="text"
                required
                value={shortName}
                onChange={(e) => setShortName(e.target.value)}
                placeholder="GPT-6 Luna"
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--ink)] focus:border-[var(--accent)] outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--ink)] mb-1">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Model description..."
              className="w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--ink)] focus:border-[var(--accent)] outline-none"
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--ink)] mb-1">
                {t("admin.catalog.category")}
              </label>
              <CustomSelect<"powerful" | "fast" | "balanced" | "flagship" | "image">
                options={[
                  { value: "powerful", label: "Powerful" },
                  { value: "fast", label: "Fast" },
                  { value: "balanced", label: "Balanced" },
                  { value: "flagship", label: "Flagship" },
                  { value: "image", label: "Image (generate_image)" },
                ]}
                value={category}
                onChange={setCategory}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--ink)] mb-1">
                {t("admin.catalog.badge")}
              </label>
              <input
                type="text"
                value={badge}
                onChange={(e) => setBadge(e.target.value)}
                placeholder="Preview"
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--ink)] outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--ink)] mb-1">
                {t("admin.catalog.status")}
              </label>
              <CustomSelect<"active" | "draft" | "deprecated">
                options={[
                  { value: "active", label: t("admin.catalog.statusActive") },
                  { value: "draft", label: t("admin.catalog.statusDraft") },
                  { value: "deprecated", label: t("admin.catalog.statusDeprecated") },
                ]}
                value={status}
                onChange={setStatus}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--ink)] mb-1">
                {t("admin.catalog.sortOrder")}
              </label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(parseInt(e.target.value, 10) || 0)}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--ink)] outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--ink)] mb-1">
                {t("admin.catalog.contextWindow")}
              </label>
              <input
                type="number"
                value={contextWindow}
                onChange={(e) => setContextWindow(e.target.value)}
                placeholder="128000"
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--ink)] outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--ink)] mb-1">
                {t("admin.catalog.maxOutputTokens")}
              </label>
              <input
                type="number"
                value={maxOutputTokens}
                onChange={(e) => setMaxOutputTokens(e.target.value)}
                placeholder="8192"
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--ink)] outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--ink)] mb-1.5">
              {t("admin.catalog.capabilities")}
            </label>
            <div className="flex items-center gap-4 text-xs text-[var(--ink)]">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={supportsVision}
                  onChange={(e) => setSupportsVision(e.target.checked)}
                  className="rounded border-[var(--border)]"
                />
                <span>{t("admin.catalog.vision")}</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={supportsTools}
                  onChange={(e) => setSupportsTools(e.target.checked)}
                  className="rounded border-[var(--border)]"
                />
                <span>{t("admin.catalog.tools")}</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={supportsReasoning}
                  onChange={(e) => setSupportsReasoning(e.target.checked)}
                  className="rounded border-[var(--border)]"
                />
                <span>{t("admin.catalog.reasoning")}</span>
              </label>
            </div>
          </div>

          {/* Pricing Section per 1M Tokens */}
          <div className="border-t border-[var(--border)] pt-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)] mb-2">
              Model Pricing (Per 1 Million Tokens)
            </h4>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--ink)] mb-1">
                  Input Price / 1M
                </label>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={inputPricePerMillion}
                  onChange={(e) => setInputPricePerMillion(e.target.value)}
                  placeholder="0.0000"
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--ink)] outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--ink)] mb-1">
                  Output Price / 1M
                </label>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={outputPricePerMillion}
                  onChange={(e) => setOutputPricePerMillion(e.target.value)}
                  placeholder="0.0000"
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--ink)] outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--ink)] mb-1">
                  Pricing Currency
                </label>
                <input
                  type="text"
                  maxLength={3}
                  value={pricingCurrency}
                  onChange={(e) => setPricingCurrency(e.target.value.toUpperCase())}
                  placeholder="USD"
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--ink)] outline-none font-mono"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Upstream Routing */}
        <div className="space-y-3 pt-2">
          <div className="border-b border-[var(--border)] pb-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
              {t("admin.catalog.sectionRouting")}
            </h3>
            <p className="text-[11px] text-[var(--muted)] mt-0.5">
              {t(isRoundRobin ? "admin.catalog.routingExplanationRoundRobin" : "admin.catalog.routingExplanation")}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--ink)] mb-1">
                {t("admin.catalog.strategy")}
              </label>
              <CustomSelect<RoutingStrategy>
                options={[
                  {
                    value: "priority",
                    label: t("admin.catalog.strategyPriority"),
                    sublabel: t("admin.catalog.strategyPriorityDesc"),
                  },
                  {
                    value: "round_robin",
                    label: t("admin.catalog.strategyRoundRobin"),
                    sublabel: t("admin.catalog.strategyRoundRobinDesc"),
                  },
                ]}
                value={routingStrategy}
                onChange={setRoutingStrategy}
              />
            </div>

            {isRoundRobin && (
              <div>
                <label className="block text-xs font-medium text-[var(--ink)] mb-1">
                  {t("admin.catalog.routeCooldown")}
                </label>
                <input
                  type="number"
                  min={0}
                  max={3600}
                  value={routeCooldownSeconds}
                  onChange={(e) =>
                    setRouteCooldownSeconds(Math.min(3600, Math.max(0, parseInt(e.target.value, 10) || 0)))
                  }
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--ink)] focus:border-[var(--accent)] outline-none"
                />
                <p className="text-[10px] text-[var(--muted)] mt-0.5">{t("admin.catalog.routeCooldownHint")}</p>
              </div>
            )}
          </div>

          {/* Add Route selector */}
          <div className="flex items-center gap-2">
            <UpstreamModelSelect
              options={availableToAdd}
              value={selectedToAdd}
              onChange={setSelectedToAdd}
              placeholder={t("admin.catalog.selectUpstream")}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!selectedToAdd}
              onClick={handleAddRoute}
              className="h-9 px-3 shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t("admin.catalog.addRoute")}</span>
            </Button>
          </div>

          {/* Ordered Routes List */}
          <div className="space-y-2">
            {routes.length === 0 ? (
              <div className="text-center py-4 border border-dashed border-[var(--border)] rounded-lg text-xs text-[var(--muted)]">
                {t("admin.catalog.noRoutes")}
              </div>
            ) : (
              routes.map((r, idx) => {
                const opt = upstreamOptions.find((o) => o.id === r.upstreamModelId);
                return (
                  <div
                    key={r.upstreamModelId}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-[var(--border)] bg-[var(--panel-elevated)]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="grid place-items-center w-5 h-5 rounded-full bg-[var(--accent)] text-[var(--accent-text)] text-[10px] font-bold shrink-0">
                        {r.priority}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <code className="text-xs font-semibold text-[var(--ink)] truncate">
                            {opt?.modelKey ?? r.upstreamModelId}
                          </code>
                          {opt?.gatewayIsPrimary && (
                            <span className="flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20">
                              <ShieldCheck className="w-3 h-3" /> PRIMARY
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-[var(--muted)]">
                          Gateway: {opt?.gatewayName} ({opt?.gatewaySlug})
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {isRoundRobin && (
                        <div className="flex items-center gap-1.5 mr-1">
                          {r.isEnabled && totalEnabledWeight > 0 && (
                            <span className="text-[10px] text-[var(--muted)] tabular-nums">
                              {t("admin.catalog.trafficShare", {
                                percent: String(Math.round((r.weight / totalEnabledWeight) * 100)),
                              })}
                            </span>
                          )}
                          <label className="flex items-center gap-1 text-[10px] text-[var(--muted)]">
                            {t("admin.catalog.weight")}
                            <input
                              type="number"
                              min={1}
                              max={100}
                              value={r.weight}
                              onChange={(e) => handleRouteWeightChange(idx, e.target.value)}
                              className="w-12 px-1.5 py-0.5 text-xs text-center rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--ink)] focus:border-[var(--accent)] outline-none tabular-nums"
                            />
                          </label>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => handleToggleRouteEnabled(idx)}
                        className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                          r.isEnabled
                            ? "bg-emerald-500/10 text-emerald-500"
                            : "bg-zinc-500/10 text-zinc-400"
                        }`}
                      >
                        {r.isEnabled ? "ON" : "OFF"}
                      </button>
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => handleMoveRoute(idx, "up")}
                        className="p-1 text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-20 cursor-pointer"
                        title={t("admin.catalog.moveUp")}
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === routes.length - 1}
                        onClick={() => handleMoveRoute(idx, "down")}
                        className="p-1 text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-20 cursor-pointer"
                        title={t("admin.catalog.moveDown")}
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveRoute(idx)}
                        className="p-1 text-red-400 hover:text-red-500 cursor-pointer"
                        title={t("admin.catalog.removeRoute")}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-4 border-t border-[var(--border)]">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            {t("admin.catalog.cancel")}
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={loading}>
            {loading ? "..." : t("admin.catalog.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
