import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "../lib/tools/types";
import { SANDBOX_CONFIG } from "./config";
import { type ExecCommandResult, executeSandboxCommand } from "./exec-command";
import { WorkspaceError } from "./user-workspace";

export interface ExecCommandParams {
  command: string;
  /** Short human-readable label of what the command does, shown in the chat UI */
  description?: string;
  timeoutSeconds?: number;
  publish?: string[];
}

const PROVIDER = "devnuby-exec-sandbox";
const QUOTA_MB = Math.round(SANDBOX_CONFIG.quotaBytes / (1024 * 1024));
const MAX_TIMEOUT_SEC = Math.round(SANDBOX_CONFIG.maxTimeoutMs / 1000);

export const execCommandTool: ToolDefinition<ExecCommandParams, ExecCommandResult> = {
  name: "exec_command",
  description: [
    "Run any shell command (bash) on a real Linux machine in the user's private, persistent workspace. Use it whenever the job needs real tools: building or converting documents, processing files, data work, OCR, installing a library, or checking your own output.",
    `- Working directory is \`/workspace\` (this chat's folder). Files the user uploaded to this chat are already there by their names. Files you create stay there for later calls in this chat. Disk is limited to ${QUOTA_MB} MB per user (shared across their chats): clean up big temporary files.`,
    "- Preinstalled: python3 with reportlab, pypdf, pdfplumber, pypdfium2, PyMuPDF, python-docx, python-pptx, openpyxl, XlsxWriter, pandas, numpy, matplotlib, Pillow, lxml, beautifulsoup4, markdown; node with docx, pptxgenjs, exceljs, jszip, sharp; LibreOffice (`soffice --headless --convert-to pdf file.docx`), pandoc, poppler-utils (pdftoppm, pdftotext), qpdf, ghostscript, ImageMagick, tesseract OCR (eng, ind), zip/unzip, curl.",
    "- Missing a library? `pip install <pkg>` or `npm install <pkg>` works (public internet is reachable; the app's own servers and private networks are not).",
    "- New or changed documents, spreadsheets, presentations, images, audio/video, CSV and ZIP files in /workspace are uploaded and shown to the user automatically. To also deliver other files (e.g. .md, .html, .txt, .py), list them in `publish`.",
    "- Working files are anything whose name (or folder) starts with `_` (e.g. `_build.py`, `_check/page-1.png`): they stay in /workspace, are never shown to the user, and `read_file` can still open them (e.g. `read_file({\"filename\": \"_check/page-1.png\"})` to look at a rendered page). Write helper scripts here with a heredoc (`cat > _build.py <<'EOF' ... EOF`), not with `write_file`, which delivers a file to the user.",
    "- When a document skill is loaded, follow its guidance; its helper scripts are at `/opt/devnuby/skills/<skill>/scripts/`.",
  ].join("\n"),
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description:
          "The bash command or script to run, e.g. `soffice --headless --convert-to pdf Laporan.docx` or a heredoc such as `python3 - <<'EOF'\\n...\\nEOF`.",
        required: true,
      },
      description: {
        type: "string",
        description:
          "Very short label in the user's language of what this step does, e.g. 'Mengubah laporan ke PDF'.",
      },
      timeoutSeconds: {
        type: "number",
        description: `Time limit in seconds (default ${Math.round(SANDBOX_CONFIG.defaultTimeoutMs / 1000)}, max ${MAX_TIMEOUT_SEC}).`,
      },
      publish: {
        type: "array",
        items: { type: "string" },
        description:
          "Extra workspace-relative files to deliver to the user that are not delivered automatically (e.g. ['notes.md', 'site/index.html']).",
      },
    },
    required: ["command"],
  },
  execute: async (
    params: ExecCommandParams,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult<ExecCommandResult>> => {
    const startTime = Date.now();
    const timeoutSeconds = Number(params.timeoutSeconds);

    try {
      const result = await executeSandboxCommand({
        command: params.command,
        userId: context.userId,
        sessionId: context.sessionId,
        timeoutMs: Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds * 1000 : undefined,
        publish: Array.isArray(params.publish) ? params.publish.map(String) : undefined,
        signal: context.signal,
        onDocumentReady: context.onProgress
          ? (doc) => context.onProgress?.({ type: "document-ready", ...doc })
          : undefined,
      });

      if (!result.ok) {
        return {
          success: false,
          data: result,
          error: {
            code: result.timedOut ? "TIMEOUT" : "EXECUTION_ERROR",
            message: result.stderr || result.stdout || `Command exited with code ${result.exitCode}.`,
          },
          metadata: { durationMs: Date.now() - startTime, provider: PROVIDER },
        };
      }

      return {
        success: true,
        data: result,
        metadata: { durationMs: Date.now() - startTime, provider: PROVIDER },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: {
          code: err instanceof WorkspaceError ? "EXECUTION_ERROR" : "INVALID_PARAM",
          message:
            err instanceof WorkspaceError && message.startsWith("Command sandbox unavailable")
              ? `${message}. Use \`run_skill_script\` for document work instead.`
              : message,
        },
        metadata: { durationMs: Date.now() - startTime, provider: PROVIDER },
      };
    }
  },
};
