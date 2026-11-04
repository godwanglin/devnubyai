import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import {
  MAX_NOTE_CONTENT_CHARS,
  MAX_NOTE_TITLE_CHARS,
  deleteUserMemoryNote,
  updateUserMemoryNote,
} from "@/lib/chat/user-memory";

const updateNoteSchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_NOTE_TITLE_CHARS),
    content: z.string().trim().min(1).max(MAX_NOTE_CONTENT_CHARS),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

type RouteContext = { params: Promise<{ noteId: string }> };

/** PATCH /api/v1/me/memory/[noteId]: edit a note */
export async function PATCH(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const user = await requireUser();
    const { noteId } = await context.params;
    const parsed = updateNoteSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid memory note", parsed.error.format());
    }
    const note = await updateUserMemoryNote(user.id, noteId, parsed.data);
    if (!note) throw ApiError.notFound("Memory note not found");
    return jsonSuccess({ note }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

/** DELETE /api/v1/me/memory/[noteId]: forget one note */
export async function DELETE(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const user = await requireUser();
    const { noteId } = await context.params;
    if (!(await deleteUserMemoryNote(user.id, noteId))) {
      throw ApiError.notFound("Memory note not found");
    }
    return jsonSuccess({ deleted: true }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
