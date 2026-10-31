import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getChatSession } from "@/lib/chat/service";
import { listSessionFiles } from "@/lib/chat/share";
import { getRequestId, jsonError, jsonSuccess, ApiError } from "@/lib/api/response";
import { uploadToR2, sanitizeKey } from "@/lib/storage/r2";
import {
  validateUploadCandidate,
  isImageMimeType,
} from "@/lib/files/policy";

type RouteContext = { params: Promise<{ chatId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const { chatId } = await context.params;
    const files = await listSessionFiles(user.id, chatId);
    return jsonSuccess(files, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

/**
 * Validates image magic bytes to prevent MIME type spoofing.
 */
function verifyImageMagic(buffer: Buffer): string | null {
  if (buffer.length < 8) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // WebP: RIFF....WEBP
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  // GIF: GIF87a / GIF89a
  if (buffer.toString("ascii", 0, 3) === "GIF") {
    return "image/gif";
  }

  return null;
}

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const { chatId } = await context.params;

    // Verify chat session ownership
    const session = await getChatSession(user.id, chatId);

    const formData = await request.formData();
    const file = formData.get("file");
    const rawSource = formData.get("source");
    const fileSource = rawSource === "tool" ? "tool" : "upload";

    if (!file || typeof file === "string" || !(file instanceof Blob)) {
      throw ApiError.badRequest("No valid file provided in request");
    }

    const rawName = (file as File).name || "unnamed-file";
    const fileSize = file.size;
    const rawType = file.type || "";
    const safeDisplayName = sanitizeKey(rawName);

    // 1. Validate candidate file against centralized security policy
    const validation = validateUploadCandidate({
      name: rawName,
      size: fileSize,
      type: rawType,
    });

    if (!validation.valid) {
      throw ApiError.badRequest(validation.error || "File rejected by security policy");
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let finalMime = validation.mimeType;

    // 2. Strict magic-bytes verification for images
    if (validation.isImage) {
      const verifiedMime = verifyImageMagic(buffer);
      if (!verifiedMime) {
        throw ApiError.badRequest(
          "Invalid or corrupted image format. Only authentic PNG, JPEG, WebP, and GIF are allowed."
        );
      }
      finalMime = verifiedMime;
    }

    // 3. Prevent filename collision within the same session.
    // Keep the persisted filename within SessionFile.filename's VARCHAR(128).
    const extension = safeDisplayName.includes(".")
      ? safeDisplayName.slice(safeDisplayName.lastIndexOf("."))
      : "";
    const stem = extension
      ? safeDisplayName.slice(0, -extension.length)
      : safeDisplayName;
    const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const maxStemLength = Math.max(1, 128 - suffix.length - extension.length - 1);
    const uniqueFilename = `${suffix}-${stem.slice(0, maxStemLength)}${extension}`;

    // 4. Upload to Cloudflare R2
    const uploadResult = await uploadToR2({
      userId: user.publicId,
      sessionId: session.publicId,
      filename: uniqueFilename,
      content: buffer,
      contentType: finalMime,
    });

    // 5. Persist record in database (session_files)
    const sessionFile = await db.sessionFile.create({
      data: {
        userId: user.id,
        sessionId: session.id,
        filename: uniqueFilename,
        storageKey: uploadResult.key,
        mimeType: finalMime,
        sizeBytes: BigInt(uploadResult.sizeBytes),
        source: fileSource,
      },
    });

    return jsonSuccess(
      {
        id: sessionFile.publicId,
        filename: uniqueFilename,
        displayName: safeDisplayName,
        mimeType: finalMime,
        sizeBytes: uploadResult.sizeBytes,
        source: fileSource,
        isImage: isImageMimeType(finalMime),
        // The R2 bucket is private; browsers load files through the authenticated proxy route.
        url: `/api/v1/chats/${session.publicId}/files/${sessionFile.publicId}`,
      },
      { requestId }
    );
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
