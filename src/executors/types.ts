export type SkillScriptRuntime = "python" | "node";

export interface ExecutorConfig {
  /**Root project directory (used by security policy to block internal file access) */
  projectRootDir: string;
  /** Base directory where `.devnuby/skills` is located */
  skillsRootDir: string;
  /** Dedicated Python virtual environment directory (`.devnuby/.venv`) */
  pythonVenvDir: string;
  /** Local font cache directory (`.devnuby/fonts`) for PDF TTF embedding */
  fontsDir: string;
  /** Project `node_modules` directory (read-only access for `docx` / `pptxgenjs`) */
  nodeModulesDir: string;
  /** Prefix for ephemeral execution directories inside `os.tmpdir()` */
  tempDirPrefix: string;
  /** Default execution timeout in milliseconds */
  defaultTimeoutMs: number;
  /** Hard maximum timeout allowed in milliseconds */
  maxTimeoutMs: number;
  /** Maximum characters captured from stdout / stderr */
  maxOutputChars: number;
  /** Maximum single file size (in bytes) synced to/from R2 workspace */
  maxWorkspaceFileBytes: number;
  /** Maximum number of generated files uploaded back to R2 per run */
  maxGeneratedFiles: number;
  /** Allowed script file extensions for python-executor */
  allowedPythonExtensions: readonly string[];
  /** Allowed script file extensions for node-executor */
  allowedNodeExtensions: readonly string[];
}

export interface SkillExecutionRequest {
  /** Skill folder slug inside `.devnuby/skills/<skill>` (e.g. "pdf", "xlsx", "docx", "pptx") */
  skill: string;
  /** Runtime to use ("python" default, or "node" for docx / pptxgenjs scripts) */
  runtime?: SkillScriptRuntime;
  /** Pre-existing script filename inside `.devnuby/skills/<skill>/scripts/` (optional if `code` is provided) */
  script?: string;
  /** Inline Python or Node.js code to run inside the isolated sandbox (optional if `script` is provided) */
  code?: string;
  /** Command-line arguments passed to the script */
  args?: string[];
  /** Optional inline helper files to write into the workspace before execution (e.g. { "field_values.json": "[...]" }) */
  inputFiles?: Record<string, string>;
  /** Session context for syncing input/output files with R2 storage */
  userId: string;
  sessionId: string;
  /** Optional custom timeout in ms (clamped to config.maxTimeoutMs) */
  timeoutMs?: number;
}

export type PythonSkillExecutionRequest = SkillExecutionRequest;
export type NodeSkillExecutionRequest = SkillExecutionRequest;

export interface ExportedWorkspaceFile {
  id?: string;
  key: string;
  filename: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

export interface SkillExecutionResult {
  ok: boolean;
  runtime: SkillScriptRuntime;
  exitCode: number | null;
  timedOut: boolean;
  skill: string;
  script: string;
  args: string[];
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Any new or modified files generated in the workspace and synced to R2 */
  generatedFiles: ExportedWorkspaceFile[];
  /** Parsed JSON outputs from generated `.json` files in the workspace for immediate AI inspection */
  jsonOutputs?: Record<string, unknown>;
}

export type PythonSkillExecutionResult = SkillExecutionResult;
export type NodeSkillExecutionResult = SkillExecutionResult;
