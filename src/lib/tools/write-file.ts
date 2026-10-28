import { uploadToR2 } from "../storage/r2";
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB

// Dangerous binary, installer, and executable extensions list
const BLOCKED_EXTENSIONS = new Set([
  // Windows Binaries & Installers
  ".exe", ".com", ".scr", ".pif", ".msi", ".msp", ".dll",
  ".hta", ".cpl", ".reg", ".lnk", ".inf", ".gadget", ".appx", ".msix",

  // Legacy Obfuscated Windows Scripts
  ".vbs", ".vbe", ".jse", ".wsf", ".wsh",

  // macOS Installers & Application Bundles
  ".app", ".dmg", ".pkg", ".workflow", ".scpt", ".scptd", ".action", ".osx", ".command", ".terminal",

  // Linux / Unix Binaries & Packages
  ".bin", ".out", ".elf", ".so", ".deb", ".rpm", ".appimage", ".snap", ".flatpak", ".run",

  // Mobile App Packages
  ".apk", ".aab", ".xapk", ".ipa",

  // Office Macro Formats
  ".docm", ".xlsm", ".pptm", ".dotm", ".xlam", ".ppam",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".html": "text/html",
  ".css": "text/css",
  ".ts": "text/plain",
  ".tsx": "text/plain",
  ".js": "text/plain",
  ".jsx": "text/plain",
  ".py": "text/x-python",
  ".go": "text/plain",
  ".sql": "application/sql",
  ".svg": "text/plain", // Served as text/plain to prevent inline XSS
};

export interface WriteFileParams {
  filename: string;
  content: string;
  mimeType?: string;
}

export interface WriteFileData {
  key: string;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  url: string;
}

export const writeFileTool: ToolDefinition<WriteFileParams, WriteFileData> = {
  name: "write_file",
  description: "Saves a generated text or code document into the user's session storage.",
  parameters: {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description: "The desired filename (e.g. analysis.md, script.py, config.json).",
        required: true,
      },
      content: {
        type: "string",
        description: "The complete UTF-8 content to write into the file.",
        required: true,
      },
      mimeType: {
        type: "string",
        description: "Optional MIME type override.",
      },
    },
    required: ["filename", "content"],
  },
  execute: async (
    params: WriteFileParams,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult<WriteFileData>> => {
    const startTime = Date.now();
    const filename = (params.filename || "").trim().replace(/[.\s]+$/, "");

    if (!filename || filename.includes("..") || /[\\/\0]/.test(filename)) {
      return {
        success: false,
        error: { code: "INVALID_PARAM", message: "Filename contains unsafe or illegal characters." },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    const lastDotIndex = filename.lastIndexOf(".");
    const extension = lastDotIndex !== -1 ? filename.slice(lastDotIndex).toLowerCase() : "";

    if (BLOCKED_EXTENSIONS.has(extension)) {
      return {
        success: false,
        error: {
          code: "INVALID_PARAM",
          message: `Extension '${extension}' is an executable or installer binary and is not permitted.`,
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    const content = params.content || "";
    const sizeBytes = Buffer.byteLength(content, "utf8");
    if (sizeBytes > MAX_FILE_BYTES) {
      return {
        success: false,
        error: { code: "INVALID_PARAM", message: "File content exceeds maximum allowed size of 10 MB." },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    try {
      let mimeType = params.mimeType || MIME_BY_EXTENSION[extension] || "text/plain";
      if (extension === ".svg" || mimeType.includes("svg")) {
        mimeType = "text/plain";
      }

      const uploaded = await uploadToR2({
        userId: context.userId,
        sessionId: context.sessionId,
        filename,
        content,
        contentType: mimeType,
      });

      return {
        success: true,
        data: {
          key: uploaded.key,
          filename: uploaded.filename,
          sizeBytes: uploaded.sizeBytes,
          mimeType: uploaded.contentType,
          url: uploaded.url,
        },
        metadata: { durationMs: Date.now() - startTime, provider: "cloudflare-r2" },
      };
    } catch (err: any) {
      return {
        success: false,
        error: { code: "STORAGE_ERROR", message: "Failed to persist file into session storage." },
        metadata: { durationMs: Date.now() - startTime },
      };
    }
  },
};
