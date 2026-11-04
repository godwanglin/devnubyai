import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { EXECUTOR_CONFIG, SANDBOX_CONFIG } from "./config";
import { getSandboxSupport, type UserWorkspaceLease, WorkspaceError } from "./user-workspace";

export interface SandboxRunOptions {
  lease: UserWorkspaceLease;
  /** Program and arguments to run inside the sandbox (no shell unless you pass one) */
  argv: string[];
  /** Extra environment variables, merged over the sandbox defaults */
  env?: Record<string, string>;
  /** Working directory inside the sandbox (defaults to /workspace) */
  cwd?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface SandboxRunOutcome {
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
  stdout: string;
  stderr: string;
}

const HOST_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

function appendCapped(current: string, chunk: Buffer, maxChars: number): string {
  if (current.length >= maxChars) return current;
  const text = chunk.toString("utf-8");
  const remaining = maxChars - current.length;
  if (text.length <= remaining) return current + text;
  return current + text.slice(0, remaining) + "\n...[output truncated]";
}

/** Install root of the Node.js binary the app runs on (e.g. /www/server/nodejs/v24.14.1). */
function resolveNodeInstallRoot(): string | null {
  try {
    const root = path.dirname(path.dirname(fs.realpathSync(process.execPath)));
    return root.startsWith("/usr/") || root === "/usr" ? null : root;
  } catch {
    return null;
  }
}

/** `--perms 0755 --dir` for every ancestor of `target` so binds below it stay traversable. */
function ancestorDirs(target: string): string[] {
  const args: string[] = [];
  const parts = target.split("/").filter(Boolean);
  for (let i = 1; i < parts.length; i += 1) {
    args.push("--perms", "0755", "--dir", `/${parts.slice(0, i).join("/")}`);
  }
  return args;
}

function buildSandboxEnv(nodeRoot: string | null, extra?: Record<string, string>): Record<string, string> {
  const p = SANDBOX_CONFIG.paths;
  const venvDir = path.resolve(EXECUTOR_CONFIG.pythonVenvDir);
  const pathEntries = [
    fs.existsSync(venvDir) ? `${venvDir}/bin` : null,
    `${p.home}/.local/bin`,
    `${p.home}/.npm-global/bin`,
    "/usr/local/sbin",
    "/usr/local/bin",
    "/usr/sbin",
    "/usr/bin",
    "/sbin",
    "/bin",
    nodeRoot ? `${nodeRoot}/bin` : null,
  ].filter(Boolean);

  return {
    PATH: pathEntries.join(":"),
    HOME: p.home,
    USER: SANDBOX_CONFIG.execUser,
    LOGNAME: SANDBOX_CONFIG.execUser,
    TMPDIR: p.tmp,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TERM: "dumb",
    PYTHONUNBUFFERED: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONIOENCODING: "utf-8",
    // The shared venv is read-only; `pip install` lands in the user's own home (counts toward quota)
    PYTHONPATH: `${p.home}/.pylib`,
    PIP_TARGET: `${p.home}/.pylib`,
    PIP_NO_CACHE_DIR: "1",
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
    NODE_PATH: `${p.home}/.npm-global/lib/node_modules:${p.nodeModules}`,
    NPM_CONFIG_PREFIX: `${p.home}/.npm-global`,
    NPM_CONFIG_CACHE: `${p.tmp}/.npm`,
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_AUDIT: "false",
    XDG_DATA_HOME: p.xdgData,
    XDG_CONFIG_HOME: `${p.home}/.config`,
    XDG_CACHE_HOME: `${p.tmp}/.cache`,
    MPLCONFIGDIR: `${p.tmp}/.matplotlib`,
    MPLBACKEND: "Agg",
    ...extra,
  };
}

/**
 * Runs `argv` as the restricted sandbox user inside bubblewrap.
 *
 * The sandbox sees a read-only /usr and /etc, the app's skills / venv / node_modules /
 * fonts read-only under /opt/devnuby, and only this user's workspace, home and tmp as
 * writable. It has its own PID/IPC/UTS namespaces, no capabilities, no_new_privs, and
 * runs in a transient systemd scope with memory / task / CPU caps. Network egress is
 * governed by the host firewall for the sandbox uid (public internet only).
 */
export async function runInSandbox(options: SandboxRunOptions): Promise<SandboxRunOutcome> {
  const support = await getSandboxSupport();
  if (!support.ok) throw new WorkspaceError(`Command sandbox unavailable: ${support.reason}`);
  if (options.argv.length === 0) throw new WorkspaceError("Empty sandbox command.");

  const p = SANDBOX_CONFIG.paths;
  const { lease } = options;
  const nodeRoot = resolveNodeInstallRoot();

  const bwrapArgs: string[] = [
    "--unshare-ipc",
    "--unshare-pid",
    "--unshare-uts",
    "--unshare-cgroup-try",
    "--die-with-parent",
    "--new-session",
    "--hostname", "devnuby",
    "--ro-bind", "/usr", "/usr",
    "--symlink", "usr/bin", "/bin",
    "--symlink", "usr/sbin", "/sbin",
    "--symlink", "usr/lib", "/lib",
    "--symlink", "usr/lib64", "/lib64",
    "--ro-bind", "/etc", "/etc",
  ];
  for (const secretDir of ["/etc/ssh", "/etc/letsencrypt", "/etc/ssl/private"]) {
    if (fs.existsSync(secretDir)) bwrapArgs.push("--tmpfs", secretDir);
  }
  if (nodeRoot) {
    bwrapArgs.push(...ancestorDirs(nodeRoot), "--ro-bind", nodeRoot, nodeRoot);
  }
  bwrapArgs.push(
    "--proc", "/proc",
    "--dev", "/dev",
    "--perms", "0755", "--dir", "/home",
    "--perms", "0755", "--dir", "/opt",
    "--perms", "0755", "--dir", "/opt/devnuby",
    "--perms", "0755", "--dir", p.xdgData,
    "--bind", lease.workspaceDir, p.workspace,
    "--bind", lease.homeDir, p.home,
    "--bind", lease.tmpDir, p.tmp
  );

  const readOnlyShares: Array<[string, string]> = [
    [EXECUTOR_CONFIG.skillsRootDir, p.skills],
    [EXECUTOR_CONFIG.nodeModulesDir, p.nodeModules],
    [EXECUTOR_CONFIG.fontsDir, p.fonts],
  ];
  for (const [hostDir, sandboxDir] of readOnlyShares) {
    if (fs.existsSync(hostDir)) bwrapArgs.push("--ro-bind", hostDir, sandboxDir);
  }
  // The venv keeps its host path: its console scripts (pip, ...) have absolute shebangs
  const venvDir = path.resolve(EXECUTOR_CONFIG.pythonVenvDir);
  if (fs.existsSync(venvDir)) {
    bwrapArgs.push(...ancestorDirs(venvDir), "--ro-bind", venvDir, venvDir, "--symlink", venvDir, p.venv);
  }

  bwrapArgs.push("--chdir", options.cwd ?? p.workspace, "--clearenv");
  for (const [key, value] of Object.entries(buildSandboxEnv(nodeRoot, options.env))) {
    bwrapArgs.push("--setenv", key, value);
  }
  bwrapArgs.push(
    "--",
    support.binaries.setpriv,
    `--reuid=${support.uid}`,
    `--regid=${support.gid}`,
    "--clear-groups",
    "--no-new-privs",
    "--inh-caps=-all",
    "--bounding-set=-all",
    "--",
    ...options.argv
  );

  const launch: string[] = [];
  if (support.binaries.systemdRun) {
    launch.push(
      support.binaries.systemdRun,
      "--scope",
      "--quiet",
      "--collect",
      "-p", `MemoryMax=${SANDBOX_CONFIG.memoryMax}`,
      "-p", "MemorySwapMax=0",
      "-p", `TasksMax=${SANDBOX_CONFIG.tasksMax}`,
      "-p", `CPUQuota=${SANDBOX_CONFIG.cpuQuota}`,
      "--"
    );
  }
  if (support.binaries.prlimit) {
    launch.push(
      support.binaries.prlimit,
      "--nofile=4096:4096",
      "--core=0",
      `--fsize=${SANDBOX_CONFIG.quotaBytes}`,
      "--"
    );
  }
  launch.push(support.binaries.bwrap, ...bwrapArgs);

  return new Promise<SandboxRunOutcome>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const child = spawn(launch[0], launch.slice(1), {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      // Only the launcher sees this; the sandbox itself starts from --clearenv
      env: { NODE_ENV: "production", PATH: HOST_PATH },
    });

    const kill = () => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, options.timeoutMs);
    const onAbort = () => {
      aborted = true;
      kill();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendCapped(stdout, chunk, EXECUTOR_CONFIG.maxOutputChars);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendCapped(stderr, chunk, EXECUTOR_CONFIG.maxOutputChars);
    });

    const finish = (outcome: SandboxRunOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve(outcome);
    };

    child.on("error", (err) => {
      finish({
        exitCode: 1,
        timedOut: false,
        aborted,
        stdout: stdout.trim(),
        stderr: `${stderr}\nFailed to start sandbox: ${err.message}`.trim(),
      });
    });
    child.on("close", (code) => {
      let tail = stderr.trim();
      if (timedOut) tail = `${tail}\nTimeoutError: command exceeded ${options.timeoutMs}ms and was killed.`.trim();
      if (aborted) tail = `${tail}\nCommand was cancelled.`.trim();
      finish({ exitCode: code, timedOut, aborted, stdout: stdout.trim(), stderr: tail });
    });
  });
}
