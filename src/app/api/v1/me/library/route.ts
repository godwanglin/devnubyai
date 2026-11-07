import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { listLibraryFiles } from "@/lib/library/service";

/** GET /api/v1/me/library: every file the user uploaded or the AI made, across chats */
export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const library = await listLibraryFiles(user.id);
    return jsonSuccess(library, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
