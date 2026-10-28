import { NextResponse } from "next/server";
import { handleGoogleCallback } from "@/lib/auth/google";
import { getRequestId } from "@/lib/api/response";
import { getPublicOrigin } from "@/lib/api/origin";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const appUrl = getPublicOrigin(request);

  if (errorParam) {
    console.warn(`[AUTH_CALLBACK_DENIED] [${requestId}] Google returned error: ${errorParam}`);
    return NextResponse.redirect(`${appUrl}/login?error=access_denied`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}/login?error=missing_params`);
  }

  try {
    const ipAddress =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      null;
    const userAgent = request.headers.get("user-agent") || null;

    await handleGoogleCallback({
      code,
      state,
      origin: appUrl,
      ipAddress,
      userAgent,
    });

    return NextResponse.redirect(`${appUrl}/`);
  } catch (err) {
    console.error(`[AUTH_CALLBACK_ERROR] [${requestId}]`, err);
    return NextResponse.redirect(`${appUrl}/login?error=auth_failed`);
  }
}
