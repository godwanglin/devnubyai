import { spawn } from "node:child_process";
import { resolveYtDlpExecutable } from "@/executors/config";

/**
 * Runs the vendored yt-dlp with a fixed argument array (never a shell) and returns its
 * stdout. `yt-dlp` is only ever asked for metadata and subtitles (`--skip-download`), so
 * no video is downloaded.
 */

const YTDLP_TIMEOUT_MS = 45_000;
const MAX_STDOUT_BYTES = 8 * 1024 * 1024;

export class YtDlpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YtDlpError";
  }
}

export function runYtDlp(args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err: Error | null, value: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (err) reject(err);
      else resolve(value);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(resolveYtDlpExecutable(), args, {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (!child.stdout || !child.stderr) throw new YtDlpError("yt-dlp pipes could not be opened");
    } catch (err) {
      finish(new YtDlpError(err instanceof Error ? err.message : "yt-dlp could not be started"), "");
      return;
    }

    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        child.kill();
        finish(new YtDlpError("yt-dlp output exceeded the size limit"), "");
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.reduce((n, b) => n + b.byteLength, 0) < 8_000) stderr.push(chunk);
    });

    const onAbort = () => {
      child.kill();
      finish(new YtDlpError("yt-dlp was aborted"), "");
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new YtDlpError("yt-dlp timed out"), "");
    }, YTDLP_TIMEOUT_MS);
    signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (err) => {
      const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
      finish(
        new YtDlpError(
          missing
            ? "yt-dlp is not installed (expected in .devnuby/bin)"
            : `yt-dlp could not be started: ${err.message}`
        ),
        ""
      );
    });
    child.on("close", (code) => {
      if (code === 0) {
        finish(null, Buffer.concat(stdout).toString("utf8"));
        return;
      }
      const detail = Buffer.concat(stderr).toString("utf8").trim().slice(-400);
      finish(new YtDlpError(detail || `yt-dlp exited with code ${code}`), "");
    });
  });
}
