import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { SANDBOX_CONFIG } from "./config";
import { findHostBinary, runHostCommand } from "./host-command";

/**
 * Per-user persistent workspaces for the OS sandbox.
 *
 * Each Devnuby user gets a sparse ext4 image (`<imagesDir>/<userKey>.img`, capped at
 * `quotaBytes`) that is created lazily on the first sandboxed run, loop-mounted at
 * `<mountRoot>/<userKey>` and unmounted again after `idleUnmountMs` without use:
 *
 *   <mountRoot>/<userKey>/
 *     sessions/<sessionKey>/   -> /workspace inside the sandbox (one per chat)
 *     home/                    -> /home/user
 *     tmp/                     -> /tmp
 *
 * Everything below the mount point is writable by sandboxed code, so every root-side
 * operation here uses lstat / lchown / O_NOFOLLOW and never follows a symlink.
 */

export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceError";
  }
}

export interface SandboxBinaries {
  bwrap: string;
  setpriv: string;
  prlimit: string | null;
  systemdRun: string | null;
  mkfs: string;
  e2fsck: string;
  mount: string;
  umount: string;
}

export type SandboxSupport =
  | { ok: true; uid: number; gid: number; binaries: SandboxBinaries }
  | { ok: false; reason: string };

export interface WorkspaceUsage {
  usedBytes: number;
  freeBytes: number;
  quotaBytes: number;
}

export interface UserWorkspaceLease {
  userKey: string;
  sessionKey: string;
  mountDir: string;
  /** Host paths of the directories bound into the sandbox */
  workspaceDir: string;
  homeDir: string;
  tmpDir: string;
  release: () => void;
}

interface MountState {
  refs: number;
  lastUsedAt: number;
}

const SUPPORT_RETRY_MS = 5 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

let supportCache: { at: number; value: SandboxSupport } | null = null;
let supportInFlight: Promise<SandboxSupport> | null = null;
const mounts = new Map<string, MountState>();
const userLocks = new Map<string, Promise<unknown>>();
const sessionLocks = new Map<string, Promise<unknown>>();
let sweeperStarted = false;

/** Filesystem-safe key for a user or session id (hashed when it has unexpected characters). */
export function toWorkspaceKey(raw: string): string {
  const value = String(raw ?? "").trim();
  if (/^[A-Za-z0-9_-]{1,64}$/.test(value)) return value;
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function chain<T>(locks: Map<string, Promise<unknown>>, key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  locks.set(key, tail);
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return run;
}

/** Serializes runs of one chat session, so no sandboxed process is alive while root reads its files. */
export function withSessionRunLock<T>(userKey: string, sessionKey: string, fn: () => Promise<T>): Promise<T> {
  return chain(sessionLocks, `${userKey}/${sessionKey}`, fn);
}

async function readExecIdentity(): Promise<{ uid: number; gid: number } | null> {
  try {
    const passwd = await fsPromises.readFile("/etc/passwd", "utf-8");
    for (const line of passwd.split("\n")) {
      const [name, , uid, gid] = line.split(":");
      if (name === SANDBOX_CONFIG.execUser) {
        const parsed = { uid: Number(uid), gid: Number(gid) };
        return parsed.uid > 0 && parsed.gid > 0 ? parsed : null;
      }
    }
  } catch {
    // fall through
  }
  return null;
}

async function detectSupport(): Promise<SandboxSupport> {
  if (!SANDBOX_CONFIG.enabled) return { ok: false, reason: "disabled by DEVNUBY_EXEC_SANDBOX=off" };
  if (process.platform !== "linux") return { ok: false, reason: "requires a Linux host" };
  if (typeof process.getuid !== "function" || process.getuid() !== 0) {
    return { ok: false, reason: "the app must run as root to mount workspaces" };
  }

  const identity = await readExecIdentity();
  if (!identity) return { ok: false, reason: `system user '${SANDBOX_CONFIG.execUser}' is missing` };

  const [bwrap, setpriv, prlimit, systemdRun, mkfs, e2fsck, mount, umount] = await Promise.all(
    ["bwrap", "setpriv", "prlimit", "systemd-run", "mkfs.ext4", "e2fsck", "mount", "umount"].map(
      findHostBinary
    )
  );
  if (!bwrap || !setpriv || !mkfs || !e2fsck || !mount || !umount) {
    return { ok: false, reason: "bubblewrap / util-linux / e2fsprogs are not installed" };
  }
  if (!fs.existsSync(SANDBOX_CONFIG.imagesDir)) {
    return { ok: false, reason: `${SANDBOX_CONFIG.imagesDir} does not exist` };
  }

  return {
    ok: true,
    uid: identity.uid,
    gid: identity.gid,
    binaries: { bwrap, setpriv, prlimit, systemdRun, mkfs, e2fsck, mount, umount },
  };
}

/** Whether this host can run the OS sandbox (cached; failures are re-checked every few minutes). */
export async function getSandboxSupport(): Promise<SandboxSupport> {
  if (supportCache && (supportCache.value.ok || Date.now() - supportCache.at < SUPPORT_RETRY_MS)) {
    return supportCache.value;
  }
  if (!supportInFlight) {
    supportInFlight = detectSupport()
      .then(async (value) => {
        supportCache = { at: Date.now(), value };
        if (value.ok) await startSweeper(value);
        return value;
      })
      .finally(() => {
        supportInFlight = null;
      });
  }
  return supportInFlight;
}

async function requireSupport(): Promise<Extract<SandboxSupport, { ok: true }>> {
  const support = await getSandboxSupport();
  if (!support.ok) throw new WorkspaceError(`Command sandbox unavailable: ${support.reason}`);
  return support;
}

async function readMountPoints(): Promise<Set<string>> {
  const points = new Set<string>();
  try {
    const info = await fsPromises.readFile("/proc/self/mountinfo", "utf-8");
    for (const line of info.split("\n")) {
      const mountPoint = line.split(" ")[4];
      if (mountPoint) points.add(mountPoint.replace(/\\040/g, " "));
    }
  } catch {
    // not Linux
  }
  return points;
}

/** Creates `dir` as a real directory owned by the sandbox user, replacing any symlink or file there. */
async function ensureRealDir(dir: string, uid: number, gid: number): Promise<void> {
  const stat = await fsPromises.lstat(dir).catch(() => null);
  if (stat && !stat.isDirectory()) {
    // rm on a symlink removes the link itself, never its target
    await fsPromises.rm(dir, { force: true, recursive: false });
  }
  if (!stat || !stat.isDirectory()) {
    await fsPromises.mkdir(dir, { mode: 0o700 });
  }
  await fsPromises.lchown(dir, uid, gid);
}

async function ensureImage(imagePath: string, support: Extract<SandboxSupport, { ok: true }>): Promise<void> {
  if (fs.existsSync(imagePath)) return;

  const disk = await fsPromises.statfs(SANDBOX_CONFIG.imagesDir);
  const hostFree = disk.bavail * disk.bsize;
  if (hostFree < SANDBOX_CONFIG.quotaBytes + SANDBOX_CONFIG.minHostFreeBytes) {
    throw new WorkspaceError("Server storage is almost full; a new workspace cannot be created right now.");
  }

  const tmpPath = `${imagePath}.creating-${process.pid}`;
  try {
    const handle = await fsPromises.open(tmpPath, "wx", 0o600);
    try {
      await handle.truncate(SANDBOX_CONFIG.quotaBytes); // sparse: no blocks used yet
    } finally {
      await handle.close();
    }
    const mkfs = await runHostCommand(support.binaries.mkfs, [
      "-q",
      "-F",
      "-m", "0",
      "-L", "devnuby-ws",
      "-J", "size=4",
      "-E", `root_owner=${support.uid}:${support.gid}`,
      tmpPath,
    ]);
    if (mkfs.code !== 0) {
      throw new WorkspaceError(`Failed to format workspace image: ${mkfs.stderr}`);
    }
    await fsPromises.rename(tmpPath, imagePath);
  } catch (err) {
    await fsPromises.rm(tmpPath, { force: true });
    throw err;
  }
}

async function mountImage(
  imagePath: string,
  mountDir: string,
  support: Extract<SandboxSupport, { ok: true }>
): Promise<void> {
  if ((await readMountPoints()).has(mountDir)) return;

  await fsPromises.mkdir(mountDir, { recursive: true, mode: 0o755 });

  // Repair after an unclean shutdown; exit codes 0-1 mean clean or fixed
  const check = await runHostCommand(support.binaries.e2fsck, ["-p", imagePath], 120_000);
  if (check.code === null || check.code >= 4) {
    const repair = await runHostCommand(support.binaries.e2fsck, ["-f", "-y", imagePath], 300_000);
    if (repair.code === null || repair.code >= 4) {
      throw new WorkspaceError(`Workspace image is damaged and could not be repaired: ${repair.stderr}`);
    }
  }

  // `discard` punches freed blocks back out of the sparse image, so deleting files
  // inside the workspace also gives the space back to the host disk
  const mounted = await runHostCommand(support.binaries.mount, [
    "-o", "loop,nosuid,nodev,noatime,discard",
    imagePath,
    mountDir,
  ]);
  if (mounted.code !== 0) {
    throw new WorkspaceError(`Failed to mount workspace: ${mounted.stderr}`);
  }
  await fsPromises.chmod(mountDir, 0o700);
}

async function pruneOldSessions(sessionsDir: string, keepKey: string): Promise<void> {
  const cutoff = Date.now() - SANDBOX_CONFIG.sessionRetentionMs;
  const entries = await fsPromises.readdir(sessionsDir).catch(() => [] as string[]);
  for (const name of entries) {
    if (name === keepKey) continue;
    const full = path.join(sessionsDir, name);
    const stat = await fsPromises.lstat(full).catch(() => null);
    if (stat && stat.mtimeMs < cutoff) {
      await fsPromises.rm(full, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/**
 * Makes sure the user's image exists and is mounted, prepares the session directory,
 * and pins the mount until `release()` is called.
 */
export async function acquireUserWorkspace(userId: string, sessionId: string): Promise<UserWorkspaceLease> {
  const support = await requireSupport();
  const userKey = toWorkspaceKey(userId);
  const sessionKey = toWorkspaceKey(sessionId);
  const imagePath = path.join(SANDBOX_CONFIG.imagesDir, `${userKey}.img`);
  const mountDir = path.join(SANDBOX_CONFIG.mountRoot, userKey);

  const lease = await chain(userLocks, userKey, async () => {
    await ensureImage(imagePath, support);
    await mountImage(imagePath, mountDir, support);

    const { uid, gid } = support;
    const sessionsDir = path.join(mountDir, "sessions");
    const workspaceDir = path.join(sessionsDir, sessionKey);
    const homeDir = path.join(mountDir, "home");
    const tmpDir = path.join(mountDir, "tmp");
    for (const dir of [sessionsDir, workspaceDir, homeDir, tmpDir]) {
      await ensureRealDir(dir, uid, gid);
    }
    await pruneOldSessions(sessionsDir, sessionKey);

    const state = mounts.get(userKey) ?? { refs: 0, lastUsedAt: Date.now() };
    state.refs += 1;
    state.lastUsedAt = Date.now();
    mounts.set(userKey, state);

    return { workspaceDir, homeDir, tmpDir };
  });

  let released = false;
  return {
    userKey,
    sessionKey,
    mountDir,
    ...lease,
    release: () => {
      if (released) return;
      released = true;
      const state = mounts.get(userKey);
      if (state) {
        state.refs = Math.max(0, state.refs - 1);
        state.lastUsedAt = Date.now();
      }
    },
  };
}

/** Whether this user already has a workspace image (never creates one). */
export function hasUserWorkspace(userId: string): boolean {
  return fs.existsSync(path.join(SANDBOX_CONFIG.imagesDir, `${toWorkspaceKey(userId)}.img`));
}

/** Disk usage of a mounted workspace image. */
export async function getWorkspaceUsage(mountDir: string): Promise<WorkspaceUsage> {
  const stats = await fsPromises.statfs(mountDir);
  return {
    usedBytes: (stats.blocks - stats.bfree) * stats.bsize,
    freeBytes: stats.bavail * stats.bsize,
    quotaBytes: SANDBOX_CONFIG.quotaBytes,
  };
}

async function sweepIdleMounts(support: Extract<SandboxSupport, { ok: true }>): Promise<void> {
  const now = Date.now();
  for (const [userKey, state] of mounts) {
    if (state.refs > 0 || now - state.lastUsedAt < SANDBOX_CONFIG.idleUnmountMs) continue;
    await chain(userLocks, userKey, async () => {
      const current = mounts.get(userKey);
      if (!current || current.refs > 0 || Date.now() - current.lastUsedAt < SANDBOX_CONFIG.idleUnmountMs) {
        return;
      }
      const mountDir = path.join(SANDBOX_CONFIG.mountRoot, userKey);
      if (!(await readMountPoints()).has(mountDir)) {
        mounts.delete(userKey);
        return;
      }
      const res = await runHostCommand(support.binaries.umount, [mountDir]);
      if (res.code === 0) mounts.delete(userKey);
    }).catch(() => undefined);
  }
}

async function startSweeper(support: Extract<SandboxSupport, { ok: true }>): Promise<void> {
  if (sweeperStarted) return;
  sweeperStarted = true;

  // Adopt mounts left behind by a previous app process so they still get unmounted
  const prefix = `${SANDBOX_CONFIG.mountRoot}/`;
  for (const point of await readMountPoints()) {
    if (point.startsWith(prefix) && !point.slice(prefix.length).includes("/")) {
      mounts.set(point.slice(prefix.length), { refs: 0, lastUsedAt: Date.now() });
    }
  }

  const timer = setInterval(() => {
    void sweepIdleMounts(support);
  }, SWEEP_INTERVAL_MS);
  timer.unref();
}
