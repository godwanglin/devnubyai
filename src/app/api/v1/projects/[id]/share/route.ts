import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { updateProjectShare, revokeProjectShare } from "@/lib/projects/service";

const updateShareSchema = z.object({
  shareAccess: z.enum(["anyone", "invited"]).optional(),
  invitedEmails: z.array(z.string().email()).optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const parsed = updateShareSchema.safeParse(body);

    const result = await updateProjectShare(user.id, id, {
      shareAccess: parsed.success ? parsed.data.shareAccess : undefined,
      invitedEmails: parsed.success ? parsed.data.invitedEmails : undefined,
    });

    return jsonSuccess(result, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const { id } = await context.params;
    await revokeProjectShare(user.id, id);
    return jsonSuccess({ revoked: true }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
