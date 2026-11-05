import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { setUserResponseMode } from "@/lib/onboarding/service";
import { RESPONSE_MODES } from "@/lib/preferences/response-mode";

const schema = z.object({
  responseMode: z.enum(RESPONSE_MODES),
});

/** PATCH /api/v1/me/preferences: user display preferences kept on the account */
export async function PATCH(request: Request) {
  const requestId = getRequestId(request);
  try {
    const user = await requireUser();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid preferences", parsed.error.format());
    }
    const preferences = await setUserResponseMode(user.id, parsed.data.responseMode);
    return jsonSuccess({ preferences }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
