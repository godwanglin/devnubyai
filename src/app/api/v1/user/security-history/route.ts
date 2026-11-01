import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { resolveLocationFromIp } from "@/lib/auth/location";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";

export interface SecurityEventDto {
  id: string;
  type: "login" | "logout" | "password_change" | "pin_change";
  title: string;
  deviceLabel: string;
  timestamp: string; // ISO string
  location: string;
  userAgent: string | null;
  ipAddress: string | null;
}

function parseDeviceDetailed(ua: string | null): string {
  if (!ua) return "Perangkat Tidak Dikenal";
  if (/Windows NT 10.0/i.test(ua)) return "Windows 10 Computer";
  if (/Windows NT 11.0/i.test(ua)) return "Windows 11 Computer";
  if (/Windows/i.test(ua)) return "Windows Computer";
  if (/Android\s*([0-9]+)/i.test(ua)) {
    const match = ua.match(/Android\s*([0-9]+)/i);
    return `Android ${match ? match[1] : ""} Phone`.replace(/\s+/g, " ");
  }
  if (/iPhone/i.test(ua)) return "iPhone Mobile";
  if (/iPad/i.test(ua)) return "iPad Tablet";
  if (/Macintosh|Mac OS/i.test(ua)) return "macOS Computer";
  if (/Linux/i.test(ua)) return "Linux Computer";
  if (/WindowsPowerShell|curl/i.test(ua)) return "CLI / Terminal Script";
  return "Perangkat Web";
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    const ctx = await requireSession();

    // Fetch user auth sessions (last 30)
    const sessions = await db.authSession.findMany({
      where: { userId: ctx.user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    const events: SecurityEventDto[] = await Promise.all(
      sessions.map(async (s) => {
        const location = s.location || (await resolveLocationFromIp(s.ipAddress));
        return {
          id: `sess-${s.id}`,
          type: "login",
          title: "Berhasil masuk ke Devnuby",
          deviceLabel: parseDeviceDetailed(s.userAgent),
          timestamp: s.createdAt.toISOString(),
          location,
          userAgent: s.userAgent,
          ipAddress: s.ipAddress,
        };
      })
    );

    return jsonSuccess({ events }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
