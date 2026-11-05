import { db } from "@/lib/db";
import { getGatewayById } from "@/lib/gateways/repository";
import {
  loadConnectionPool,
  isConnectionQuotaExhausted,
  type PoolConnection,
} from "@/lib/gateways/oauth-dispatch";
import { resolveAntigravityProjectId, buildAntigravityHeaders } from "@/lib/gateways/antigravity-auth";
import { refreshConnectionToken } from "@/lib/oauth/token-refresh";
import { markSuccess, markFailure } from "@/lib/routing/circuit";
import { classifyHttpError, GatewayError } from "@/lib/routing/errors";
import { getRoutingSettings } from "@/lib/routing/settings";
import { resolveCandidates } from "@/lib/routing/resolver";
import { getImageAdapter, ImageUpstreamError } from "./adapters";
import { getImageSettings, IMAGE_CATALOG_SETTING_KEY } from "./settings";
import {
  postProcessGeneratedImage,
  type ImagePostProcessOptions,
  type ProcessedImageResult,
} from "./post-process";
import type { CandidateRoute, DecryptedGatewayConfig } from "@/lib/gateways/types";

export interface GenerateImageOptions extends ImagePostProcessOptions {
  signal?: AbortSignal;
}

export interface GeneratedImageOutput extends ProcessedImageResult {
  modelUsed: string;
  gatewayUsed: string;
  accountEmailUsed: string;
}

export class ImageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageConfigError";
  }
}

/**
 * Routes of the primary model first, then the fallback models' routes in the order the
 * admin set. A model that appears twice keeps only its first occurrence. Each model's own
 * strategy, circuits and cooldowns come from the same resolver chat routing uses.
 */
async function resolveImageRoutes(): Promise<CandidateRoute[]> {
  const settings = await getImageSettings();
  if (!settings.catalogModelId) {
    throw new ImageConfigError(
      `Pengaturan '${IMAGE_CATALOG_SETTING_KEY}' belum diatur. Pilih model katalog pembuat gambar di /admin/settings.`
    );
  }

  const routes: CandidateRoute[] = [];
  const seen = new Set<string>();
  for (const publicId of [settings.catalogModelId, ...settings.fallbackModelIds]) {
    if (seen.has(publicId)) continue;
    seen.add(publicId);
    try {
      const resolved = await resolveCandidates(publicId);
      routes.push(...resolved.candidates);
    } catch (err) {
      // A deleted or disabled fallback model must not sink the whole request
      console.warn(`[Image Gen] Catalog model '${publicId}' skipped:`, err instanceof Error ? err.message : err);
    }
  }
  return routes;
}

async function prepareAuthHeaders(
  gw: DecryptedGatewayConfig,
  conn: PoolConnection,
  accessToken: string
): Promise<Record<string, string>> {
  let headers: Record<string, string> = { ...(gw.extraHeaders ?? {}) };
  if (gw.oauthProvider === "antigravity") {
    const pd = (conn.providerData && typeof conn.providerData === "object"
      ? (conn.providerData as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    const projectId = await resolveAntigravityProjectId(
      { id: conn.id, providerData: pd },
      accessToken
    );
    headers = buildAntigravityHeaders(conn.id, projectId, gw.extraHeaders);
  }
  if (gw.oauthProvider === "openai") {
    // Binds the request to this pool account; without it multi-account pools cross-bind
    const pd = (conn.providerData ?? {}) as Record<string, unknown>;
    const accountId = [pd.chatgptAccountId, pd.workspaceId, pd.accountId].find(
      (v): v is string => typeof v === "string" && v.length > 0
    );
    if (accountId) headers["ChatGPT-Account-ID"] = accountId;
  }
  return headers;
}

function toGatewayError(err: unknown, gw: DecryptedGatewayConfig): GatewayError {
  if (err instanceof GatewayError) return err;
  const status = err instanceof ImageUpstreamError ? err.httpStatus : null;
  const bodyText = err instanceof ImageUpstreamError ? err.bodyText : "";
  const message = err instanceof Error ? err.message : String(err);
  const errorClass = status !== null ? classifyHttpError(status, bodyText || message) : "unknown";
  return new GatewayError({ errorClass, httpStatus: status, message: `${gw.name}: ${message}` });
}

/**
 * Execute image generation with automatic account pool & cross-provider fallback.
 */
export async function executeImageGeneration(
  prompt: string,
  options: GenerateImageOptions = {}
): Promise<GeneratedImageOutput> {
  const candidates = await resolveImageRoutes();
  if (candidates.length === 0) {
    throw new ImageConfigError(
      "Model katalog pembuat gambar tidak punya route aktif. Tambahkan route ke upstream model gambar di /admin/model-catalog."
    );
  }

  const settings = await getRoutingSettings();
  const now = Date.now();
  let lastError: Error | null = null;

  for (const candidate of candidates) {
    const gw = await getGatewayById(candidate.gateway.id);
    if (!gw || !gw.isEnabled) continue;

    const adapter = getImageAdapter(gw.oauthProvider);
    if (!adapter) {
      console.warn(`[Image Gen] No image adapter for provider '${gw.oauthProvider}', skipping.`);
      continue;
    }

    const pool = await loadConnectionPool(gw.id);
    if (pool.length === 0) continue;

    for (const conn of pool) {
      if (isConnectionQuotaExhausted(conn, now, candidate.upstreamModelKey)) {
        continue;
      }

      let accessToken: string;
      try {
        accessToken = await refreshConnectionToken(conn.id);
      } catch (err) {
        console.warn(`[Image Gen] Token refresh failed for account ${conn.email}:`, err);
        continue;
      }

      const headers = await prepareAuthHeaders(gw, conn, accessToken);

      try {
        const rawResult = await adapter(
          { accessToken, headers, baseUrl: gw.baseUrl },
          candidate.upstreamModelKey,
          prompt,
          options
        );

        // Post-process: resize & background removal
        const processed = await postProcessGeneratedImage(rawResult.buffer, options);

        // Mark circuit success & account last used
        markSuccess(gw.id);
        await db.providerConnection
          .update({
            where: { id: conn.id },
            data: { lastUsedAt: new Date(), lastError: null },
          })
          .catch(() => {});

        return {
          ...processed,
          modelUsed: candidate.upstreamModelKey,
          gatewayUsed: gw.name,
          accountEmailUsed: conn.email || "oauth-account",
        };
      } catch (err) {
        const gwError = toGatewayError(err, gw);
        markFailure(gw.id, gwError, settings);
        lastError = gwError;

        console.warn(
          `[Image Gen Fallback] Model '${candidate.upstreamModelKey}' on account ${conn.email} failed: ${gwError.message}. Switching to next candidate...`
        );
      }
    }
  }

  throw (
    lastError ||
    new Error("Semua kandidat akun dan model generator gambar gagal memproses permintaan.")
  );
}
