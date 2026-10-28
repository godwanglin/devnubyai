import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { uuidv7 } from "@/lib/api/uuidv7";

const REQUEST_ID_HEADER = "x-request-id";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Next.js 16 Proxy (replaces middleware.ts).
 *
 * Responsibilities:
 * 1. Inject RFC 9562 UUIDv7 into x-request-id header (for tracing).
 * 2. CSRF Origin validation for mutating requests (POST/PUT/PATCH/DELETE) under /api/.
 * 3. Optimistic admin gate: ensure presence of session cookie on /api/v1/admin/**.
 *    (Real role='admin' check happens securely in the service layer via requireAdmin()).
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Request ID (reuse incoming or mint a fresh UUIDv7)
  const incomingReqId = request.headers.get(REQUEST_ID_HEADER);
  const requestId =
    incomingReqId && incomingReqId.trim().length > 0 ? incomingReqId.trim() : uuidv7();

  // 2. CSRF Origin check for mutating API requests
  if (pathname.startsWith("/api/") && MUTATING_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");

    if (origin && host) {
      try {
        const originUrl = new URL(origin);
        // Compare origin host with the Host header
        if (originUrl.host !== host) {
          return NextResponse.json(
            {
              error: {
                code: "FORBIDDEN",
                message: "Cross-origin requests are forbidden",
                requestId,
              },
            },
            { status: 403, headers: { [REQUEST_ID_HEADER]: requestId } }
          );
        }
      } catch {
        return NextResponse.json(
          {
            error: {
              code: "BAD_REQUEST",
              message: "Invalid Origin header",
              requestId,
            },
          },
          { status: 400, headers: { [REQUEST_ID_HEADER]: requestId } }
        );
      }
    }
  }

  // 3. Optimistic admin gate (check session cookie existence before hitting backend)
  if (pathname.startsWith("/api/v1/admin/")) {
    const sessionCookie = request.cookies.get("devnuby_session")?.value;
    if (!sessionCookie) {
      return NextResponse.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication required for admin routes",
            requestId,
          },
        },
        { status: 401, headers: { [REQUEST_ID_HEADER]: requestId } }
      );
    }
  }

  // Forward request with injected request-id header
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt
     * - public asset files (png, svg, jpg, webp, etc.)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
