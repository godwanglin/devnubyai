import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { uploadPaymentAssetToR2, resolveAssetUrl } from "@/lib/storage/assets";

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

export async function POST(request: Request) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      throw ApiError.badRequest("Missing multipart form data");
    }

    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      throw ApiError.badRequest("A valid file must be provided under 'file' field");
    }

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      throw ApiError.badRequest(
        `Unsupported image type '${file.type}'. Allowed: PNG, JPEG, WebP, SVG`
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw ApiError.badRequest("File size exceeds 5MB limit");
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const uploaded = await uploadPaymentAssetToR2({
      filename: file.name,
      content: buffer,
      contentType: file.type,
      folder: "payment-methods",
    });

    return jsonSuccess(
      {
        path: uploaded.key,
        filename: uploaded.filename,
        sizeBytes: uploaded.sizeBytes,
        contentType: uploaded.contentType,
        url: resolveAssetUrl(uploaded.key),
      },
      { requestId }
    );
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
