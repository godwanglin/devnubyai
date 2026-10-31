/**
 * Centralized File Policy for Devnuby AI.
 *
 * Isomorphic & safe to import on both server and client (browser).
 * Contains allowed/blocked extensions, MIME mappings, file size limits,
 * preview classification, and security validation helpers.
 */

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB default for documents/spreadsheets
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15MB for screenshots and photos

export type FilePreviewKind =
  | "image"
  | "html"
  | "markdown"
  | "spreadsheet"
  | "pdf"
  | "docx"
  | "svg"
  | "mermaid"
  | "json"
  | "code"
  | "text"
  | "unsupported";

/**
 * Dangerous binary, installer, and executable extensions list.
 * Any upload or tool write matching these extensions is strictly rejected.
 */
export const BLOCKED_EXTENSIONS = new Set<string>([
  // Windows Binaries & Installers
  ".exe",
  ".com",
  ".scr",
  ".pif",
  ".msi",
  ".msp",
  ".dll",
  ".hta",
  ".cpl",
  ".reg",
  ".lnk",
  ".url",
  ".inf",
  ".gadget",
  ".appx",
  ".msix",

  // Legacy Obfuscated Windows Scripts
  ".vbs",
  ".vbe",
  ".jse",
  ".wsf",
  ".wsh",

  // macOS Installers & Application Bundles
  ".app",
  ".dmg",
  ".pkg",
  ".workflow",
  ".scpt",
  ".scptd",
  ".action",
  ".osx",
  ".command",
  ".terminal",

  // Linux / Unix Binaries & Packages
  ".bin",
  ".out",
  ".elf",
  ".so",
  ".deb",
  ".rpm",
  ".appimage",
  ".snap",
  ".flatpak",
  ".run",

  // Mobile App Packages
  ".apk",
  ".aab",
  ".xapk",
  ".ipa",

  // Office Macro Formats
  ".docm",
  ".xlsm",
  ".pptm",
  ".dotm",
  ".xlam",
  ".ppam",
]);

/**
 * Common and supported MIME types by extension.
 * Shared across tools (write_file), attachment upload, and composer file picker.
 */
export const MIME_BY_EXTENSION: Record<string, string> = {
  // Images (Photos, Screenshots)
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "text/plain", // Served as text/plain to prevent inline XSS

  // Text, Markdown & Diagrams
  ".txt": "text/plain",
  ".log": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".mmd": "text/plain",
  ".mermaid": "text/plain",

  // Spreadsheets & Tabular Data
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",

  // Documents
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",

  // Web & Stylesheets
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",

  // Code & Config
  ".ts": "text/plain",
  ".tsx": "text/plain",
  ".js": "text/plain",
  ".jsx": "text/plain",
  ".mjs": "text/plain",
  ".cjs": "text/plain",
  ".json": "application/json",
  ".py": "text/x-python",
  ".go": "text/plain",
  ".rs": "text/plain",
  ".java": "text/plain",
  ".c": "text/plain",
  ".cpp": "text/plain",
  ".h": "text/plain",
  ".cs": "text/plain",
  ".php": "text/plain",
  ".rb": "text/plain",
  ".kt": "text/plain",
  ".swift": "text/plain",
  ".sql": "application/sql",
  ".sh": "text/plain",
  ".bash": "text/plain",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".toml": "text/plain",
  ".ini": "text/plain",
  ".xml": "application/xml",
};

/**
 * Image MIME types supported for multimodal vision analysis & lightbox preview.
 */
export const SUPPORTED_IMAGE_MIMES = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const CODE_HIGHLIGHT_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  cpp: "cpp",
  h: "c",
  cs: "csharp",
  php: "php",
  rb: "ruby",
  kt: "kotlin",
  swift: "swift",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  xml: "xml",
  css: "css",
  html: "html",
  htm: "html",
  json: "json",
  md: "markdown",
  markdown: "markdown",
};

export function getHighlightLanguage(extensionOrFilename: string): string {
  const clean = extensionOrFilename.includes(".")
    ? getExtensionLabel(extensionOrFilename)
    : extensionOrFilename.toLowerCase().replace(/^\./, "");
  return CODE_HIGHLIGHT_MAP[clean] || "text";
}

/**
 * Classifies how a file should be previewed across Devnuby AI.
 * Images open in `ImagePreviewModal`; all other supported kinds open in the right panel.
 */
export function classifyPreviewKind(
  filenameOrExt: string,
  mimeType = ""
): FilePreviewKind {
  const ext = filenameOrExt.includes(".")
    ? getExtensionLabel(filenameOrExt)
    : filenameOrExt.toLowerCase().replace(/^\./, "");
  const mime = mimeType.toLowerCase().trim();

  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext) || isImageMimeType(mime)) {
    return "image";
  }
  if (ext === "svg") return "svg";
  if (ext === "mmd" || ext === "mermaid") return "mermaid";
  if (ext === "html" || ext === "htm" || mime === "text/html") return "html";
  if (ext === "md" || ext === "markdown" || mime === "text/markdown") return "markdown";
  if (
    ["csv", "tsv", "xlsx", "xls"].includes(ext) ||
    mime === "text/csv" ||
    mime === "text/tab-separated-values" ||
    mime.includes("spreadsheetml") ||
    mime === "application/vnd.ms-excel"
  ) {
    return "spreadsheet";
  }
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (ext === "docx" || mime.includes("wordprocessingml.document")) return "docx";
  if (ext === "json" || mime === "application/json") return "json";
  if (ext in CODE_HIGHLIGHT_MAP) return "code";
  if (ext === "txt" || ext === "log" || mime.startsWith("text/")) return "text";
  return "unsupported";
}

/**
 * Extracts lowercase extension including leading dot (e.g. ".png").
 */
export function getFileExtension(filename: string): string {
  const clean = filename.trim().replace(/[.\s]+$/, "");
  const lastDot = clean.lastIndexOf(".");
  return lastDot !== -1 ? clean.slice(lastDot).toLowerCase() : "";
}

/**
 * Checks whether an extension is strictly blocked.
 */
export function isBlockedExtension(filename: string): boolean {
  const ext = getFileExtension(filename);
  return BLOCKED_EXTENSIONS.has(ext);
}

/**
 * Determines MIME type from filename or returns fallback.
 */
export function getMimeTypeForFilename(
  filename: string,
  fallback = "application/octet-stream"
): string {
  const ext = getFileExtension(filename);
  if (ext === ".svg") return "text/plain";
  return MIME_BY_EXTENSION[ext] || fallback;
}

/**
 * Checks whether a given MIME type is an image format suitable for preview & vision.
 */
export function isImageMimeType(mimeType: string): boolean {
  const lower = mimeType.toLowerCase().trim();
  if (lower.includes("svg")) return false;
  return lower.startsWith("image/") && SUPPORTED_IMAGE_MIMES.has(lower);
}

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  isImage: boolean;
  mimeType: string;
}

/**
 * Validates a file candidate before attempting upload.
 */
export function validateUploadCandidate(file: {
  name: string;
  size: number;
  type?: string;
}): FileValidationResult {
  const filename = file.name.trim();

  if (!filename || filename.includes("..") || /[\\/\0]/.test(filename)) {
    return {
      valid: false,
      error: "Filename contains unsafe or illegal characters.",
      isImage: false,
      mimeType: "application/octet-stream",
    };
  }

  const ext = getFileExtension(filename);

  if (BLOCKED_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: `Extension '${ext}' is a shortcut/executable binary and is not allowed.`,
      isImage: false,
      mimeType: "application/octet-stream",
    };
  }

  let mime = file.type?.toLowerCase().trim() || getMimeTypeForFilename(filename);
  if (ext === ".svg" || mime.includes("svg")) {
    mime = "text/plain";
  }

  const isImage =
    isImageMimeType(mime) || [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext);
  const maxBytes = isImage ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;

  if (file.size > maxBytes) {
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    return {
      valid: false,
      error: `File '${filename}' exceeds maximum allowed size of ${maxMb}MB.`,
      isImage,
      mimeType: mime,
    };
  }

  return {
    valid: true,
    isImage,
    mimeType: mime,
  };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDisplayFilename(filename: string): string {
  return filename.replace(/^\d+-[0-9a-f]{8}-/i, "").replace(/^\d+-/, "");
}

export function getExtensionLabel(filename: string): string {
  const ext = getFileExtension(filename).replace(/^\./, "");
  return ext || "file";
}
