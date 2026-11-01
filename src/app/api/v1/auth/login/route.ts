import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { ApiError, jsonError, jsonSuccess, getRequestId } from "@/lib/api/response";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const body = await request.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(ApiError.badRequest("Format email atau kata sandi tidak valid"), { requestId });
    }

    const { email, password } = parsed.data;
    const normalizedEmail = email.trim().toLowerCase();

    const user = await db.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || !user.passwordHash) {
      return jsonError(ApiError.unauthorized("Email atau kata sandi salah"), { requestId });
    }

    const isValid = verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return jsonError(ApiError.unauthorized("Email atau kata sandi salah"), { requestId });
    }

    if (user.status !== "active") {
      return jsonError(ApiError.forbidden("Akun Anda telah dinonaktifkan"), { requestId });
    }

    const ipAddress =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      null;
    const userAgent = request.headers.get("user-agent") || null;

    await createSession({
      userId: user.id,
      ipAddress,
      userAgent,
    });

    await db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return jsonSuccess(
      {
        user: {
          id: user.id.toString(),
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
        },
      },
      { requestId }
    );
  } catch (err) {
    console.error(`[AUTH_LOGIN_ERROR] [${requestId}]`, err);
    return jsonError(ApiError.internal("Terjadi kesalahan saat masuk"), { requestId });
  }
}
