import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto/vault";
import { recordAdminAudit } from "@/lib/admin/audit";
import { ApiError } from "@/lib/api/response";
import { extractChatGptAccountInfo } from "@/lib/oauth/openai-oauth";
import { extractUserIdFromToken } from "@/lib/oauth/token-refresh";
import {
  getOrCreateOAuthGateway,
  refreshSingleConnectionQuota,
} from "./provider-service";
import type { Prisma } from "@/generated/client";

export const MAX_BULK_ACCOUNTS = 100;

export interface NormalizedAccount {
  /** Position in the original input, so results line up with what the admin pasted */
  index: number;
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  email: string | null;
  displayName: string | null;
  label: string | null;
  upstreamUserId: string | null;
  chatgptAccountId: string | null;
  chatgptPlanType: string | null;
  expiresAt: Date | null;
  providerData: Record<string, unknown>;
}

export interface ParseBulkResult {
  items: NormalizedAccount[];
  errors: { index: number; error: string }[];
}

export interface BulkImportItemResult {
  index: number;
  status: "created" | "updated" | "failed";
  id?: string;
  email?: string | null;
  plan?: string | null;
  error?: string;
}

export interface BulkImportResponse {
  created: number;
  updated: number;
  failed: number;
  results: BulkImportItemResult[];
}

function parseJwtExp(jwt?: string | null): Date | null {
  if (!jwt) return null;
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
    const exp = typeof payload.exp === "number" ? payload.exp : null;
    return exp && exp > 0 ? new Date(exp * 1000) : null;
  } catch {
    return null;
  }
}

function parseIsoOrEpoch(v: unknown): Date | null {
  if (!v) return null;
  if (typeof v === "number" && v > 0) {
    return new Date(v < 1e12 ? v * 1000 : v);
  }
  if (typeof v === "string" && v.trim()) {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
}

/**
 * Normalizes input variations into a flat array of objects:
 * - `[{...}, {...}]`
 * - `{ "accounts": [...] }`
 * - Single `{...}`
 * - Codex CLI `auth.json`: `{ tokens: { access_token, refresh_token, id_token, account_id } }`
 */
function extractRawItems(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    const r = body as Record<string, unknown>;
    if (Array.isArray(r.accounts)) return r.accounts;
    // Single account object (incl. Codex CLI auth.json, unwrapped per item later)
    return [r];
  }
  return [];
}

/**
 * Pure parsing & validation helper (no DB/network).
 * Extracts tokens, backfills identity from JWT claims, and deduplicates within the batch.
 */
export function parseBulkImportPayload(body: unknown): ParseBulkResult {
  const rawList = extractRawItems(body);
  if (rawList.length === 0) {
    throw ApiError.badRequest("Tidak ada akun yang ditemukan pada input JSON");
  }
  if (rawList.length > MAX_BULK_ACCOUNTS) {
    throw ApiError.badRequest(`Maksimal ${MAX_BULK_ACCOUNTS} akun per satu kali import`);
  }
  const items: NormalizedAccount[] = [];
  const errors: { index: number; error: string }[] = [];
  const seenKeys = new Set<string>();

  for (let i = 0; i < rawList.length; i++) {
    const raw = rawList[i];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      errors.push({ index: i, error: "Item bukan objek JSON yang valid" });
      continue;
    }

    const r = raw as Record<string, unknown>;
    // Codex CLI auth.json wrapper
    const tokens = (r.tokens && typeof r.tokens === "object" ? r.tokens : null) as Record<string, unknown> | null;

    const accessToken =
      (typeof r.accessToken === "string" && r.accessToken) ||
      (typeof r.access_token === "string" && r.access_token) ||
      (tokens && typeof tokens.access_token === "string" && tokens.access_token) ||
      (tokens && typeof tokens.accessToken === "string" && tokens.accessToken) ||
      null;

    if (!accessToken) {
      errors.push({ index: i, error: "Field accessToken wajib diisi" });
      continue;
    }

    const refreshToken =
      (typeof r.refreshToken === "string" && r.refreshToken) ||
      (typeof r.refresh_token === "string" && r.refresh_token) ||
      (tokens && typeof tokens.refresh_token === "string" && tokens.refresh_token) ||
      (tokens && typeof tokens.refreshToken === "string" && tokens.refreshToken) ||
      undefined;

    const idToken =
      (typeof r.idToken === "string" && r.idToken) ||
      (typeof r.id_token === "string" && r.id_token) ||
      (tokens && typeof tokens.id_token === "string" && tokens.id_token) ||
      (tokens && typeof tokens.idToken === "string" && tokens.idToken) ||
      undefined;

    // Backfill ChatGPT identity claims from idToken, fallback accessToken
    const info = extractChatGptAccountInfo(idToken || accessToken);
    const email =
      (typeof r.email === "string" && r.email) ||
      (tokens && typeof tokens.email === "string" && tokens.email) ||
      info.email ||
      null;

    const accountIdFromRoot =
      (typeof r.chatgptAccountId === "string" && r.chatgptAccountId) ||
      (typeof r.chatgpt_account_id === "string" && r.chatgpt_account_id) ||
      (tokens && typeof tokens.account_id === "string" && tokens.account_id) ||
      null;

    const chatgptAccountId = accountIdFromRoot || info.chatgptAccountId || null;
    const chatgptPlanType =
      (typeof r.chatgptPlanType === "string" && r.chatgptPlanType) ||
      (typeof r.chatgpt_plan_type === "string" && r.chatgpt_plan_type) ||
      info.chatgptPlanType ||
      null;

    const upstreamUserId = extractUserIdFromToken(idToken) || extractUserIdFromToken(accessToken) || null;

    // Expiry calculation
    const expiresIn =
      (typeof r.expiresIn === "number" && r.expiresIn) ||
      (typeof r.expires_in === "number" && r.expires_in) ||
      null;
    const expiresAtRaw = r.expiresAt ?? r.expires_at;
    const expiresAt =
      parseIsoOrEpoch(expiresAtRaw) ||
      (expiresIn && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null) ||
      parseJwtExp(accessToken);

    const displayName =
      (typeof r.displayName === "string" && r.displayName) ||
      (typeof r.display_name === "string" && r.display_name) ||
      null;

    const label =
      (typeof r.label === "string" && r.label) ||
      displayName ||
      email ||
      (chatgptAccountId ? `Codex ${chatgptAccountId.slice(-6)}` : null);

    // Intra-batch deduplication key: prefer chatgptAccountId, fallback email, fallback first 24 chars of accessToken
    const dedupeKey = chatgptAccountId ? `acc:${chatgptAccountId}` : email ? `email:${email.toLowerCase()}` : `token:${accessToken.slice(0, 24)}`;
    if (seenKeys.has(dedupeKey)) {
      errors.push({ index: i, error: `Duplikat akun di dalam input (${dedupeKey})` });
      continue;
    }
    seenKeys.add(dedupeKey);

    const providerData: Record<string, unknown> = {
      authMethod: "pkce",
      chatgptAccountId,
      chatgptPlanType,
      source: "bulk_import",
      importedAt: new Date().toISOString(),
    };

    items.push({
      index: i,
      accessToken,
      refreshToken,
      idToken,
      email,
      displayName,
      label,
      upstreamUserId,
      chatgptAccountId,
      chatgptPlanType,
      expiresAt,
      providerData,
    });
  }

  return { items, errors };
}

/**
 * Bulk import multiple OpenAI / Codex accounts into the gateway pool.
 * - Deduplicates against existing connections: matches chatgptAccountId (fallback email).
 * - Matches update tokens & clear cooldown; new ones are appended.
 * - Single admin audit entry records the entire batch without logging raw tokens.
 */
export async function bulkImportOpenAiConnections(
  rawBody: unknown,
  actorUserId: bigint
): Promise<BulkImportResponse> {
  const { items, errors } = parseBulkImportPayload(rawBody);

  const gw = await getOrCreateOAuthGateway("openai", actorUserId);

  // Load existing connections to dedupe against pool
  const existing = await db.providerConnection.findMany({
    where: { gatewayId: gw.id },
    select: {
      id: true,
      email: true,
      providerData: true,
      sortOrder: true,
    },
    orderBy: { sortOrder: "desc" },
  });

  const existingByAccountId = new Map<string, typeof existing[number]>();
  const existingByEmail = new Map<string, typeof existing[number]>();
  for (const c of existing) {
    const pd = (c.providerData && typeof c.providerData === "object" ? c.providerData : {}) as Record<string, unknown>;
    if (typeof pd.chatgptAccountId === "string" && pd.chatgptAccountId) {
      existingByAccountId.set(pd.chatgptAccountId, c);
    }
    if (c.email) {
      existingByEmail.set(c.email.toLowerCase(), c);
    }
  }

  let nextSortOrder = (existing[0]?.sortOrder ?? 0) + 10;

  const results: BulkImportItemResult[] = [];
  const affectedIds: bigint[] = [];
  let createdCount = 0;
  let updatedCount = 0;

  // Insert parse errors first so indexing matches original input
  for (const err of errors) {
    results.push({ index: err.index, status: "failed", error: err.error });
  }

  // Serial processing prevents sortOrder race conditions
  for (const item of items) {
    const i = item.index;
    try {
      const match =
        (item.chatgptAccountId ? existingByAccountId.get(item.chatgptAccountId) : null) ||
        (item.email ? existingByEmail.get(item.email.toLowerCase()) : null);

      const accessTokenCiphertext = encryptSecret(item.accessToken);
      const refreshTokenCiphertext = item.refreshToken ? encryptSecret(item.refreshToken) : null;
      const idTokenCiphertext = item.idToken ? encryptSecret(item.idToken) : null;

      if (match) {
        // Update existing connection tokens and clear cooldown
        const updated = await db.providerConnection.update({
          where: { id: match.id },
          data: {
            accessTokenCiphertext,
            ...(refreshTokenCiphertext ? { refreshTokenCiphertext } : {}),
            ...(idTokenCiphertext ? { idTokenCiphertext } : {}),
            ...(item.expiresAt ? { expiresAt: item.expiresAt } : {}),
            ...(item.email && !match.email ? { email: item.email } : {}),
            providerData: item.providerData as unknown as Prisma.InputJsonValue,
            cooldownUntil: null,
            lastError: null,
            isEnabled: true,
          },
        });

        results.push({
          index: i,
          status: "updated",
          id: updated.id.toString(),
          email: item.email,
          plan: item.chatgptPlanType,
        });
        affectedIds.push(updated.id);
        updatedCount++;
      } else {
        const created = await db.providerConnection.create({
          data: {
            gatewayId: gw.id,
            label: item.label || `Account ${nextSortOrder / 10}`,
            email: item.email,
            displayName: item.displayName,
            upstreamUserId: item.upstreamUserId,
            accessTokenCiphertext,
            refreshTokenCiphertext,
            idTokenCiphertext,
            expiresAt: item.expiresAt,
            providerData: item.providerData as unknown as Prisma.InputJsonValue,
            isEnabled: true,
            sortOrder: nextSortOrder,
          },
        });

        results.push({
          index: i,
          status: "created",
          id: created.id.toString(),
          email: item.email,
          plan: item.chatgptPlanType,
        });
        affectedIds.push(created.id);
        nextSortOrder += 10;
        createdCount++;
      }
    } catch (err) {
      results.push({
        index: i,
        status: "failed",
        email: item.email,
        error: err instanceof Error ? err.message : "Gagal menyimpan akun",
      });
    }
  }

  // Audit record (tokens NEVER stored)
  await recordAdminAudit({
    actorUserId,
    action: "provider_connection.bulk_import",
    entityType: "gateway",
    entityId: gw.id.toString(),
    afterState: {
      provider: "openai",
      totalSubmitted: items.length + errors.length,
      created: createdCount,
      updated: updatedCount,
      failed: results.filter((r) => r.status === "failed").length,
      affectedIds: affectedIds.map((id) => id.toString()),
    },
  });

  // Background refresh quota for all affected accounts (fire-and-forget)
  for (const connId of affectedIds) {
    void refreshSingleConnectionQuota(connId, "openai").catch(() => {});
  }

  // Sort results by index so UI matches input order
  results.sort((a, b) => a.index - b.index);

  return {
    created: createdCount,
    updated: updatedCount,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  };
}
