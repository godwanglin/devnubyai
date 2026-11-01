import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess, ApiError } from "@/lib/api/response";
import { getProjectDetail } from "@/lib/projects/service";
import { createChatSession } from "@/lib/chat/service";

const createProjectChatSchema = z.object({
  title: z.string().trim().max(200).optional(),
  model: z.string().trim().max(128).optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const user = await requireUser();
    const { id } = await context.params;

    const project = await getProjectDetail(user.id, id);
    return jsonSuccess(project.chats, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const user = await requireUser();
    const { id } = await context.params;

    // Verify project exists and user owns it
    await getProjectDetail(user.id, id);

    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const parsed = createProjectChatSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Payload tidak valid", parsed.error.format());
    }

    const session = await createChatSession(user.id, {
      title: parsed.data.title,
      modelPublicId: parsed.data.model,
      projectId: id,
    });

    return jsonSuccess(session, { status: 201, requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
