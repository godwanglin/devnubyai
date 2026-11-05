import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "../lib/tools/types";
import { executeNodeSkillScript } from "./node-executor";
import { executePythonSkillScript } from "./python-executor";
import { executeSkillScriptInSandbox } from "./skill-sandbox-runner";
import type { LiveWorkspaceDocument, SkillExecutionResult, SkillScriptRuntime } from "./types";
import { getSandboxSupport } from "./user-workspace";

export interface RunSkillScriptParams {
  skill: string;
  runtime?: SkillScriptRuntime;
  script?: string;
  code?: string;
  args?: string[];
  inputFiles?: Record<string, string>;
}

function detectRuntime(params: RunSkillScriptParams): SkillScriptRuntime {
  if (params.runtime === "node" || params.runtime === "python") {
    return params.runtime;
  }
  const scriptLower = params.script?.trim().toLowerCase() ?? "";
  if (
    scriptLower.endsWith(".js") ||
    scriptLower.endsWith(".cjs") ||
    scriptLower.endsWith(".mjs")
  ) {
    return "node";
  }
  if (
    params.code &&
    /\brequire\s*\(\s*['"](?:docx|pptxgenjs|fs|path)['"]\s*\)/.test(params.code)
  ) {
    return "node";
  }
  return "python";
}

export const runSkillScriptTool: ToolDefinition<
  RunSkillScriptParams,
  SkillExecutionResult
> = {
  name: "run_skill_script",
  description:
    "PRIMARY tool for creating, editing, inspecting, and validating PDF, Word (.docx), Excel (.xlsx), and PowerPoint (.pptx) files when following a loaded skill from `.devnuby/skills/<skill>`. Runs either a pre-existing helper script (`script` in `.devnuby/skills/<skill>/scripts/`) OR custom inline Python/Node.js code (`code`) inside an isolated, zero-trust sandbox with automatic R2 session file mounting and generated file synchronization.",
  parameters: {
    type: "object",
    properties: {
      skill: {
        type: "string",
        description:
          "The skill folder slug in `.devnuby/skills/` (e.g. 'pdf', 'xlsx', 'docx', 'pptx'). Always call `load_skill` for this skill first.",
        required: true,
      },
      runtime: {
        type: "string",
        enum: ["python", "node"],
        description:
          "Execution runtime: 'python' (for pdf reportlab/pypdf/pdfplumber, xlsx openpyxl/pandas, and python helper scripts) or 'node' (for docx npm `require('docx')` and pptx `require('pptxgenjs')` scripts). Defaults to 'python' unless Node.js code is detected.",
      },
      script: {
        type: "string",
        description:
          "Optional helper script path inside `.devnuby/skills/<skill>/scripts/` (e.g. 'check_fillable_fields.py', 'extract_form_field_info.py', 'fill_fillable_fields.py', 'convert_pdf_to_images.py', 'office/validate.py', 'comment.py', 'add_slide.py'). Omit when passing inline `code`.",
      },
      code: {
        type: "string",
        description:
          "Optional inline Python or Node.js script to execute inside the isolated workspace when creating or editing a file according to the skill instructions (e.g. a Python `reportlab` or `openpyxl` script, or a Node.js `docx` or `pptxgenjs` script). Write output files directly to the current working directory (e.g. 'output.pdf', 'report.docx', 'financial_model.xlsx', 'deck.pptx') and they will automatically be uploaded to session storage and shown to the user. Check that fonts, images and other assets exist (`os.path.exists` / `fs.existsSync`) before building the document and fall back when one is missing; never hardcode system font paths (they differ per host). In Python, prefer the pre-registered families ('Arial', 'Times New Roman', 'Courier New', 'DejaVu Sans', plus any Google Font name used via `fontName=` / `setFont`, which is downloaded automatically) over `TTFont(name, '/usr/share/fonts/...')`.",
      },
      args: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional command-line arguments passed to the script (e.g. ['input.pdf', 'field_info.json']). Uploaded session files are automatically mounted in the current working directory by their filename.",
      },
      inputFiles: {
        type: "object",
        description:
          "Optional map of helper JSON/text filenames to write into the workspace before running the script (e.g. { 'field_values.json': '[...]' } or { 'fields.json': '{...}' }).",
      },
    },
    required: ["skill"],
  },
  execute: async (
    params: RunSkillScriptParams,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult<SkillExecutionResult>> => {
    const startTime = Date.now();
    const runtime = detectRuntime(params);
    const providerName =
      runtime === "node" ? "devnuby-node-executor" : "devnuby-python-executor";

    try {
      const request = {
        skill: params.skill,
        runtime,
        script: params.script,
        code: params.code,
        args: params.args,
        inputFiles: params.inputFiles,
        userId: context.userId,
        sessionId: context.sessionId,
        onDocumentReady: context.onProgress
          ? (doc: LiveWorkspaceDocument) => context.onProgress?.({ type: "document-ready", ...doc })
          : undefined,
      };

      // Prefer the OS sandbox (real isolation, no code restrictions); fall back to the
      // in-process sandboxes on hosts without it (e.g. local Windows development).
      const result = (await getSandboxSupport()).ok
        ? await executeSkillScriptInSandbox(request, runtime)
        : runtime === "node"
          ? await executeNodeSkillScript(request)
          : await executePythonSkillScript(request);

      if (!result.ok) {
        return {
          success: false,
          data: result,
          error: {
            code: result.timedOut ? "TIMEOUT" : "EXECUTION_ERROR",
            message:
              result.stderr ||
              result.stdout ||
              `Script '${result.script}' (${runtime}) exited with code ${result.exitCode}.`,
          },
          metadata: {
            durationMs: Date.now() - startTime,
            provider: providerName,
          },
        };
      }

      return {
        success: true,
        data: result,
        metadata: {
          durationMs: Date.now() - startTime,
          provider: providerName,
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: {
          code: "INVALID_PARAM",
          message,
        },
        metadata: {
          durationMs: Date.now() - startTime,
          provider: providerName,
        },
      };
    }
  },
};
