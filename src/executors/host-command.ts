import { spawn } from "node:child_process";

export interface HostCommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs a trusted host command (mount, mkfs, ...) as the app user with no shell.
 * Never pass user-controlled strings as `cmd`; arguments are passed as argv, unparsed.
 */
export function runHostCommand(
  cmd: string,
  args: string[],
  timeoutMs = 60_000
): Promise<HostCommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(cmd, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { NODE_ENV: "production", PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" },
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({ code: null, stdout, stderr: `${stderr}\n${cmd} timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < 16_000) stdout += chunk.toString("utf-8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 16_000) stderr += chunk.toString("utf-8");
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: err.message });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

/** Absolute path of an executable on the host PATH, or null. */
export async function findHostBinary(name: string): Promise<string | null> {
  const res = await runHostCommand("/usr/bin/which", [name], 5_000);
  const found = res.code === 0 ? res.stdout.split("\n")[0]?.trim() : "";
  return found || null;
}
