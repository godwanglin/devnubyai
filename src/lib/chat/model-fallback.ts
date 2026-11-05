import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";
import { GatewayError } from "@/lib/routing/errors";
import { resolveCandidates } from "@/lib/routing/resolver";
import { getCircuitOpenUntil } from "@/lib/routing/circuit";
import { IMAGE_CATALOG_CATEGORY } from "@/lib/images/settings";
import { assertUserModelAccess } from "./model-access";

/**
 * Cross-model retry of a chat request that failed before writing anything.
 *
 * Mechanism only: how many tries a request gets and which catalog models go first
 * (`routing.request_retry_attempts`, `routing.fallback_model_pattern`) are admin
 * settings in app_settings.
 */

/**
 * What to do with a failure that happened before the model wrote any output:
 * - "switch": the model is out for now (cooldown, busy, quota/account exhausted, every
 *   route down, too slow to answer): move to another catalog model
 * - "same": a transient network blip: the same model may well answer on the next try
 * - null: not retryable (client stopped, the request itself is invalid)
 */
export type RequestRetryKind = "switch" | "same" | null;

export function classifyRequestFailure(err: unknown): RequestRetryKind {
  if (err instanceof Error && err.message === "CLIENT_ABORTED") return null;
  if (err instanceof GatewayError) {
    switch (err.errorClass) {
      case "client_aborted":
      case "bad_request":
        return null;
      case "network":
      case "unknown":
        return "same";
      default:
        // timeout, http_5xx, rate_limited, model_not_found, auth
        return "switch";
    }
  }
  if (err instanceof ApiError) {
    // Every route of the model failed (executor) or the upstream rate limit was hit
    if (err.code === "MODEL_UNAVAILABLE" || err.code === "RATE_LIMITED") return "switch";
    return null;
  }
  return null;
}

/** The admin's pattern as a case-insensitive regex; an invalid one matches literally. */
function patternMatcher(pattern: string): (publicId: string) => boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return () => false;
  try {
    const re = new RegExp(trimmed, "i");
    return (publicId) => re.test(publicId);
  } catch {
    const needle = trimmed.toLowerCase();
    return (publicId) => publicId.toLowerCase().includes(needle);
  }
}

/**
 * Next catalog model to try: active, a chat model (not image), not tried yet, included in
 * the user's plan, able to use tools when the request needs them, and with at least one
 * route that is not in cooldown. Models matching the admin's pattern come first, then the
 * catalog order. Returns the model's public id, or null when nothing else is available.
 */
export async function pickFallbackModel(params: {
  userId: bigint;
  tried: ReadonlySet<string>;
  needsTools: boolean;
  pattern: string;
}): Promise<string | null> {
  const { userId, tried, needsTools, pattern } = params;
  const matches = patternMatcher(pattern);

  const models = await db.catalogModel.findMany({
    where: {
      status: "active",
      category: { not: IMAGE_CATALOG_CATEGORY },
      publicId: { notIn: [...tried] },
      ...(needsTools ? { supportsTools: true } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true, publicId: true },
  });

  // Stable sort keeps the catalog order inside each group
  const ordered = [...models].sort((a, b) => Number(matches(b.publicId)) - Number(matches(a.publicId)));

  for (const model of ordered) {
    try {
      await assertUserModelAccess(userId, model.id);
    } catch {
      continue;
    }
    try {
      // The resolver keeps a tripped route as a last resort; a fallback model needs at
      // least one route whose gateway circuit is closed right now
      const resolved = await resolveCandidates(model.publicId);
      const now = Date.now();
      if (resolved.candidates.some((c) => getCircuitOpenUntil(c.gateway.id, now) === null)) {
        return model.publicId;
      }
    } catch {
      // A model whose routing can't be resolved is skipped, never fatal
    }
  }
  return null;
}
