import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess, ApiError } from "@/lib/api/response";
import { uploadToR2, sanitizeKey } from "@/lib/storage/r2";
import { validateUploadCandidate } from "@/lib/files/policy";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const { id: projectPublicId } = await context.params;

    const project = await db.project.findFirst({
      where: { publicId: projectPublicId, userId: user.id },
      select: { id: true },
    });
    if (!project) {
      throw ApiError.notFound("Proyek tidak ditemukan");
    }

    const contentType = request.headers.get("content-type") || "";

    // 1. Text Paste submission
    if (contentType.includes("application/json")) {
      const body = await request.json();
      const text = body?.text?.trim();
      const title = (body?.title?.trim() || "Catatan teks") + ".txt";

      if (!text) {
        throw ApiError.badRequest("Teks tidak boleh kosong");
      }

      const buffer = Buffer.from(text, "utf-8");
      const uploadResult = await uploadToR2({
        userId: user.publicId,
        sessionId: projectPublicId,
        filename: title,
        content: buffer,
        contentType: "text/plain",
      });

      const created = await db.projectFile.create({
        data: {
          projectId: project.id,
          userId: user.id,
          filename: title,
          storageKey: uploadResult.key,
          mimeType: "text/plain",
          sizeBytes: BigInt(uploadResult.sizeBytes),
        },
      });

      return jsonSuccess(
        {
          id: created.publicId,
          filename: created.filename,
          mimeType: created.mimeType,
          sizeBytes: Number(created.sizeBytes),
          createdAt: created.createdAt.toISOString(),
        },
        { requestId }
      );
    }

    // 2. Multipart file upload
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      throw ApiError.badRequest("File tidak valid");
    }

    const validation = validateUploadCandidate({
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
    });

    if (!validation.valid) {
      throw ApiError.badRequest(validation.error || "File tidak diizinkan");
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const safeDisplayName = sanitizeKey(file.name);

    const uploadResult = await uploadToR2({
      userId: user.publicId,
      sessionId: projectPublicId,
      filename: safeDisplayName,
      content: buffer,
      contentType: validation.mimeType,
    });

    const created = await db.projectFile.create({
      data: {
        projectId: project.id,
        userId: user.id,
        filename: safeDisplayName,
        storageKey: uploadResult.key,
        mimeType: validation.mimeType,
        sizeBytes: BigInt(uploadResult.sizeBytes),
      },
    });

    return jsonSuccess(
      {
        id: created.publicId,
        filename: created.filename,
        mimeType: created.mimeType,
        sizeBytes: Number(created.sizeBytes),
        createdAt: created.createdAt.toISOString(),
      },
      { requestId }
    );
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
