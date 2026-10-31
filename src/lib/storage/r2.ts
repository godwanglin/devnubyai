import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import type {
  R2Config,
  R2UploadOptions,
  R2UploadResult,
  R2DownloadOptions,
  R2DownloadResult,
} from "./types";

let s3ClientInstance: S3Client | null = null;

export function getR2Config(): R2Config {
  return {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucketName: process.env.R2_BUCKET_NAME || "devnuby-ai",
    endpointUrl: process.env.R2_ENDPOINT_URL,
    publicDomain: process.env.R2_PUBLIC_DOMAIN,
  };
}

export function getS3Client(): S3Client {
  if (s3ClientInstance) return s3ClientInstance;

  const config = getR2Config();
  if (!config.accessKeyId || !config.secretAccessKey || !config.endpointUrl) {
    throw new Error(
      "Cloudflare R2 is not fully configured. Missing credentials in environment."
    );
  }

  s3ClientInstance = new S3Client({
    region: "auto",
    endpoint: config.endpointUrl,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return s3ClientInstance;
}

/**
 * Sanitizes a filename or key component to prevent path traversal and unsafe characters.
 */
export function sanitizeKey(input: string): string {
  if (!input) return "unnamed-file";

  // Strip null bytes and control chars
  let clean = input.replace(/\0/g, "").trim();

  // Normalize backslashes to forward slashes
  clean = clean.replace(/\\/g, "/");

  // Prevent path traversal markers
  clean = clean.replace(/\.\.+/g, "");

  // Remove leading and trailing slashes
  clean = clean.replace(/^\/+|\/+$/g, "");

  // Only take basename if a full path was passed
  const parts = clean.split("/").filter(Boolean);
  const baseName = parts[parts.length - 1] || "unnamed-file";

  // Replace special characters with hyphens/dots. Keep the extension intact
  // when the original basename is longer than the storage column limit.
  const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (safeName.length <= 128) return safeName;

  const lastDot = safeName.lastIndexOf(".");
  const extension = lastDot > 0 ? safeName.slice(lastDot) : "";
  const stem = extension ? safeName.slice(0, -extension.length) : safeName;
  const maxStemLength = Math.max(1, 128 - extension.length);
  return `${stem.slice(0, maxStemLength)}${extension}`;
}

/**
 * Builds an isolated tenant storage key: users/{userId}/sessions/{sessionId}/{filename}
 */
export function buildTenantKey(
  userId: string,
  sessionId: string,
  filename: string
): string {
  const safeUser = sanitizeKey(userId);
  const safeSession = sanitizeKey(sessionId);
  const safeFile = sanitizeKey(filename);
  return `users/${safeUser}/sessions/${safeSession}/${safeFile}`;
}

/**
 * Uploads an object to R2 with enforced attachment disposition and nosniff headers.
 */
export async function uploadToR2(
  options: R2UploadOptions
): Promise<R2UploadResult> {
  const s3 = getS3Client();
  const config = getR2Config();
  const safeFilename = sanitizeKey(options.filename);
  const key = buildTenantKey(options.userId, options.sessionId, safeFilename);

  const buffer =
    typeof options.content === "string"
      ? Buffer.from(options.content, "utf-8")
      : Buffer.from(options.content);

  const contentType = options.contentType || "application/octet-stream";

  await s3.send(
    new PutObjectCommand({
      Bucket: config.bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ContentDisposition: `attachment; filename="${safeFilename}"`,
      Metadata: {
        "x-uploader-id": options.userId,
        "x-session-id": options.sessionId,
      },
    })
  );

  const publicUrl = config.publicDomain
    ? `${config.publicDomain.replace(/\/$/, "")}/${key}`
    : `${(config.endpointUrl || "").replace(/\/$/, "")}/${config.bucketName}/${key}`;

  return {
    key,
    filename: safeFilename,
    sizeBytes: buffer.length,
    contentType,
    url: publicUrl,
  };
}

/**
 * Downloads and reads an object from R2 with max bytes guard.
 */
export async function downloadFromR2(
  options: R2DownloadOptions
): Promise<R2DownloadResult> {
  const s3 = getS3Client();
  const config = getR2Config();
  const safeFilename = sanitizeKey(options.filename);
  const key = buildTenantKey(options.userId, options.sessionId, safeFilename);

  const maxBytes = options.maxBytes || 25 * 1024 * 1024; // 25MB default

  const res = await s3.send(
    new GetObjectCommand({
      Bucket: config.bucketName,
      Key: key,
    })
  );

  if (!res.Body) {
    throw new Error(`File '${safeFilename}' has no content.`);
  }

  const bytes = await res.Body.transformToByteArray();
  if (bytes.length > maxBytes) {
    throw new Error(
      `File '${safeFilename}' exceeds maximum allowed size of ${maxBytes} bytes.`
    );
  }

  return {
    key,
    filename: safeFilename,
    content: Buffer.from(bytes),
    contentType: res.ContentType || "application/octet-stream",
    sizeBytes: bytes.length,
  };
}

/**
 * Deletes an object in R2 within the tenant scope.
 */
export async function deleteFromR2(
  userId: string,
  sessionId: string,
  filename: string
): Promise<boolean> {
  const s3 = getS3Client();
  const config = getR2Config();
  const key = buildTenantKey(userId, sessionId, filename);

  await s3.send(
    new DeleteObjectCommand({
      Bucket: config.bucketName,
      Key: key,
    })
  );

  return true;
}

/**
 * Deletes an object in R2 directly by its persisted storageKey.
 */
export async function deleteKeyFromR2(storageKey: string): Promise<boolean> {
  const s3 = getS3Client();
  const config = getR2Config();

  await s3.send(
    new DeleteObjectCommand({
      Bucket: config.bucketName,
      Key: storageKey,
    })
  );

  return true;
}

/**
 * Copies an object in R2 into a new session's tenant prefix and returns the new storageKey.
 */
export async function copyInR2(options: {
  sourceKey: string;
  userId: string;
  targetSessionId: string;
  filename: string;
}): Promise<string> {
  const s3 = getS3Client();
  const config = getR2Config();
  const safeFilename = sanitizeKey(options.filename);
  const targetKey = buildTenantKey(options.userId, options.targetSessionId, safeFilename);
  const encodedSource = `${config.bucketName}/${options.sourceKey
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

  await s3.send(
    new CopyObjectCommand({
      Bucket: config.bucketName,
      CopySource: encodedSource,
      Key: targetKey,
    })
  );

  return targetKey;
}

/**
 * Checks if an object exists in R2 without downloading the payload.
 */
export async function objectExistsInR2(
  userId: string,
  sessionId: string,
  filename: string
): Promise<boolean> {
  const s3 = getS3Client();
  const config = getR2Config();
  const key = buildTenantKey(userId, sessionId, filename);

  try {
    await s3.send(
      new HeadObjectCommand({
        Bucket: config.bucketName,
        Key: key,
      })
    );
    return true;
  } catch (err: unknown) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
    if (e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
}
