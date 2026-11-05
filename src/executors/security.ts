import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EXECUTOR_CONFIG } from "./config";
import type { CachedFontFamilyVariants } from "./fonts";
import { buildPythonRunnerSource } from "./python-runner";
import type { SkillScriptRuntime } from "./types";

export { buildPythonRunnerSource };

const MAX_INLINE_CODE_CHARS = 120_000;

/**
 * Static patterns blocked in CLI arguments or file names to prevent traversal or secret probing.
 */
const FORBIDDEN_PATH_PATTERNS: readonly RegExp[] = [
  /(?:^|[\\/])\.\.(?:[\\/]|$)/,
  /(?:^|[\\/])\.env(?:\.[a-z0-9_-]+)?$/i,
  /devnuby-ai[\\/](?:\.env|src|prisma|package\.json|next\.config)/i,
  /(?:^|[\\/])(?:etc[\\/](?:passwd|shadow|hosts)|proc[\\/]self)/i,
];

/**
 * Static patterns blocked in inline Python scripts before execution even starts.
 */
const FORBIDDEN_PYTHON_CODE_PATTERNS: readonly { pattern: RegExp; reason: string }[] = [
  {
    pattern: /\b(?:import|from)\s+(?:subprocess|pty|socket|socketserver|http|urllib|requests|httpx|aiohttp|ftplib|smtplib|telnetlib|xmlrpc|webbrowser|ctypes|cffi|multiprocessing)\b/,
    reason: "Importing network, process-spawning, or native FFI modules is prohibited in the sandbox.",
  },
  {
    pattern: /\b__import__\s*\(\s*['"](?:subprocess|pty|socket|http|urllib|requests|httpx|ctypes|cffi|multiprocessing)['"]/,
    reason: "Dynamic import of restricted system/network modules is prohibited.",
  },
  {
    pattern: /\bos\s*\.\s*(?:system|popen|spawn\w*|exec\w*|fork|kill|killpg|environ|getenv|putenv|unsetenv)\b/,
    reason: "Direct OS process execution or environment variable access is prohibited.",
  },
  {
    pattern: /\bsys\s*\.\s*modules\b/,
    reason: "Tampering with sys.modules is prohibited in the sandbox.",
  },
  {
    pattern: /(?:\.env\b|DATABASE_URL|R2_SECRET_ACCESS_KEY|GOOGLE_CLIENT_SECRET|GITHUB_CLIENT_SECRET|OPENROUTER_API_KEY)/i,
    reason: "Attempting to reference internal environment files or secret keys is prohibited.",
  },
];

/**
 * Static patterns blocked in inline Node.js scripts before execution even starts.
 */
const FORBIDDEN_NODE_CODE_PATTERNS: readonly { pattern: RegExp; reason: string }[] = [
  {
    pattern: /\brequire\s*\(\s*['"](?:node:)?(?:child_process|worker_threads|cluster|net|tls|http|https|http2|dgram|dns|inspector|v8|vm|module)['"]\s*\)/,
    reason: "Requiring process-spawning, network, or VM escape modules is prohibited in the sandbox.",
  },
  {
    pattern: /\bimport\s+.*?\bfrom\s+['"](?:node:)?(?:child_process|worker_threads|cluster|net|tls|http|https|http2|dgram|dns|inspector|v8|vm|module)['"]/,
    reason: "Importing process-spawning, network, or VM escape modules is prohibited in the sandbox.",
  },
  {
    pattern: /\bprocess\s*\.\s*(?:env|binding|_linkedBinding|dlopen|kill|chdir)\b/,
    reason: "Accessing process.env, native bindings, or process control is prohibited.",
  },
  {
    pattern: /\b(?:globalThis\s*\.\s*)?fetch\s*\(/,
    reason: "Network fetch requests are prohibited inside the document executor sandbox.",
  },
  {
    pattern: /(?:\.env\b|DATABASE_URL|R2_SECRET_ACCESS_KEY|GOOGLE_CLIENT_SECRET|GITHUB_CLIENT_SECRET|OPENROUTER_API_KEY)/i,
    reason: "Attempting to reference internal environment files or secret keys is prohibited.",
  },
];

/**
 * Validates CLI arguments to ensure they don't reference parent directories or internal project files.
 */
export function validateSafeArgs(rawArgs?: string[]): string[] {
  if (!Array.isArray(rawArgs)) return [];
  const sanitized: string[] = [];

  for (const raw of rawArgs.slice(0, 16)) {
    const arg = String(raw ?? "").trim();
    if (!arg) continue;
    if (arg.includes("\0") || arg.length > 512) {
      throw new Error("SecurityError: Invalid or overly long command-line argument.");
    }
    for (const rule of FORBIDDEN_PATH_PATTERNS) {
      if (rule.test(arg)) {
        throw new Error(
          `SecurityError: Argument '${arg}' violates workspace isolation policy.`
        );
      }
    }
    sanitized.push(arg);
  }

  return sanitized;
}

/**
 * Validates inline code (Python or Node.js) against static security policies before execution.
 */
export function validateInlineCodeSecurity(
  code: string,
  runtime: SkillScriptRuntime
): string {
  const trimmed = String(code ?? "").trim();
  if (!trimmed) {
    throw new Error("Inline code cannot be empty.");
  }
  if (trimmed.length > MAX_INLINE_CODE_CHARS) {
    throw new Error(
      `Inline code exceeds maximum allowed length (${MAX_INLINE_CODE_CHARS} characters).`
    );
  }

  for (const rule of FORBIDDEN_PATH_PATTERNS) {
    if (rule.test(trimmed)) {
      throw new Error(
        "SecurityError: Code references restricted parent paths or internal system files."
      );
    }
  }

  const rules =
    runtime === "node" ? FORBIDDEN_NODE_CODE_PATTERNS : FORBIDDEN_PYTHON_CODE_PATTERNS;

  for (const { pattern, reason } of rules) {
    if (pattern.test(trimmed)) {
      throw new Error(`SecurityError: ${reason}`);
    }
  }

  return trimmed;
}

/**
 * Generates an un-bypassable CPython startup runner (`_devnuby_py_runner.py`) that installs
 * a C-level `sys.addaudithook` before executing the target Python script.
 *
 * Even if code obfuscates strings to bypass static regex checks, `sys.addaudithook` runs inside
 * the CPython C runtime and blocks:
 * - Reading ANY file in `C:\dev\devnuby-ai` outside `.devnuby/skills/<skill>` and `.devnuby/.venv`
 * - Writing ANY file outside the ephemeral `workspaceDir`
 * - Spawning subprocesses, shells, or network sockets
 */
export async function writePythonSandboxRunner(params: {
  workspaceDir: string;
  skillDir: string;
  targetScriptPath: string;
  cachedFonts?: CachedFontFamilyVariants[];
}): Promise<string> {
  const runnerPath = path.join(params.workspaceDir, "_devnuby_py_runner.py");
  await fsPromises.writeFile(
    runnerPath,
    buildPythonRunnerSource({
      workspaceDir: path.resolve(params.workspaceDir),
      skillDir: path.resolve(params.skillDir),
      venvDir: path.resolve(EXECUTOR_CONFIG.pythonVenvDir),
      customFontsDir: path.resolve(EXECUTOR_CONFIG.fontsDir),
      projectRootDir: path.resolve(EXECUTOR_CONFIG.projectRootDir),
      targetScriptPath: path.resolve(params.targetScriptPath),
      cachedFonts: params.cachedFonts ?? [],
      enforce: true,
    }),
    "utf-8"
  );
  return runnerPath;
}


/**
 * Writes a Node.js CommonJS preload script (`_devnuby_node_preload.cjs`) and builds
 * Node.js 24 native `--permission` flags so the child Node process is strictly isolated
 * at the C++ runtime level:
 * - Can ONLY read from `workspaceDir`, `skillDir`, `fontsDir`, and `node_modules`
 * - Can ONLY write to `workspaceDir`
 * - Cannot read `.env`, `src/`, `prisma/`, `package.json`, or host files
 * - Cannot spawn child processes, worker threads, or network connections
 */
export async function prepareNodeSandbox(params: {
  workspaceDir: string;
  skillDir: string;
  targetScriptPath: string;
  scriptArgs: string[];
}): Promise<{
  nodeFlags: string[];
  preloadPath: string;
}> {
  const preloadPath = path.join(params.workspaceDir, "_devnuby_node_preload.cjs");

  const preloadContent = `"use strict";
// Wipe and freeze process.env so no secrets can ever be read or mutated
const safeEnv = Object.freeze({
  NODE_ENV: "production",
  NODE_PATH: ${JSON.stringify(path.resolve(EXECUTOR_CONFIG.nodeModulesDir))},
  HOME: ${JSON.stringify(params.workspaceDir)},
  USERPROFILE: ${JSON.stringify(params.workspaceDir)},
  TMP: ${JSON.stringify(params.workspaceDir)},
  TEMP: ${JSON.stringify(params.workspaceDir)},
});
Object.defineProperty(process, "env", {
  value: safeEnv,
  writable: false,
  configurable: false,
  enumerable: true,
});

// Disable network globals inside the document sandbox
const denyNet = () => {
  throw new Error("[Devnuby Sandbox] Network access is disabled inside the document executor.");
};
globalThis.fetch = denyNet;
globalThis.WebSocket = denyNet;
`;

  await fsPromises.writeFile(preloadPath, preloadContent, "utf-8");

  // Node 24 native permission model flags (include both resolved paths and realpaths for Linux symlinks)
  const rawReadPaths = [
    path.resolve(params.workspaceDir),
    path.resolve(params.skillDir),
    path.resolve(EXECUTOR_CONFIG.nodeModulesDir),
    path.resolve(EXECUTOR_CONFIG.fontsDir),
    path.resolve(params.targetScriptPath),
  ];
  if (process.platform !== "win32" && fs.existsSync("/usr/share/fonts")) {
    rawReadPaths.push("/usr/share/fonts");
  }

  const readPathSet = new Set<string>();
  for (const p of rawReadPaths) {
    readPathSet.add(p);
    try {
      readPathSet.add(fs.realpathSync(p));
    } catch {
      // ignore if path does not exist yet
    }
  }

  let writePath = path.resolve(params.workspaceDir);
  try {
    writePath = fs.realpathSync(writePath);
  } catch {
    // ignore
  }

  const nodeFlags: string[] = [
    "--permission",
    ...Array.from(readPathSet).map((p) => `--allow-fs-read=${p}`),
    `--allow-fs-write=${path.resolve(params.workspaceDir)}`,
    ...(writePath !== path.resolve(params.workspaceDir)
      ? [`--allow-fs-write=${writePath}`]
      : []),
    "--require",
    preloadPath,
    params.targetScriptPath,
    ...params.scriptArgs,
  ];

  return {
    nodeFlags,
    preloadPath,
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sanitizes stdout/stderr from Python and Node.js sandbox runs so that:
 * 1. Host filesystem paths (`C:\Users\aiden\AppData\Local\Temp\...`, `/tmp/devnuby-exec-...`, project root, home dir)
 *    are masked as `<workspace>`, `<skill>`, `<venv>`, or `<system>`.
 * 2. Internal bootstrap stack frames (`_devnuby_py_runner.py`, `<frozen runpy>`, `_devnuby_node_preload.cjs`)
 *    are stripped so neither the AI nor debug logs see internal runner implementation details.
 */
export function sanitizeSandboxOutput(
  rawText: string,
  workspaceDir: string
): string {
  if (!rawText) return "";

  let cleaned = rawText;

  // Replace internal inline script filenames with clean names
  cleaned = cleaned
    .replace(/_devnuby_inline_script\.py/g, "script.py")
    .replace(/_devnuby_inline_script\.cjs/g, "script.js");

  const pathReplacements: Array<{ raw: string; token: string }> = [
    { raw: path.resolve(workspaceDir), token: "<workspace>" },
    { raw: path.resolve(EXECUTOR_CONFIG.skillsRootDir), token: "<skills>" },
    { raw: path.resolve(EXECUTOR_CONFIG.pythonVenvDir), token: "<venv>" },
    { raw: path.resolve(EXECUTOR_CONFIG.nodeModulesDir), token: "<node_modules>" },
    { raw: path.resolve(EXECUTOR_CONFIG.projectRootDir), token: "<app>" },
    { raw: path.resolve(os.tmpdir()), token: "<tmp>" },
    { raw: path.resolve(os.homedir()), token: "<home>" },
  ];

  for (const { raw, token } of pathReplacements) {
    if (!raw || raw.length < 3) continue;
    const winVariant = raw.replace(/\//g, "\\");
    const posixVariant = raw.replace(/\\/g, "/");
    cleaned = cleaned.replace(new RegExp(escapeRegex(winVariant), "gi"), token);
    cleaned = cleaned.replace(new RegExp(escapeRegex(posixVariant), "gi"), token);
  }

  // Strip internal runner frames from Python tracebacks
  const lines = cleaned.split(/\r?\n/);
  const filteredLines: string[] = [];
  let skipNextIndentedCodeLine = false;

  for (const line of lines) {
    if (
      line.includes("_devnuby_py_runner.py") ||
      line.includes("<frozen runpy>") ||
      line.includes("_devnuby_node_preload.cjs")
    ) {
      skipNextIndentedCodeLine = true;
      continue;
    }
    if (skipNextIndentedCodeLine) {
      skipNextIndentedCodeLine = false;
      if (/^\s{4,}[^\s]/.test(line) && !line.trimStart().startsWith("File ")) {
        continue;
      }
    }
    filteredLines.push(line);
  }

  return filteredLines.join("\n").trim();
}
