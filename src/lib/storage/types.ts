export interface R2Config {
  accountId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucketName?: string;
  endpointUrl?: string;
  publicDomain?: string;
}

export interface R2UploadOptions {
  userId: string;
  sessionId: string;
  filename: string;
  content: string | Buffer | Uint8Array;
  contentType?: string;
  isPublic?: boolean;
}

export interface R2UploadResult {
  key: string;
  filename: string;
  sizeBytes: number;
  contentType: string;
  url: string;
}

export interface R2DownloadOptions {
  userId: string;
  sessionId: string;
  filename: string;
  maxBytes?: number;
}

export interface R2DownloadResult {
  key: string;
  filename: string;
  content: Buffer;
  contentType: string;
  sizeBytes: number;
}
