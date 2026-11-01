import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess, ApiError } from "@/lib/api/response";
import { hashPin, verifyPin } from "@/lib/auth/pin";

const pinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, "PIN harus berupa 4 digit angka"),
});

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { chatPinHash: true },
    });

    return jsonSuccess({ hasPin: Boolean(dbUser?.chatPinHash) }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const body = await request.json().catch(() => ({}));
    const parsed = pinSchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues[0]?.message || "PIN tidak valid");
    }

    const hashed = hashPin(parsed.data.pin);

    await db.user.update({
      where: { id: user.id },
      data: { chatPinHash: hashed },
    });

    return jsonSuccess({ success: true, hasPin: true }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function PUT(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const body = await request.json().catch(() => ({}));
    const parsed = pinSchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues[0]?.message || "PIN tidak valid");
    }

    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { chatPinHash: true },
    });

    if (!dbUser?.chatPinHash) {
      throw ApiError.badRequest("PIN belum diatur");
    }

    const isValid = verifyPin(parsed.data.pin, dbUser.chatPinHash);
    return jsonSuccess({ valid: isValid }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
