import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { ApiError, jsonError, jsonSuccess, getRequestId } from "@/lib/api/response";
import { incrementRateCounter } from "@/lib/api/rate-limit";
import { getClientIp } from "@/lib/api/client-ip";

const schema = z.object({
  email: z.string().email().max(320),
});

const MAX_CHECKS_PER_IP = 30;
const WINDOW_SECONDS = 15 * 60;

/**
 * Whether an email can sign in with a password. The answer is only useful for
 * picking the next field, so it is rate limited and every path spends the same
 * scrypt time — a fast "no" would list which emails exist.
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError(ApiError.badRequest("Email tidak valid"), { requestId });
    }

    const ipAddress = getClientIp(request);
    if (
      ipAddress !== null &&
      (await incrementRateCounter(`rate:check-email:${ipAddress}`, WINDOW_SECONDS)) > MAX_CHECKS_PER_IP
    ) {
      return jsonError(ApiError.rateLimited("Terlalu banyak percobaan. Coba lagi nanti."), { requestId });
    }

    const email = parsed.data.email.trim().toLowerCase();
    const user = await db.user.findUnique({
      where: { email },
      select: { passwordHash: true },
    });

    // A missing account still runs a hash compare so both answers take the same time
    if (!user?.passwordHash) {
      verifyPassword(randomBytes(8).toString("hex"), dummyHash());
    }

    return jsonSuccess({ exists: Boolean(user?.passwordHash) }, { requestId });
  } catch (err) {
    console.error(`[AUTH_CHECK_EMAIL_ERROR] [${requestId}]`, err);
    return jsonError(ApiError.internal("Terjadi kesalahan"), { requestId });
  }
}

let cachedDummy: string | null = null;
function dummyHash(): string {
  cachedDummy ??= hashPassword(randomBytes(16).toString("hex"));
  return cachedDummy;
}
