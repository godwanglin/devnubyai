import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess, ApiError } from "@/lib/api/response";
import {
  listUserChatSessions,
  createChatSession,
} from "@/lib/chat/service";

const createChatSchema = z.object({
  title: z.string().trim().max(200).optional(),
  model: z.string().trim().max(128).optional(),
});

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const limit = url.searchParams.get("limit")
      ? parseInt(url.searchParams.get("limit")!, 10)
      : undefined;
    const cursor = url.searchParams.get("cursor") || undefined;
    const archived = url.searchParams.get("archived") === "true";

    const result = await listUserChatSessions(user.id, { limit, cursor, archived });

    return jsonSuccess(result.sessions, {
      requestId,
      meta: { nextCursor: result.nextCursor },
    });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      // Allow empty POST body
      body = {};
    }

    const parsed = createChatSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid chat creation payload", parsed.error.format());
    }

    const session = await createChatSession(user.id, {
      title: parsed.data.title,
      modelPublicId: parsed.data.model,
    });

    return jsonSuccess(session, { status: 201, requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
