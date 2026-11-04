import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { detectLocationFromRequest } from "@/lib/auth/location";
import { ApiError, jsonError, jsonSuccess, getRequestId } from "@/lib/api/response";
import { incrementRateCounter } from "@/lib/api/rate-limit";
import { getClientIp } from "@/lib/api/client-ip";
import { FREE_PLAN_SLUG } from "@/lib/plans/effective-plan";

const registerSchema = z.object({
  // Asked during onboarding; until then the email's local part stands in
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().email().max(320),
  password: z.string().min(8).max(200),
});

const MAX_REGISTERS_PER_IP = 10;
const WINDOW_SECONDS = 60 * 60;

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const parsed = registerSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError(
        ApiError.badRequest("Email atau kata sandi tidak valid. Kata sandi minimal 8 karakter."),
        { requestId }
      );
    }

    const ipAddress = getClientIp(request);
    if (
      ipAddress !== null &&
      (await incrementRateCounter(`rate:register-ip:${ipAddress}`, WINDOW_SECONDS)) > MAX_REGISTERS_PER_IP
    ) {
      return jsonError(
        ApiError.rateLimited("Terlalu banyak pendaftaran dari jaringan ini. Coba lagi nanti."),
        { requestId }
      );
    }

    const email = parsed.data.email.trim().toLowerCase();
    const name = (parsed.data.name?.trim() || email.split("@")[0] || "User").slice(0, 120);

    const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      return jsonError(ApiError.conflict("Email ini sudah terdaftar. Silakan masuk."), { requestId });
    }

    const freePlan = await db.plan.findUnique({ where: { slug: FREE_PLAN_SLUG }, select: { id: true } });

    const user = await db.user.create({
      data: {
        email,
        name,
        passwordHash: hashPassword(parsed.data.password),
        role: "user",
        status: "active",
        planId: freePlan?.id ?? null,
        lastLoginAt: new Date(),
      },
      select: { id: true, email: true, name: true, avatarUrl: true },
    });

    const userAgent = request.headers.get("user-agent") || null;
    const location = await detectLocationFromRequest(request, ipAddress);
    await createSession({ userId: user.id, ipAddress, userAgent, location });

    return jsonSuccess(
      { user: { id: user.id.toString(), email: user.email, name: user.name, avatarUrl: user.avatarUrl } },
      { requestId, status: 201 }
    );
  } catch (err) {
    // Lost the race with another signup of the same email
    if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
      return jsonError(ApiError.conflict("Email ini sudah terdaftar. Silakan masuk."), { requestId });
    }
    console.error(`[AUTH_REGISTER_ERROR] [${requestId}]`, err);
    return jsonError(ApiError.internal("Terjadi kesalahan saat mendaftar"), { requestId });
  }
}
