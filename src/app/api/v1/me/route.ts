import { getSession } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { getCachedJson, setCachedJson } from "@/lib/redis/client";
import { CACHE_KEYS, CACHE_TTL } from "@/lib/redis/cache-keys";
import { getChatSettings } from "@/lib/chat/settings";
import { getUserPreferences } from "@/lib/onboarding/service";
import { effectiveParallelLimit } from "@/lib/chat/concurrency";

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    const session = await getSession();

    // If user is not logged in, return null data so client can gracefully show guest/login state
    if (!session) {
      return jsonSuccess({ user: null }, { requestId });
    }

    const { user } = session;

    // Tool debug inspect is admin-only and read live (not part of the cached payload),
    // so toggling it in /admin/settings applies without waiting for the /me cache to expire.
    const toolDebug =
      user.role === "admin"
        ? await getChatSettings().then((s) => s.toolDebug).catch(() => false)
        : false;

    const cachedPayload = await getCachedJson<{ user: Record<string, unknown> }>(
      CACHE_KEYS.userMe(user.id)
    );
    if (cachedPayload) {
      return jsonSuccess({ user: { ...cachedPayload.user, toolDebug } }, { requestId });
    }

    // Compute initials (e.g., "Aiden Lin" -> "AL")
    const initials =
      user.name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() || "")
        .join("") || "U";

    const responsePayload = {
      user: {
        id: user.publicId,
        name: user.name,
        email: user.email,
        phone: user.phone ?? null,
        initials,
        role: user.role,
        plan: user.plan?.slug ?? "free",
        planLabel: user.plan?.name ?? "Free Plan",
        planExpiresAt: user.planExpiresAt?.toISOString() ?? null,
        avatarUrl: user.avatarUrl,
        // Cached with the rest; finishing onboarding clears this cache
        onboarded: (await getUserPreferences(user.id)).onboarded,
        // Replies the plan may generate at once (server enforces it in claimGenerationSlot)
        maxParallelRequests: effectiveParallelLimit(user.plan?.maxParallelRequests),
      },
    };

    await setCachedJson(CACHE_KEYS.userMe(user.id), responsePayload, CACHE_TTL.USER_ME);

    return jsonSuccess({ user: { ...responsePayload.user, toolDebug } }, { requestId });
  } catch (err) {
    console.error(`[ME_ERROR] [${requestId}]`, err);
    return jsonError(err, { requestId });
  }
}
