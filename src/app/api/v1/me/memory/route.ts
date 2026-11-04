import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { getMemorySettings } from "@/lib/chat/memory-settings";
import {
  MAX_NOTE_CONTENT_CHARS,
  MAX_NOTE_TITLE_CHARS,
  createUserMemoryNote,
  deleteAllUserMemoryNotes,
  listAllUserMemoryNotes,
} from "@/lib/chat/user-memory";

const createNoteSchema = z.object({
  title: z.string().trim().min(1).max(MAX_NOTE_TITLE_CHARS),
  content: z.string().trim().min(1).max(MAX_NOTE_CONTENT_CHARS),
});

/** GET /api/v1/me/memory: memory preferences + every saved note */
export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const user = await requireUser();
    const [settings, notes] = await Promise.all([
      getMemorySettings(user.id),
      listAllUserMemoryNotes(user.id),
    ]);
    return jsonSuccess({ settings, notes }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

/** POST /api/v1/me/memory: add a note by hand */
export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const user = await requireUser();
    const parsed = createNoteSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid memory note", parsed.error.format());
    }
    const note = await createUserMemoryNote(user.id, parsed.data);
    return jsonSuccess({ note }, { requestId, status: 201 });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

/** DELETE /api/v1/me/memory: forget everything */
export async function DELETE(request: Request) {
  const requestId = getRequestId(request);
  try {
    const user = await requireUser();
    const deleted = await deleteAllUserMemoryNotes(user.id);
    return jsonSuccess({ deleted }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
