import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EXECUTOR_CONFIG } from "./config";
import type { CachedFontFamilyVariants } from "./fonts";
import type { SkillScriptRuntime } from "./types";

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

_FONT_STYLE_SUFFIXES = (
    ("bolditalic", 3), ("boldoblique", 3), ("bold-italic", 3), ("bold-oblique", 3),
    ("italic", 2), ("oblique", 2), ("it", 2),
    ("bold", 1), ("bd", 1),
    ("regular", 0), ("book", 0), ("roman", 0),
)

def _make_font_file_resolver(search_dirs, serif_files, sans_files, mono_files):
    """Maps a missing font file path to the closest installed one (same file elsewhere,
    another style of the same family, then a generic serif/sans/mono family)."""
    index = {}
    def _build_index():
        if index:
            return index
        for root_dir in search_dirs:
            if not root_dir or not os.path.isdir(root_dir):
                continue
            for dirpath, _dirs, files in os.walk(root_dir):
                for fn in files:
                    if fn.lower().endswith((".ttf", ".ttc")):
                        index.setdefault(fn.lower(), os.path.join(dirpath, fn))
        return index

    def _split_style(stem):
        low = stem.lower()
        for suffix, style in _FONT_STYLE_SUFFIXES:
            for sep in ("-", "_", " ", ""):
                if not sep and len(suffix) <= 2:
                    continue
                tail = sep + suffix
                if low.endswith(tail) and len(low) > len(tail) + 1:
                    return stem[: len(stem) - len(tail)], style
        return stem, 0

    warned = set()
    def resolve(raw_path):
        path_str = os.fsdecode(raw_path)
        base = os.path.basename(path_str)
        idx = _build_index()
        found = idx.get(base.lower())
        stem, style = _split_style(os.path.splitext(base)[0])
        if not found:
            family = stem.lower()
            wanted = {
                0: ("", "-regular", "regular", "-book", "-roman"),
                1: ("-bold", "bold", "-bd", "bd"),
                2: ("-italic", "-oblique", "italic", "oblique", "-it", "i"),
                3: ("-bolditalic", "-boldoblique", "bolditalic", "boldoblique", "bi", "z"),
            }
            # Same family, same style first; then the family's regular face
            for style_try in (style, 0):
                for suffix in wanted[style_try]:
                    for ext in (".ttf", ".ttc"):
                        hit = idx.get(family + suffix + ext)
                        if hit:
                            found = hit
                            break
                    if found:
                        break
                if found:
                    break
        if not found:
            key = stem.lower()
            if any(k in key for k in ("mono", "courier", "consola", "code")):
                generic = mono_files
            elif any(k in key for k in ("serif", "times", "georgia", "garamond", "cambria", "caladea")) and "sans" not in key:
                generic = serif_files
            else:
                generic = sans_files
            if generic:
                found = generic[style] if (style < len(generic) and generic[style] and os.path.exists(generic[style])) else generic[0]
        if not found:
            return raw_path
        if path_str not in warned:
            warned.add(path_str)
            sys.stderr.write(
                "[devnuby] font file not found: " + path_str + " -> using " + found + "\\n"
            )
        return found
    return resolve

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

    # Pre-register system fonts ("Times New Roman", "Arial", etc.) & cached Google Fonts in reportlab
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.lib import fonts as rl_fonts
        from reportlab.platypus import paraparser as rl_paraparser

        def _reg_family(fam_name, reg_p, bold_p=None, it_p=None, bi_p=None):
            if not reg_p or not os.path.exists(reg_p):
                return False
            b_p = bold_p if (bold_p and os.path.exists(bold_p)) else reg_p
            i_p = it_p if (it_p and os.path.exists(it_p)) else reg_p
            bi_p_final = bi_p if (bi_p and os.path.exists(bi_p)) else (b_p if b_p != reg_p else i_p)
            pdfmetrics.registerFont(TTFont(fam_name, reg_p))
            pdfmetrics.registerFont(TTFont(f"{fam_name}-Regular", reg_p))
            pdfmetrics.registerFont(TTFont(f"{fam_name}-Bold", b_p))
            pdfmetrics.registerFont(TTFont(f"{fam_name}-Italic", i_p))
            pdfmetrics.registerFont(TTFont(f"{fam_name}-BoldItalic", bi_p_final))
            pdfmetrics.registerFontFamily(
                fam_name,
                normal=fam_name,
                bold=f"{fam_name}-Bold",
                italic=f"{fam_name}-Italic",
                boldItalic=f"{fam_name}-BoldItalic",
            )
            return True

        # 1. Register cached Google Fonts from .devnuby/fonts/
        for gf in cfg.get("cachedFonts", []):
            fam = gf.get("family")
            if fam:
                _reg_family(
                    fam,
                    gf.get("regular"),
                    gf.get("bold"),
                    gf.get("italic"),
                    gf.get("boldItalic"),
                )
                no_space = fam.replace(" ", "")
                if no_space != fam:
                    _reg_family(
                        no_space,
                        gf.get("regular"),
                        gf.get("bold"),
                        gf.get("italic"),
                        gf.get("boldItalic"),
                    )

        # 2. Register cross-platform system font families (Windows + Linux parity)
        def _first_existing(candidates):
            for c_reg, c_bold, c_it, c_bi in candidates:
                if c_reg and os.path.exists(c_reg):
                    return (c_reg, c_bold, c_it, c_bi)
            return None

        # 2a. Genuine Microsoft core fonts (ttf-mscorefonts-installer on Linux, Fonts dir on
        # Windows) under their own names, before the metric-compatible stand-ins below
        ms_dir = "/usr/share/fonts/truetype/msttcorefonts"
        ms_win = os.path.join(win_dir, "Fonts")
        ms_families = {
            "Arial": ("arial", "arialbd", "ariali", "arialbi"),
            "Times New Roman": ("times", "timesbd", "timesi", "timesbi"),
            "Courier New": ("cour", "courbd", "couri", "courbi"),
            "Georgia": ("georgia", "georgiab", "georgiai", "georgiaz"),
            "Verdana": ("verdana", "verdanab", "verdanai", "verdanaz"),
            "Trebuchet MS": ("trebuc", "trebucbd", "trebucit", "trebucbi"),
            "Comic Sans MS": ("comic", "comicbd", None, None),
            "Arial Black": ("ariblk", None, None, None),
            "Impact": ("impact", None, None, None),
            "Andale Mono": ("andalemo", None, None, None),
        }
        for ms_name, stems in ms_families.items():
            for base_dir in (ms_dir, ms_win):
                files = [os.path.join(base_dir, s + ".ttf") if s else None for s in stems]
                if files[0] and os.path.exists(files[0]):
                    _reg_family(ms_name, *files)
                    no_space = ms_name.replace(" ", "")
                    if no_space != ms_name:
                        _reg_family(no_space, *files)
                    break

        # Open stand-ins under their own names too (asked for by name, they must not become Arial)
        lin = "/usr/share/fonts/truetype"
        for own_name, own_files in (
            ("Liberation Serif", ("liberation/LiberationSerif-Regular", "liberation/LiberationSerif-Bold", "liberation/LiberationSerif-Italic", "liberation/LiberationSerif-BoldItalic")),
            ("Liberation Sans", ("liberation/LiberationSans-Regular", "liberation/LiberationSans-Bold", "liberation/LiberationSans-Italic", "liberation/LiberationSans-BoldItalic")),
            ("Liberation Mono", ("liberation/LiberationMono-Regular", "liberation/LiberationMono-Bold", "liberation/LiberationMono-Italic", "liberation/LiberationMono-BoldItalic")),
            ("Caladea", ("crosextra/Caladea-Regular", "crosextra/Caladea-Bold", "crosextra/Caladea-Italic", "crosextra/Caladea-BoldItalic")),
            ("Lato", ("lato/Lato-Regular", "lato/Lato-Bold", "lato/Lato-Italic", "lato/Lato-BoldItalic")),
            ("DejaVu Serif", ("dejavu/DejaVuSerif", "dejavu/DejaVuSerif-Bold", "dejavu/DejaVuSerif-Italic", "dejavu/DejaVuSerif-BoldItalic")),
            ("DejaVu Sans", ("dejavu/DejaVuSans", "dejavu/DejaVuSans-Bold", "dejavu/DejaVuSans-Oblique", "dejavu/DejaVuSans-BoldOblique")),
            ("DejaVu Sans Mono", ("dejavu/DejaVuSansMono", "dejavu/DejaVuSansMono-Bold", "dejavu/DejaVuSansMono-Oblique", "dejavu/DejaVuSansMono-BoldOblique")),
        ):
            own_paths = [lin + "/" + rel + ".ttf" for rel in own_files]
            if own_name not in pdfmetrics._fonts and os.path.exists(own_paths[0]):
                _reg_family(own_name, *own_paths)

        serif_candidates = [
            (
                ms_dir + "/times.ttf",
                ms_dir + "/timesbd.ttf",
                ms_dir + "/timesi.ttf",
                ms_dir + "/timesbi.ttf",
            ),
            (
                os.path.join(win_dir, "Fonts", "times.ttf"),
                os.path.join(win_dir, "Fonts", "timesbd.ttf"),
                os.path.join(win_dir, "Fonts", "timesi.ttf"),
                os.path.join(win_dir, "Fonts", "timesbi.ttf"),
            ),
            (
                "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSerif-BoldItalic.ttf",
            ),
            (
                "/usr/share/fonts/truetype/crosextra/Caladea-Regular.ttf",
                "/usr/share/fonts/truetype/crosextra/Caladea-Bold.ttf",
                "/usr/share/fonts/truetype/crosextra/Caladea-Italic.ttf",
                "/usr/share/fonts/truetype/crosextra/Caladea-BoldItalic.ttf",
            ),
            (
                "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Italic.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSerif-BoldItalic.ttf",
            ),
        ]
        serif_files = _first_existing(serif_candidates)
        if serif_files:
            for alias in ("Times New Roman", "TimesNewRoman", "Times", "Georgia", "Cambria", "Liberation Serif", "Caladea", "DejaVu Serif"):
                if alias not in pdfmetrics._fonts:
                    _reg_family(alias, *serif_files)

        sans_candidates = [
            (
                ms_dir + "/arial.ttf",
                ms_dir + "/arialbd.ttf",
                ms_dir + "/ariali.ttf",
                ms_dir + "/arialbi.ttf",
            ),
            (
                os.path.join(win_dir, "Fonts", "arial.ttf"),
                os.path.join(win_dir, "Fonts", "arialbd.ttf"),
                os.path.join(win_dir, "Fonts", "ariali.ttf"),
                os.path.join(win_dir, "Fonts", "arialbi.ttf"),
            ),
            (
                "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationSans-BoldItalic.ttf",
            ),
            (
                "/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf",
                "/usr/share/fonts/truetype/crosextra/Carlito-Bold.ttf",
                "/usr/share/fonts/truetype/crosextra/Carlito-Italic.ttf",
                "/usr/share/fonts/truetype/crosextra/Carlito-BoldItalic.ttf",
            ),
            (
                "/usr/share/fonts/truetype/lato/Lato-Regular.ttf",
                "/usr/share/fonts/truetype/lato/Lato-Bold.ttf",
                "/usr/share/fonts/truetype/lato/Lato-Italic.ttf",
                "/usr/share/fonts/truetype/lato/Lato-BoldItalic.ttf",
            ),
            (
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf",
            ),
        ]
        sans_files = _first_existing(sans_candidates)
        if sans_files:
            # Calibri gets its own metric-compatible Carlito below (a font name is registered once)
            for alias in ("Arial", "Verdana", "Tahoma", "Segoe UI", "Liberation Sans", "Lato", "DejaVu Sans"):
                if alias not in pdfmetrics._fonts:
                    _reg_family(alias, *sans_files)

        calibri_candidates = [
            (
                os.path.join(win_dir, "Fonts", "calibri.ttf"),
                os.path.join(win_dir, "Fonts", "calibrib.ttf"),
                os.path.join(win_dir, "Fonts", "calibrii.ttf"),
                os.path.join(win_dir, "Fonts", "calibriz.ttf"),
            ),
            (
                "/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf",
                "/usr/share/fonts/truetype/crosextra/Carlito-Bold.ttf",
                "/usr/share/fonts/truetype/crosextra/Carlito-Italic.ttf",
                "/usr/share/fonts/truetype/crosextra/Carlito-BoldItalic.ttf",
            ),
        ]
        calibri_files = _first_existing(calibri_candidates)
        for alias in ("Calibri", "Carlito"):
            if calibri_files:
                _reg_family(alias, *calibri_files)
            elif sans_files:
                _reg_family(alias, *sans_files)

        mono_candidates = [
            (
                ms_dir + "/cour.ttf",
                ms_dir + "/courbd.ttf",
                ms_dir + "/couri.ttf",
                ms_dir + "/courbi.ttf",
            ),
            (
                os.path.join(win_dir, "Fonts", "cour.ttf"),
                os.path.join(win_dir, "Fonts", "courbd.ttf"),
                os.path.join(win_dir, "Fonts", "couri.ttf"),
                os.path.join(win_dir, "Fonts", "courbi.ttf"),
            ),
            (
                "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationMono-Italic.ttf",
                "/usr/share/fonts/truetype/liberation/LiberationMono-BoldItalic.ttf",
            ),
            (
                "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Oblique.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-BoldOblique.ttf",
            ),
        ]
        mono_files = _first_existing(mono_candidates)
        if mono_files:
            for alias in ("Courier New", "Consolas", "Liberation Mono", "DejaVu Sans Mono"):
                if alias not in pdfmetrics._fonts:
                    _reg_family(alias, *mono_files)

        # 2b. Font FILE preflight: a TTFont / PIL ImageFont pointing at a font file that is
        # not installed here (e.g. DejaVuSans-Oblique.ttf on a host with only fonts-dejavu-core)
        # resolves to the closest installed file instead of crashing the whole document build.
        _resolve_font_file = _make_font_file_resolver(
            [custom_fonts_dir, linux_fonts_dir, linux_local_fonts_dir, fonts_dir],
            serif_files, sans_files, mono_files,
        )
        globals()["_devnuby_font_resolver"] = _resolve_font_file
        _orig_ttfont_init = TTFont.__init__
        def _safe_ttfont_init(self, name, filename, *args, **kwargs):
            if isinstance(filename, (str, bytes, os.PathLike)) and not os.path.exists(filename):
                filename = _resolve_font_file(filename)
            return _orig_ttfont_init(self, name, filename, *args, **kwargs)
        TTFont.__init__ = _safe_ttfont_init
    except Exception:
        pass

    try:
        from PIL import ImageFont as _pil_image_font
        _orig_truetype = _pil_image_font.truetype
        def _safe_truetype(font=None, *args, **kwargs):
            try:
                return _orig_truetype(font, *args, **kwargs)
            except OSError:
                if isinstance(font, (str, bytes, os.PathLike)) and not os.path.exists(font):
                    resolver = globals().get("_devnuby_font_resolver")
                    if resolver:
                        return _orig_truetype(resolver(font), *args, **kwargs)
                raise
        _pil_image_font.truetype = _safe_truetype
    except Exception:
        pass

    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.lib import fonts as rl_fonts
        from reportlab.platypus import paraparser as rl_paraparser

        # 3. Graceful getFont & ps2tt/tt2ps fallback so ANY font name (even unregistered) never crashes ReportLab Paragraph/Canvas
        _orig_get_font = pdfmetrics.getFont
        _STD_FALLBACKS = {
            "times new roman": "Times-Roman",
            "times new roman-bold": "Times-Bold",
            "times new roman-italic": "Times-Italic",
            "times new roman-bolditalic": "Times-BoldItalic",
            "timesnewroman": "Times-Roman",
            "timesnewroman-bold": "Times-Bold",
            "georgia": "Times-Roman",
            "georgia-bold": "Times-Bold",
            "arial": "Helvetica",
            "arial-bold": "Helvetica-Bold",
            "arial-italic": "Helvetica-Oblique",
            "calibri": "Helvetica",
            "calibri-bold": "Helvetica-Bold",
            "courier new": "Courier",
            "courier new-bold": "Courier-Bold",
        }
        def _safe_get_font(font_name):
            try:
                return _orig_get_font(font_name)
            except Exception:
                key = str(font_name or "").strip().lower()
                is_serif = any(k in key for k in ("times", "georgia", "serif", "cambria", "garamond", "palatino", "caladea"))
                is_mono = any(k in key for k in ("courier", "consolas", "mono", "menlo", "fira code"))
                target_std = "Times-Roman" if is_serif else ("Courier" if is_mono else "Helvetica")
                if key in _STD_FALLBACKS:
                    target_std = _STD_FALLBACKS[key]
                elif "bold" in key and ("italic" in key or "oblique" in key):
                    target_std = "Times-BoldItalic" if is_serif else ("Courier-BoldOblique" if is_mono else "Helvetica-BoldOblique")
                elif "bold" in key:
                    target_std = "Times-Bold" if is_serif else ("Courier-Bold" if is_mono else "Helvetica-Bold")
                elif "italic" in key or "oblique" in key:
                    target_std = "Times-Italic" if is_serif else ("Courier-Oblique" if is_mono else "Helvetica-Oblique")
                resolved = _orig_get_font(target_std)
                try:
                    pdfmetrics._fonts[font_name] = resolved
                except Exception:
                    pass
                return resolved
        pdfmetrics.getFont = _safe_get_font

        _orig_ps2tt = rl_fonts.ps2tt
        def _safe_ps2tt(psfn):
            try:
                return _orig_ps2tt(psfn)
            except Exception:
                key = str(psfn or "").strip().lower()
                b = 1 if ("bold" in key or key.endswith("-b")) else 0
                i = 1 if ("italic" in key or "oblique" in key or key.endswith("-i") or key.endswith("-bi")) else 0
                fam = "times" if any(k in key for k in ("times", "georgia", "serif", "cambria", "garamond")) else ("courier" if ("courier" in key or "mono" in key or "consolas" in key) else "helvetica")
                return (fam, b, i)
        rl_fonts.ps2tt = _safe_ps2tt
        rl_paraparser.ps2tt = _safe_ps2tt

        _orig_tt2ps = rl_fonts.tt2ps
        def _safe_tt2ps(fn, b, i):
            try:
                return _orig_tt2ps(fn, b, i)
            except Exception:
                key = str(fn or "").strip().lower()
                fam = "times" if any(k in key for k in ("times", "georgia", "serif", "cambria", "garamond")) else ("courier" if ("courier" in key or "mono" in key or "consolas" in key) else "helvetica")
                return _orig_tt2ps(fam, b, i)
        rl_fonts.tt2ps = _safe_tt2ps
        rl_paraparser.tt2ps = _safe_tt2ps

        # Also patch Canvas.setFont so unknown psfontname resolves to registered fontName
        from reportlab.pdfgen.canvas import Canvas
        _orig_set_font = Canvas.setFont
        def _safe_set_font(self, psfontname, size, leading=None):
            try:
                return _orig_set_font(self, psfontname, size, leading)
            except Exception:
                resolved = _safe_get_font(psfontname)
                return _orig_set_font(self, resolved.fontName, size, leading)
        Canvas.setFont = _safe_set_font
    except Exception:
        pass

    return target_script

_target = _init_devnuby_sandbox()
runpy.run_path(_target, run_name="__main__")
`;
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
