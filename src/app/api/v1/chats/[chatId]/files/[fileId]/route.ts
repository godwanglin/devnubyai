import { requireUser } from "@/lib/auth/session";
import { getChatSession } from "@/lib/chat/service";
import { db } from "@/lib/db";
import { uploadToR2, downloadFromR2, sanitizeKey } from "@/lib/storage/r2";
import { FILE_RESPONSE_CSP, MAX_FILE_BYTES, isImageMimeType } from "@/lib/files/policy";
import { assertUploadQuota } from "@/lib/files/upload-quota";
import { ApiError } from "@/lib/api/response";
import { NextResponse } from "next/server";

type RouteContext = { params: Promise<{ chatId: string; fileId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { chatId, fileId } = await context.params;

    const session = await getChatSession(user.id, chatId);

    const sessionFile = await db.sessionFile.findFirst({
      where: {
        publicId: fileId,
        sessionId: session.id,
      },
      select: {
        filename: true,
        mimeType: true,
        sizeBytes: true,
      },
    });

    if (!sessionFile) {
      return new NextResponse("File not found", { status: 404 });
    }

    const downloaded = await downloadFromR2({
      userId: user.publicId,
      sessionId: session.publicId,
      filename: sanitizeKey(sessionFile.filename),
    });

    // Only raster images render inline; anything else (incl. mislabelled SVG) downloads
    const isImage = isImageMimeType(sessionFile.mimeType);
    const safeFilename = sanitizeKey(sessionFile.filename);

    return new NextResponse(new Uint8Array(downloaded.content), {
      status: 200,
      headers: {
        "Content-Type": sessionFile.mimeType,
        "Content-Length": String(downloaded.sizeBytes),
        "Cache-Control": isImage
          ? "private, max-age=300, stale-while-revalidate=60"
          : "no-cache, no-store, must-revalidate, max-age=0",
        ...(isImage ? {} : { Pragma: "no-cache", Expires: "0" }),
        "Content-Disposition": isImage
          ? `inline; filename="${safeFilename}"`
          : `attachment; filename="${safeFilename}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": FILE_RESPONSE_CSP,
      },
    });
  } catch (err: unknown) {
    const errRecord = err as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
    const isNotFound = errRecord?.name === "NoSuchKey" || errRecord?.$metadata?.httpStatusCode === 404;
    return new NextResponse(isNotFound ? "File not found in storage" : "Failed to fetch file", {
      status: isNotFound ? 404 : 500,
    });
  }
}

/**
 * PUT /api/v1/chats/:chatId/files/:fileId
 * Undo an AI edit by restoring the previous file content.
 */
export async function PUT(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { chatId, fileId } = await context.params;

    const session = await getChatSession(user.id, chatId);

    const sessionFile = await db.sessionFile.findFirst({
      where: { publicId: fileId, sessionId: session.id },
      select: { id: true, filename: true, mimeType: true, sizeBytes: true },
    });
    if (!sessionFile) {
      return new NextResponse("File not found", { status: 404 });
    }

    const { content } = (await request.json()) as {
      content?: string;
      reason?: string;
    };
    if (typeof content !== "string") {
      return new NextResponse("Missing 'content' in request body", { status: 400 });
    }

    const extension = sessionFile.filename.includes(".")
      ? sessionFile.filename.slice(sessionFile.filename.lastIndexOf("."))
      : "";
    const maxStemLength = Math.max(1, 128 - extension.length);
    const stem = sessionFile.filename.replace(/^\d+-[a-f0-9]+-/, "").slice(0, maxStemLength);
    const safeFilename = `${stem}${extension}`;

    const buffer = Buffer.from(content, "utf8");
    if (buffer.length > MAX_FILE_BYTES) {
      return new NextResponse("File content exceeds maximum allowed size of 10 MB.", { status: 413 });
    }

    // Growth counts against the agent quota, like the AI edit being undone
    const growth = buffer.length - Number(sessionFile.sizeBytes);
    if (growth > 0) {
      try {
        await assertUploadQuota({ userId: user.id }, "agent", growth);
      } catch (err) {
        if (err instanceof ApiError) return new NextResponse(err.message, { status: err.status });
        throw err;
      }
    }

    await uploadToR2({
      userId: user.publicId,
      sessionId: session.publicId,
      filename: safeFilename,
      content: buffer,
      contentType: sessionFile.mimeType || "text/plain",
    });

    await db.sessionFile.update({
      where: { id: sessionFile.id },
      data: {
        mimeType: sessionFile.mimeType,
        sizeBytes: BigInt(buffer.length),
        filename: safeFilename,
      },
    });

    return new NextResponse(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const errRecord = err as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
    const isNotFound = errRecord?.name === "NoSuchKey" || errRecord?.$metadata?.httpStatusCode === 404;
    return new NextResponse(isNotFound ? "File not found in storage" : "Failed to update file", {
      status: isNotFound ? 404 : 500,
    });
  }
}
