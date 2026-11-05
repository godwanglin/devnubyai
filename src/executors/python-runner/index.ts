import type { CachedFontFamilyVariants } from "../fonts";
import { PY_FONT_RESOLVER } from "./font-resolver";
import { PY_FONT_SETUP } from "./font-setup";

/**
 * Source of the CPython startup runner. With `enforce: false` (inside the OS sandbox,
 * which already isolates the process) it only does the font registration and ReportLab
 * fallbacks: no env wipe and no audit hook, so subprocesses, network and pip work.
 * All paths must be as seen by the Python process.
 */
export function buildPythonRunnerSource(config: {
  workspaceDir: string;
  skillDir: string;
  venvDir: string;
  customFontsDir: string;
  projectRootDir: string;
  targetScriptPath: string;
  cachedFonts: CachedFontFamilyVariants[];
  enforce: boolean;
}): string {
  // Embedded as a Python dict literal, so no JSON booleans/null in here
  const configPayload = JSON.stringify({ ...config, enforce: config.enforce ? 1 : 0 });

  return `# -*- coding: utf-8 -*-
import os
import runpy
import sys

${PY_FONT_RESOLVER}

def _init_devnuby_sandbox():
    cfg = ${configPayload}
    ws_dir = os.path.normcase(os.path.realpath(cfg["workspaceDir"]))
    skill_dir = os.path.normcase(os.path.realpath(cfg["skillDir"]))
    venv_dir = os.path.normcase(os.path.realpath(cfg["venvDir"]))
    custom_fonts_dir = os.path.normcase(os.path.realpath(cfg["customFontsDir"]))
    proj_root = os.path.normcase(os.path.realpath(cfg["projectRootDir"]))
    py_prefix = os.path.normcase(os.path.realpath(sys.prefix))
    py_base_prefix = os.path.normcase(os.path.realpath(getattr(sys, "base_prefix", sys.prefix)))
    target_script = os.path.realpath(cfg["targetScriptPath"])

    win_dir = os.environ.get("WINDIR") or os.environ.get("SystemRoot") or r"C:\\Windows"
    fonts_dir = os.path.normcase(os.path.realpath(os.path.join(win_dir, "Fonts")))
    linux_fonts_dir = os.path.normcase("/usr/share/fonts")
    linux_local_fonts_dir = os.path.normcase("/usr/local/share/fonts")

    # Safe Linux read-only system & virtual paths required by Python/NumPy/Pillow/Fontconfig/OpenBLAS
    linux_ro_prefixes = tuple(
        os.path.normcase(p)
        for p in (
            "/usr",
            "/lib",
            "/lib64",
            "/etc/fonts",
            "/etc/localtime",
            "/etc/timezone",
            "/etc/ld.so.cache",
            "/etc/ld.so.conf",
            "/etc/mime.types",
            "/var/cache/fontconfig",
            "/proc/cpuinfo",
            "/proc/meminfo",
            "/proc/stat",
            "/proc/version",
            "/sys/devices/system/cpu",
        )
    )

    enforce = bool(cfg.get("enforce", 1))

    # Wipe environment variables inside process memory so os.environ has zero secrets
    # (inside the OS sandbox the environment is already clean and must keep pip/PATH settings)
    if enforce:
        safe_env = {
            "PYTHONIOENCODING": "utf-8",
            "PYTHONUTF8": "1",
            "HOME": cfg["workspaceDir"],
            "USERPROFILE": cfg["workspaceDir"],
            "TMP": cfg["workspaceDir"],
            "TEMP": cfg["workspaceDir"],
            "TMPDIR": cfg["workspaceDir"],
        }
        if "SystemRoot" in os.environ:
            safe_env["SystemRoot"] = os.environ["SystemRoot"]
        if "WINDIR" in os.environ:
            safe_env["WINDIR"] = os.environ["WINDIR"]
        os.environ.clear()
        os.environ.update(safe_env)

    def _is_under(child, parent):
        return child == parent or child.startswith(parent + os.sep)

    def _check_path(raw_path, is_write=False):
        if raw_path is None or isinstance(raw_path, int):
            return
        try:
            p_str = os.fsdecode(raw_path)
        except Exception:
            p_str = str(raw_path)

        # Allow standard streams or special character devices (/dev/null, /dev/urandom, /dev/random, /dev/zero)
        if p_str in (
            "<stdin>",
            "<stdout>",
            "<stderr>",
            "nul",
            "NUL",
            "/dev/null",
            "/dev/urandom",
            "/dev/random",
            "/dev/zero",
        ):
            return

        real = os.path.normcase(os.path.realpath(p_str))

        if is_write:
            if not _is_under(real, ws_dir):
                raise PermissionError(
                    f"[Devnuby Sandbox] Write access denied outside isolated workspace: {p_str}"
                )
            return

        # Read access check:
        # 1. Always allow inside workspaceDir, skillDir, venvDir, customFontsDir, Python stdlib, or system fonts
        if (
            _is_under(real, ws_dir)
            or _is_under(real, skill_dir)
            or _is_under(real, venv_dir)
            or _is_under(real, custom_fonts_dir)
            or _is_under(real, py_prefix)
            or _is_under(real, py_base_prefix)
            or _is_under(real, fonts_dir)
            or _is_under(real, linux_fonts_dir)
            or _is_under(real, linux_local_fonts_dir)
        ):
            return

        # 2. Explicitly block anything inside project root (e.g. .env, src/, prisma/, package.json)
        if _is_under(real, proj_root):
            raise PermissionError(
                f"[Devnuby Sandbox] Read access to internal application path is strictly forbidden: {p_str}"
            )

        # 3. Allow read-only Linux system shared libraries, fontconfig caches, and CPU/memory info
        for ro_prefix in linux_ro_prefixes:
            if _is_under(real, ro_prefix):
                return

        # 4. Block arbitrary host filesystem reads outside allowed directories
        raise PermissionError(
            f"[Devnuby Sandbox] Read access outside isolated workspace is forbidden: {p_str}"
        )

    BLOCKED_EVENTS = frozenset({
        "subprocess.Popen",
        "os.system",
        "os.exec",
        "os.spawn",
        "os.fork",
        "os.posix_spawn",
        "socket.connect",
        "socket.bind",
        "socket.getaddrinfo",
        "socket.new",
        "urllib.Request",
        "ftplib.connect",
        "smtplib.connect",
        "telnetlib.open",
        "webbrowser.open",
    })

    WRITE_FS_EVENTS = frozenset({
        "os.remove",
        "os.unlink",
        "os.rmdir",
        "os.mkdir",
        "os.chmod",
        "os.chown",
        "os.truncate",
        "os.utime",
        "shutil.rmtree",
    })

    READ_FS_EVENTS = frozenset({
        "os.listdir",
        "os.scandir",
    })

    DUAL_FS_EVENTS = frozenset({
        "os.rename",
        "os.replace",
        "os.link",
        "os.symlink",
        "shutil.copyfile",
        "shutil.copymode",
        "shutil.copystat",
        "shutil.move",
    })

    def _audit_hook(event, args):
        if event in BLOCKED_EVENTS or event.startswith("subprocess.") or event.startswith("socket."):
            raise PermissionError(
                f"[Devnuby Sandbox] Operation '{event}' is blocked by security policy."
            )

        if event == "open":
            path_arg = args[0] if len(args) > 0 else None
            mode_arg = args[1] if len(args) > 1 else "r"
            flags_arg = args[2] if len(args) > 2 else 0
            is_w = False
            if isinstance(mode_arg, str) and any(m in mode_arg for m in ("w", "a", "x", "+")):
                is_w = True
            if isinstance(flags_arg, int) and (
                flags_arg & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND)
            ):
                is_w = True
            _check_path(path_arg, is_write=is_w)
        elif event in WRITE_FS_EVENTS:
            if len(args) > 0:
                _check_path(args[0], is_write=True)
        elif event in READ_FS_EVENTS:
            if len(args) > 0:
                _check_path(args[0], is_write=False)
        elif event in DUAL_FS_EVENTS:
            if len(args) > 0:
                _check_path(args[0], is_write=(event in ("os.rename", "os.replace", "shutil.move")))
            if len(args) > 1:
                _check_path(args[1], is_write=True)

    # Windows-safe os.replace / os.rename wrapper to prevent WinError 5 when overwriting open files
    _orig_replace = os.replace
    def _safe_replace(src, dst, *args, **kwargs):
        try:
            return _orig_replace(src, dst, *args, **kwargs)
        except PermissionError:
            import gc
            import shutil
            gc.collect()
            try:
                return _orig_replace(src, dst, *args, **kwargs)
            except PermissionError:
                _check_path(src, is_write=True)
                _check_path(dst, is_write=True)
                shutil.copyfile(src, dst)
                try:
                    os.remove(src)
                except OSError:
                    pass
    os.replace = _safe_replace

    sys.argv = [target_script] + sys.argv[1:]
    sys.path.insert(0, os.path.dirname(target_script))
    if enforce:
        sys.addaudithook(_audit_hook)

${PY_FONT_SETUP}


    return target_script

_target = _init_devnuby_sandbox()
runpy.run_path(_target, run_name="__main__")
`;
}
