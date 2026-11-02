import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession, requireUser, markUserSessionsRevoked } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { invalidateUserMeCache, invalidateUserSessionsCache } from "@/lib/redis/cache-keys";
import { getRequestId, jsonError, jsonSuccess, ApiError } from "@/lib/api/response";
import { incrementRateCounter, resetRateCounter } from "@/lib/api/rate-limit";

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
    const { user, sessionId } = await requireSession();
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
      // Without a cap this endpoint would brute-force the current password past the login throttle
      const rateKey = `rate:password-change-fail:${user.id}`;
      if ((await incrementRateCounter(rateKey, 15 * 60)) > 10) {
        throw ApiError.rateLimited("Terlalu banyak percobaan. Coba lagi dalam 15 menit.");
      }
      const valid = verifyPassword(parsed.data.currentPassword, dbUser.passwordHash);
      if (!valid) {
        throw ApiError.badRequest("Password saat ini salah");
      }
      await resetRateCounter(rateKey);
    }

    const hashed = hashPassword(parsed.data.newPassword);
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: hashed },
    });

    // A changed password must sign out every other device (e.g. a stolen session)
    await db.authSession.deleteMany({
      where: { userId: user.id, id: { not: sessionId } },
    });
    await markUserSessionsRevoked(user.id);

    await Promise.allSettled([invalidateUserMeCache(user.id), invalidateUserSessionsCache(user.id)]);

    return jsonSuccess({ success: true, message: "Password berhasil diperbarui" }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
