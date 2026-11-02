import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { downloadFromR2, sanitizeKey } from "@/lib/storage/r2";
import { FILE_RESPONSE_CSP, isImageMimeType } from "@/lib/files/policy";

type RouteContext = { params: Promise<{ token: string; fileId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { token, fileId } = await context.params;
    const cleanToken = token.trim();
    if (!cleanToken || cleanToken.length !== 36) {
      return new NextResponse("Not found", { status: 404 });
    }

    const session = await db.chatSession.findUnique({
      where: { shareToken: cleanToken },
      select: {
        id: true,
        publicId: true,
        user: { select: { publicId: true } },
      },
    });

    if (!session) {
      return new NextResponse("Not found", { status: 404 });
    }

    const sessionFile = await db.sessionFile.findFirst({
      where: {
        publicId: fileId,
        sessionId: session.id,
      },
      select: {
        filename: true,
        mimeType: true,
      },
    });

    if (!sessionFile) {
      return new NextResponse("File not found", { status: 404 });
    }

    const safeFilename = sanitizeKey(sessionFile.filename);
    const downloaded = await downloadFromR2({
      userId: session.user.publicId,
      sessionId: session.publicId,
      filename: safeFilename,
    });

    // Only raster images render inline; anything else (incl. mislabelled SVG) downloads
    const isImage = isImageMimeType(sessionFile.mimeType);

    return new NextResponse(new Uint8Array(downloaded.content), {
      status: 200,
      headers: {
        "Content-Type": sessionFile.mimeType,
        "Content-Length": String(downloaded.sizeBytes),
        "Cache-Control": isImage
          ? "public, max-age=300, stale-while-revalidate=60"
          : "private, max-age=300",
        "Content-Disposition": isImage
          ? `inline; filename="${safeFilename}"`
          : `attachment; filename="${safeFilename}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": FILE_RESPONSE_CSP,
      },
    });
  } catch {
    return new NextResponse("Failed to fetch shared file", { status: 404 });
  }
}
