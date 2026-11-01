import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess, ApiError } from "@/lib/api/response";
import { listUserProjects, createProject } from "@/lib/projects/service";

const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Nama proyek wajib diisi").max(120),
  description: z.string().trim().max(1000).optional(),
  customInstructions: z.string().trim().max(10000).optional(),
});

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const user = await requireUser();
    const projects = await listUserProjects(user.id);
    return jsonSuccess(projects, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const user = await requireUser();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw ApiError.badRequest("Invalid JSON body");
    }

    const parsed = createProjectSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Payload tidak valid", parsed.error.format());
    }

    const project = await createProject(user.id, parsed.data);
    return jsonSuccess(project, { status: 201, requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
