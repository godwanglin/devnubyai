import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { updateMemorySettings } from "@/lib/chat/memory-settings";

const settingsSchema = z
  .object({
    memoryEnabled: z.boolean(),
    chatSearchEnabled: z.boolean(),
    includeSensitive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

/** PATCH /api/v1/me/memory/settings: change one or more memory toggles */
export async function PATCH(request: Request) {
  const requestId = getRequestId(request);
  try {
    const user = await requireUser();
    const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid memory settings", parsed.error.format());
    }
    const settings = await updateMemorySettings(user.id, parsed.data);
    return jsonSuccess({ settings }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
