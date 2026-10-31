import type { ToolDefinition } from "./types";

export type SandboxLanguage = "python" | "javascript";

export interface ExecuteCodeInput {
  title: string;
  language: SandboxLanguage;
  code: string;
}

export interface PersistedChartItem {
  id?: string;
  url: string;
  title: string;
}

export interface PersistedCodeExecutionResult {
  status: "completed" | "error";
  stdout?: string;
  stderr?: string;
  resultText?: string;
  durationMs?: number;
  charts?: PersistedChartItem[];
}

export interface ExecuteCodeOutput {
  status: "dispatched_to_wasm_sandbox";
  title: string;
  language: SandboxLanguage;
  lineCount: number;
  instruction: string;
  executionResult?: PersistedCodeExecutionResult;
}

const MAX_CODE_LENGTH = 32_000;

/**
 * Normalizes LLM language identifiers into supported WASM sandbox runtimes.
 */
export function normalizeSandboxLanguage(raw: unknown): SandboxLanguage {
  const val = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (val === "javascript" || val === "js" || val === "node" || val === "mjs") {
    return "javascript";
  }
  return "python";
}

/**
 * Strips accidental outer markdown code fences if an LLM wraps tool input `code` in ```...```.
 */
export function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = /^```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n```$/.exec(trimmed);
  return fenceMatch ? fenceMatch[1].trim() : raw;
}

/**
 * Client-side isolated WebAssembly code execution & real chart visualization tool.
 * Runs Python (Pyodide WASM + numpy/pandas/matplotlib) or JavaScript inside a
 * network-locked Web Worker in the user's browser with zero server RCE exposure.
 */
export const executeCodeTool: ToolDefinition<ExecuteCodeInput, ExecuteCodeOutput> = {
  name: "execute_code",
  description:
    "Execute Python or JavaScript code in an isolated client-side WebAssembly sandbox to compute exact calculations, analyze data/CSV files, or generate real visual charts/plots (using Python matplotlib, numpy, pandas). Use language='python' whenever visual charts, plots, statistical analysis, or scientific computing are requested. Note: the sandbox has NO internet access.",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description:
          "Concise descriptive title of the execution or chart, e.g. 'Visualisasi Tren Pendapatan Kuartalan'",
        required: true,
      },
      language: {
        type: "string",
        enum: ["python", "javascript"],
        description:
          "Runtime language. Choose 'python' for matplotlib charts, numpy/pandas data analysis, and math; 'javascript' for JS logic.",
        required: true,
      },
      code: {
        type: "string",
        description:
          "Complete, self-contained source code to run (plain code without markdown fences). For Python charts, use matplotlib.pyplot (e.g. plt.figure(figsize=(8, 4.8)), clear labels/titles, tight_layout(), plt.show()).",
        required: true,
      },
    },
    required: ["title", "language", "code"],
  },
  execute: async (params) => {
    const cleanCode = stripCodeFences(String(params?.code ?? ""));
    if (!cleanCode.trim()) {
      return {
        success: false,
        error: {
          code: "INVALID_PARAM",
          message: "Parameter 'code' cannot be empty.",
        },
      };
    }

    if (cleanCode.length > MAX_CODE_LENGTH) {
      return {
        success: false,
        error: {
          code: "INVALID_PARAM",
          message: `Code exceeds maximum allowed length of ${MAX_CODE_LENGTH} characters.`,
        },
      };
    }

    const language = normalizeSandboxLanguage(params?.language);
    const title = String(params?.title || "Eksekusi Kode").trim() || "Eksekusi Kode";
    const lineCount = cleanCode.split(/\r?\n/).length;

    return {
      success: true,
      data: {
        status: "dispatched_to_wasm_sandbox",
        title,
        language,
        lineCount,
        instruction:
          "The code is executing live in the user's browser WebAssembly sandbox widget above your reply, where stdout and any matplotlib PNG charts are rendered automatically. Do NOT paste or repeat the full source code in your text response; instead provide a concise summary or insight explaining the result/chart.",
      },
    };
  },
};
