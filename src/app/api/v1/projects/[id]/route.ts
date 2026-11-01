import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess, ApiError } from "@/lib/api/response";
import {
  getProjectDetail,
  updateProject,
  deleteProject,
} from "@/lib/projects/service";

const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  customInstructions: z.string().trim().max(10000).nullable().optional(),
  isPinned: z.boolean().optional(),
  isArchived: z.boolean().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const user = await requireUser();
    const { id } = await context.params;

    const project = await getProjectDetail(user.id, id);
    return jsonSuccess(project, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const user = await requireUser();
    const { id } = await context.params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw ApiError.badRequest("Invalid JSON body");
    }

    const parsed = updateProjectSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Payload tidak valid", parsed.error.format());
    }

    const updated = await updateProject(user.id, id, parsed.data);
    return jsonSuccess(updated, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const user = await requireUser();
    const { id } = await context.params;

    const url = new URL(request.url);
    const cascade = url.searchParams.get("cascade") === "true";

    await deleteProject(user.id, id, cascade);
    return jsonSuccess({ success: true, id }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
