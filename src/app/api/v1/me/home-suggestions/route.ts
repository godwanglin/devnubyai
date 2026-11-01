import { after } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { isFresh, readHomeSuggestions, refreshHomeSuggestions } from "@/lib/chat/home-suggestions";
import { isHomeLocale } from "@/lib/chat/home-suggestions-shared";

/**
 * Personalized home headlines + quick prompts for `?locale=id|en`.
 * Never waits on the AI: returns the stored set (or `suggestions: null`, meaning
 * "show the defaults") and, when that set is missing or older than 5h, regenerates
 * it after the response so the next page load picks it up.
 */
export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const param = new URL(request.url).searchParams.get("locale");
    const locale = isHomeLocale(param) ? param : "id";

    const stored = await readHomeSuggestions(user.id, locale);
    if (!isFresh(stored)) {
      after(() => refreshHomeSuggestions(user.id, locale));
    }

    return jsonSuccess(
      {
        suggestions: stored
          ? { headlines: stored.headlines, prompts: stored.prompts, generatedAt: stored.generatedAt }
          : null,
      },
      { requestId }
    );
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
