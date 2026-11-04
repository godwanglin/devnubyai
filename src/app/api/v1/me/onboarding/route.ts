import { after } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { completeOnboarding, getUserPreferences } from "@/lib/onboarding/service";
import { INTEREST_IDS, MAX_INTERESTS, ROLE_IDS } from "@/lib/onboarding/options";
import { refreshHomeSuggestions } from "@/lib/chat/home-suggestions";
import { isHomeLocale } from "@/lib/chat/home-suggestions-shared";

const schema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(ROLE_IDS).nullable().optional(),
  interests: z.array(z.enum(INTEREST_IDS)).max(MAX_INTERESTS).optional(),
  skipped: z.boolean().optional(),
  locale: z.string().optional(),
});

/** GET /api/v1/me/onboarding: saved answers + whether onboarding is done */
export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const user = await requireUser();
    return jsonSuccess({ preferences: await getUserPreferences(user.id), name: user.name }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

/** POST /api/v1/me/onboarding: finish (or skip) onboarding */
export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const user = await requireUser();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid onboarding answers", parsed.error.format());
    }
    const { locale, ...input } = parsed.data;
    const preferences = await completeOnboarding(user.id, {
      ...input,
      interests: input.interests ? [...new Set(input.interests)] : undefined,
    });

    // Build the personalized quick prompts now, so they are ready on the home page
    const homeLocale = isHomeLocale(locale ?? null) ? (locale as "id" | "en") : "id";
    after(() => refreshHomeSuggestions(user.id, homeLocale));

    return jsonSuccess({ preferences }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
