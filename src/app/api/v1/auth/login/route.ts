import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { detectLocationFromRequest } from "@/lib/auth/location";
import { ApiError, jsonError, jsonSuccess, getRequestId } from "@/lib/api/response";
import { incrementRateCounter, resetRateCounter } from "@/lib/api/rate-limit";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Failed attempts are counted per account (not per IP, which is spoofable via X-Forwarded-For)
const MAX_FAILED_ATTEMPTS = 10;
const FAILED_WINDOW_SECONDS = 15 * 60;

let dummyPasswordHash: string | null = null;
function getDummyPasswordHash(): string {
  dummyPasswordHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyPasswordHash;
}

function failedLoginKey(normalizedEmail: string): string {
  return `rate:login-fail:${createHash("sha256").update(normalizedEmail).digest("hex")}`;
}

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
    const rateKey = failedLoginKey(normalizedEmail);

    // Count the attempt before checking it, so parallel bursts can't all slip past the cap
    if ((await incrementRateCounter(rateKey, FAILED_WINDOW_SECONDS)) > MAX_FAILED_ATTEMPTS) {
      return jsonError(
        ApiError.rateLimited("Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit."),
        { requestId }
      );
    }

    const user = await db.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || !user.passwordHash) {
      // Spend the same scrypt time as a real check so response timing doesn't reveal accounts
      verifyPassword(password, getDummyPasswordHash());
      return jsonError(ApiError.unauthorized("Email atau kata sandi salah"), { requestId });
    }

    const isValid = verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return jsonError(ApiError.unauthorized("Email atau kata sandi salah"), { requestId });
    }

    await resetRateCounter(rateKey);

    if (user.status !== "active") {
      return jsonError(ApiError.forbidden("Akun Anda telah dinonaktifkan"), { requestId });
    }

    const ipAddress =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      null;
    const userAgent = request.headers.get("user-agent") || null;
    const location = await detectLocationFromRequest(request, ipAddress);

    await createSession({
      userId: user.id,
      ipAddress,
      userAgent,
      location,
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
