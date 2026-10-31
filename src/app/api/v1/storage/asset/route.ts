import { NextResponse } from "next/server";
import { downloadAssetFromR2 } from "@/lib/storage/assets";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");

    if (!key) {
      return new NextResponse("Missing key parameter", { status: 400 });
    }

    // Safety checks: allow only assets from safe folders
    const cleanKey = key.replace(/^\/+/, "").replace(/\.\.+/g, "");
    if (!cleanKey.startsWith("payment-methods/")) {
      return new NextResponse("Forbidden path", { status: 403 });
    }

    const { content, contentType, sizeBytes } = await downloadAssetFromR2(cleanKey);

    return new NextResponse(new Uint8Array(content), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(sizeBytes),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.includes("not found") || errorMsg.includes("NoSuchKey")) {
      return new NextResponse("Asset not found", { status: 404 });
    }
    return new NextResponse("Failed to load asset", { status: 500 });
  }
}
