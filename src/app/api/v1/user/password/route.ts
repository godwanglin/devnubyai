import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { invalidateUserMeCache } from "@/lib/redis/cache-keys";
import { getRequestId, jsonError, jsonSuccess, ApiError } from "@/lib/api/response";

const changePasswordSchema = z
  .object({
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8, "Password baru minimal 8 karakter").max(100),
    confirmPassword: z.string().min(8),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Konfirmasi password tidak cocok",
    path: ["confirmPassword"],
  });

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });

    return jsonSuccess({ hasPassword: Boolean(dbUser?.passwordHash) }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const body = await request.json().catch(() => ({}));
    const parsed = changePasswordSchema.safeParse(body);

    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues[0]?.message || "Input tidak valid");
    }

    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });

    if (dbUser?.passwordHash) {
      if (!parsed.data.currentPassword) {
        throw ApiError.badRequest("Password saat ini wajib diisi");
      }
      const valid = verifyPassword(parsed.data.currentPassword, dbUser.passwordHash);
      if (!valid) {
        throw ApiError.badRequest("Password saat ini salah");
      }
    }

    const hashed = hashPassword(parsed.data.newPassword);
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: hashed },
    });

    await invalidateUserMeCache(user.id);

    return jsonSuccess({ success: true, message: "Password berhasil diperbarui" }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
