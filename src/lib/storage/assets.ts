import crypto from "node:crypto";
import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getS3Client, getR2Config, sanitizeKey } from "./r2";

export interface AssetUploadOptions {
  filename: string;
  content: Buffer | Uint8Array;
  contentType?: string;
  folder?: string;
}

export interface AssetUploadResult {
  key: string;
  filename: string;
  sizeBytes: number;
  contentType: string;
}

/**
 * Uploads a public media asset (e.g. payment logo) to Cloudflare R2.
 * The stored key is returned as a relative path without domain.
 */
export async function uploadPaymentAssetToR2(
  options: AssetUploadOptions
): Promise<AssetUploadResult> {
  const s3 = getS3Client();
  const config = getR2Config();

  const folder = options.folder || "payment-methods";
  const safeFilename = sanitizeKey(options.filename);
  const randomSuffix = crypto.randomBytes(4).toString("hex");
  const key = `${folder}/${Date.now()}-${randomSuffix}-${safeFilename}`;

  const buffer = Buffer.isBuffer(options.content)
    ? options.content
    : Buffer.from(options.content);

  const contentType = options.contentType || "image/png";

  await s3.send(
    new PutObjectCommand({
      Bucket: config.bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    })
  );

  return {
    key,
    filename: safeFilename,
    sizeBytes: buffer.length,
    contentType,
  };
}

/**
 * Downloads a stored asset from R2 by its exact key.
 */
export async function downloadAssetFromR2(key: string): Promise<{
  content: Uint8Array;
  contentType: string;
  sizeBytes: number;
}> {
  const s3 = getS3Client();
  const config = getR2Config();

  // Basic path sanitization to prevent traversal
  const normalizedKey = key.replace(/^\/+/, "").replace(/\.\.+/g, "");

  const res = await s3.send(
    new GetObjectCommand({
      Bucket: config.bucketName,
      Key: normalizedKey,
    })
  );

  const contentType = res.ContentType || "application/octet-stream";
  const sizeBytes = Number(res.ContentLength || 0);

  if (!res.Body) {
    throw new Error(`Asset not found: ${normalizedKey}`);
  }

  const chunks: Uint8Array[] = [];
  // @ts-expect-error AWS S3 Body stream async iterable
  for await (const chunk of res.Body) {
    chunks.push(chunk instanceof Uint8Array ? chunk : Buffer.from(chunk));
  }

  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const c of chunks) {
    combined.set(c, offset);
    offset += c.length;
  }

  return {
    content: combined,
    contentType,
    sizeBytes: sizeBytes || combined.length,
  };
}

/**
 * Deletes an asset from R2.
 */
export async function deleteAssetFromR2(key: string): Promise<boolean> {
  const s3 = getS3Client();
  const config = getR2Config();
  const normalizedKey = key.replace(/^\/+/, "").replace(/\.\.+/g, "");

  await s3.send(
    new DeleteObjectCommand({
      Bucket: config.bucketName,
      Key: normalizedKey,
    })
  );

  return true;
}

/**
 * Resolves an asset path to a browser-loadable URL.
 * Handles external URLs, local static files, and R2 relative paths.
 */
export function resolveAssetUrl(imagePath: string | null | undefined): string {
  if (!imagePath) return "/images/payments/default.svg";

  if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) {
    return imagePath;
  }

  if (imagePath.startsWith("/")) {
    return imagePath;
  }

  const config = getR2Config();
  if (config.publicDomain) {
    return `${config.publicDomain.replace(/\/$/, "")}/${imagePath}`;
  }

  return `/api/v1/storage/asset?key=${encodeURIComponent(imagePath)}`;
}
