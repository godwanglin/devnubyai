import { NextResponse } from "next/server";
import { handleGoogleCallback } from "@/lib/auth/google";
import { detectLocationFromRequest } from "@/lib/auth/location";
import { getRequestId } from "@/lib/api/response";
import { getPublicOrigin } from "@/lib/api/origin";
import { getClientIp } from "@/lib/api/client-ip";

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
    const ipAddress = getClientIp(request);
    const userAgent = request.headers.get("user-agent") || null;
    const location = await detectLocationFromRequest(request, ipAddress);

    await handleGoogleCallback({
      code,
      state,
      origin: appUrl,
      ipAddress,
      userAgent,
      location,
    });

    return NextResponse.redirect(`${appUrl}/`);
  } catch (err) {
    console.error(`[AUTH_CALLBACK_ERROR] [${requestId}]`, err);
    return NextResponse.redirect(`${appUrl}/login?error=auth_failed`);
  }
}
