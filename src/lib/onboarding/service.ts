import { db } from "@/lib/db";
import { invalidateUserMeCache } from "@/lib/redis/cache-keys";
import { invalidateHomeSuggestions } from "@/lib/chat/home-suggestions";
import { DEFAULT_RESPONSE_MODE, isResponseMode, type ResponseMode } from "@/lib/preferences/response-mode";
import { ONBOARDING_INTERESTS, ONBOARDING_ROLES, type OnboardingInterest, type OnboardingRole } from "./options";

export interface UserPreferences {
  role: OnboardingRole | null;
  interests: OnboardingInterest[];
  onboarded: boolean;
  responseMode: ResponseMode;
}

const roleIds = new Set<string>(ONBOARDING_ROLES.map((r) => r.id));
const interestIds = new Set<string>(ONBOARDING_INTERESTS.map((i) => i.id));

const preferenceSelect = { role: true, interests: true, onboardedAt: true, responseMode: true } as const;

function toPreferences(
  row: { role: string | null; interests: unknown; onboardedAt: Date | null; responseMode: string | null } | null
): UserPreferences {
  return {
    role: row?.role && roleIds.has(row.role) ? (row.role as OnboardingRole) : null,
    interests: Array.isArray(row?.interests)
      ? (row.interests as unknown[]).filter((i): i is OnboardingInterest => typeof i === "string" && interestIds.has(i))
      : [],
    onboarded: Boolean(row?.onboardedAt),
    responseMode: isResponseMode(row?.responseMode) ? row.responseMode : DEFAULT_RESPONSE_MODE,
  };
}

export async function getUserPreferences(userId: bigint): Promise<UserPreferences> {
  const row = await db.userPreference.findUnique({
    where: { userId },
    select: preferenceSelect,
  });
  return toPreferences(row);
}

/** Settings > Appearance > Response display. /me carries it, so its cache is dropped. */
export async function setUserResponseMode(userId: bigint, responseMode: ResponseMode): Promise<UserPreferences> {
  const row = await db.userPreference.upsert({
    where: { userId },
    create: { userId, responseMode },
    update: { responseMode },
    select: preferenceSelect,
  });
  await invalidateUserMeCache(userId);
  return toPreferences(row);
}

/**
 * Saves the onboarding answers (and the name, which lives on the user row) and
 * marks onboarding done. Home suggestions are dropped so the next home visit
 * regenerates them from the new preferences.
 */
export async function completeOnboarding(
  userId: bigint,
  input: { name?: string; role?: OnboardingRole | null; interests?: OnboardingInterest[]; skipped?: boolean }
): Promise<UserPreferences> {
  const now = new Date();
  const data = {
    role: input.role ?? null,
    interests: input.interests ?? [],
    onboardedAt: now,
  };

  const [, row] = await db.$transaction([
    input.name
      ? db.user.update({ where: { id: userId }, data: { name: input.name } })
      : db.user.findUnique({ where: { id: userId }, select: { id: true } }),
    db.userPreference.upsert({
      where: { userId },
      create: { userId, ...data },
      update: input.skipped ? { onboardedAt: now } : data,
      select: preferenceSelect,
    }),
  ]);

  // New name/answers: /me and every stored or cached home suggestion are now stale
  // (an in-flight refresh from before is discarded by the generation bump)
  await Promise.all([invalidateUserMeCache(userId), invalidateHomeSuggestions(userId)]);

  return toPreferences(row);
}

/** English description of the user for AI prompts, or null when they told us nothing. */
export function describePreferences(prefs: UserPreferences): string | null {
  const role = ONBOARDING_ROLES.find((r) => r.id === prefs.role)?.hint;
  const interests = prefs.interests
    .map((id) => ONBOARDING_INTERESTS.find((i) => i.id === id)?.hint)
    .filter(Boolean);
  if (!role && interests.length === 0) return null;
  return [
    role ? `Role: ${role}` : null,
    interests.length ? `Picked interests (what they want help with):\n${interests.map((i) => `- ${i}`).join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
