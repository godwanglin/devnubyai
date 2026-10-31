import type { SandboxLanguage } from "@/lib/tools/execute-code";
import type { SessionFileItem } from "@/types";

export type SandboxPhase = "loading_runtime" | "executing";

export interface SandboxMountFile {
  name: string;
  bytes: ArrayBuffer;
}

export interface SandboxGeneratedChart {
  filename: string;
  blob: Blob;
}

export interface SandboxRunResult {
  ok: boolean;
  timedOut?: boolean;
  stdout: string;
  stderr: string;
  resultText: string;
  durationMs: number;
  charts: SandboxGeneratedChart[];
}

export interface RunSandboxOptions {
  language: SandboxLanguage;
  code: string;
  files?: SandboxMountFile[];
  onPhaseChange?: (phase: SandboxPhase) => void;
}

interface WorkerPhaseMessage {
  type: "phase";
  runId: string;
  phase: SandboxPhase;
}

interface WorkerResultMessage {
  type: "result";
  runId: string;
  ok: boolean;
  stdout: string;
  stderr: string;
  resultText: string;
  durationMs: number;
  charts: Array<{ filename: string; bytes: ArrayBuffer }>;
}

type WorkerInboundMessage = WorkerPhaseMessage | WorkerResultMessage;

const RUNTIME_LOAD_TIMEOUT_MS = 60_000;
const EXECUTION_TIMEOUT_MS = 10_000;
const MAX_MOUNT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_MOUNT_FILES = 6;

let sharedWorker: Worker | null = null;
let executionQueue: Promise<void> = Promise.resolve();

function getOrCreateWorker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new Worker("/workers/wasm-sandbox.worker.js");
  }
  return sharedWorker;
}

function destroySharedWorker(): void {
  if (sharedWorker) {
    try {
      sharedWorker.terminate();
    } catch {
      // Ignore termination errors
    }
    sharedWorker = null;
  }
}

function guessChartMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

function executeSingleRun({
  language,
  code,
  files = [],
  onPhaseChange,
}: RunSandboxOptions): Promise<SandboxRunResult> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || typeof Worker === "undefined") {
      resolve({
        ok: false,
        stdout: "",
        stderr: "WebAssembly Worker is not supported in this environment.",
        resultText: "",
        durationMs: 0,
        charts: [],
      });
      return;
    }

    const worker = getOrCreateWorker();
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const startWall = performance.now();
    let settled = false;
    let currentPhase: SandboxPhase =
      language === "python" ? "loading_runtime" : "executing";
    let timerId: ReturnType<typeof setTimeout> | null = null;

    function clearTimer() {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
    }

    function armTimer(ms: number, isExecutionPhase: boolean) {
      clearTimer();
      timerId = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanupListeners();
        destroySharedWorker();
        resolve({
          ok: false,
          timedOut: true,
          stdout: "",
          stderr: isExecutionPhase
            ? `TimeoutError: Execution exceeded the ${EXECUTION_TIMEOUT_MS / 1000}s hard limit and was terminated.`
            : "TimeoutError: Timed out while initializing WebAssembly runtime.",
          resultText: "",
          durationMs: Math.round(performance.now() - startWall),
          charts: [],
        });
      }, ms);
    }

    function handleMessage(event: MessageEvent<WorkerInboundMessage>) {
      const msg = event.data;
      if (!msg || msg.runId !== runId) return;

      if (msg.type === "phase") {
        currentPhase = msg.phase;
        onPhaseChange?.(msg.phase);
        if (msg.phase === "executing") {
          armTimer(EXECUTION_TIMEOUT_MS, true);
        } else {
          armTimer(RUNTIME_LOAD_TIMEOUT_MS, false);
        }
        return;
      }

      if (msg.type === "result" && !settled) {
        settled = true;
        clearTimer();
        cleanupListeners();

        const charts: SandboxGeneratedChart[] = (msg.charts ?? []).map((c, idx) => {
          const filename = c.filename || `chart-${idx + 1}.png`;
          return {
            filename,
            blob: new Blob([c.bytes], { type: guessChartMimeType(filename) }),
          };
        });

        resolve({
          ok: msg.ok,
          stdout: msg.stdout ?? "",
          stderr: msg.stderr ?? "",
          resultText: msg.resultText ?? "",
          durationMs: msg.durationMs || Math.max(1, Math.round(performance.now() - startWall)),
          charts,
        });
      }
    }

    function handleError(err: ErrorEvent) {
      if (settled) return;
      settled = true;
      clearTimer();
      cleanupListeners();
      destroySharedWorker();
      resolve({
        ok: false,
        stdout: "",
        stderr: err.message || "Fatal WebAssembly worker crash.",
        resultText: "",
        durationMs: Math.round(performance.now() - startWall),
        charts: [],
      });
    }

    function cleanupListeners() {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
    }

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);

    onPhaseChange?.(currentPhase);
    armTimer(
      currentPhase === "executing" ? EXECUTION_TIMEOUT_MS : RUNTIME_LOAD_TIMEOUT_MS,
      currentPhase === "executing"
    );

    const payloadFiles = files.map((f) => {
      const cloned = f.bytes.slice(0);
      return { name: f.name, bytes: cloned };
    });
    const transferables = payloadFiles.map((f) => f.bytes);

    worker.postMessage(
      {
        type: "execute",
        runId,
        language,
        code,
        files: payloadFiles,
      },
      transferables
    );
  });
}

/**
 * Queues and runs code sequentially inside the isolated WebAssembly Worker.
 */
export function runInWasmSandbox(options: RunSandboxOptions): Promise<SandboxRunResult> {
  const nextRun = executionQueue.then(() => executeSingleRun(options));
  executionQueue = nextRun.then(
    () => undefined,
    () => undefined
  );
  return nextRun;
}

const FILE_IO_HINT_REGEX =
  /\b(open|read_csv|read_json|read_table|loadtxt|genfromtxt|Path|listdir)\b|\.(csv|json|tsv|txt)\b/i;

/**
 * Fetches lightweight non-image session files (e.g. uploaded CSV/JSON/TXT <= 2 MB)
 * so Python scripts in `/workspace` can read user-attached datasets seamlessly.
 */
export async function loadSessionFilesForSandbox(
  chatId: string | undefined,
  language: SandboxLanguage,
  code: string
): Promise<SandboxMountFile[]> {
  if (!chatId || language !== "python" || !FILE_IO_HINT_REGEX.test(code)) {
    return [];
  }

  try {
    const res = await fetch(`/api/v1/chats/${chatId}/files`, {
      credentials: "same-origin",
    });
    if (!res.ok) return [];
    const json = await res.json();
    const list: SessionFileItem[] = Array.isArray(json?.data) ? json.data : [];

    const candidates = list
      .filter((f) => !f.isImage && f.sizeBytes > 0 && f.sizeBytes <= MAX_MOUNT_FILE_BYTES)
      .slice(0, MAX_MOUNT_FILES);

    const mounted: SandboxMountFile[] = [];
    for (const item of candidates) {
      const fileRes = await fetch(item.url, { credentials: "same-origin" });
      if (!fileRes.ok) continue;
      const bytes = await fileRes.arrayBuffer();
      mounted.push({ name: item.displayName, bytes });
      if (item.filename !== item.displayName) {
        mounted.push({ name: item.filename, bytes: bytes.slice(0) });
      }
    }
    return mounted;
  } catch {
    return [];
  }
}
