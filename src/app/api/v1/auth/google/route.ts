import { NextResponse } from "next/server";
import { getGoogleAuthorizationUrl } from "@/lib/auth/google";
import { getRequestId, jsonError } from "@/lib/api/response";
import { getPublicOrigin } from "@/lib/api/origin";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const authUrl = await getGoogleAuthorizationUrl(getPublicOrigin(request));
    return NextResponse.redirect(authUrl);
  } catch (err) {
    console.error(`[AUTH_GOOGLE_ERROR] [${requestId}]`, err);
    return jsonError(err, { requestId });
  }
}
