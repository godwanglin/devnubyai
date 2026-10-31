"use strict";

(() => {
  const PYODIDE_CDN_PREFIX = "https://cdn.jsdelivr.net/pyodide/v0.27.4/full/";
  const MAX_STREAM_CHARS = 16384;

  // Capture privileged primitives in private closure before locking down global scope
  const nativeFetch = self.fetch.bind(self);
  const nativePostMessage = self.postMessage.bind(self);
  const nativeImportScripts = self.importScripts.bind(self);

  let allowPyodideCdn = false;
  let pyodideInstance = null;
  let pythonRunnerProxy = null;

  function lockGlobal(target, prop, value) {
    try {
      Object.defineProperty(target, prop, { configurable: false, writable: false, value });
    } catch {
      try {
        target[prop] = value;
      } catch {}
    }
  }

  const blockedApi = (name) => () => {
    throw new Error(`SecurityError: ${name} is disabled inside the WASM sandbox.`);
  };

  // Prevent untrusted code (JS eval or Python `import js`) from spoofing worker messages
  lockGlobal(self, "postMessage", blockedApi("postMessage"));
  for (const api of [
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "BroadcastChannel",
    "Worker",
    "SharedWorker",
  ]) {
    lockGlobal(self, api, blockedApi(api));
  }
  lockGlobal(self, "indexedDB", undefined);
  lockGlobal(self, "caches", undefined);
  if (self.navigator && typeof self.navigator.sendBeacon === "function") {
    lockGlobal(self.navigator, "sendBeacon", blockedApi("navigator.sendBeacon"));
  }

  // Strictly gate `fetch` and `importScripts` to Pyodide CDN ONLY during runtime/package loading
  lockGlobal(self, "fetch", function sandboxedFetch(input, init) {
    const rawUrl =
      typeof input === "string"
        ? input
        : input && typeof input.url === "string"
          ? input.url
          : String(input);
    const method = (init && init.method ? String(init.method) : "GET").toUpperCase();
    if (allowPyodideCdn && method === "GET" && rawUrl.startsWith(PYODIDE_CDN_PREFIX)) {
      return nativeFetch(rawUrl, { method: "GET", credentials: "omit", mode: "cors" });
    }
    return Promise.reject(
      new Error("SecurityError: Outbound network access is blocked in WASM sandbox.")
    );
  });

  lockGlobal(self, "importScripts", function sandboxedImportScripts(...urls) {
    if (
      !allowPyodideCdn ||
      urls.length === 0 ||
      urls.some((u) => typeof u !== "string" || !u.startsWith(PYODIDE_CDN_PREFIX))
    ) {
      throw new Error("SecurityError: External script loading is blocked in WASM sandbox.");
    }
    return nativeImportScripts(...urls);
  });

  const PYTHON_HARNESS_SOURCE = `
import sys, os, io, traceback, importlib.util
from pyodide.code import eval_code_async

MAX_STREAM_CHARS = 16384
MAX_CHARTS = 4
MAX_CHART_BYTES = 5 * 1024 * 1024

class _CappedStream(io.TextIOBase):
    def __init__(self, limit):
        self.limit = limit
        self.parts = []
        self.length = 0
        self.truncated = False

    def write(self, s):
        s = s if isinstance(s, str) else str(s)
        if self.truncated:
            return len(s)
        rem = self.limit - self.length
        if len(s) <= rem:
            self.parts.append(s)
            self.length += len(s)
        else:
            if rem > 0:
                self.parts.append(s[:rem])
                self.length += rem
            self.parts.append("\\n...[output truncated]")
            self.truncated = True
        return len(s)

    def flush(self):
        pass

    def getvalue(self):
        return "".join(self.parts)

async def _devnuby_execute(user_code):
    os.environ["MPLBACKEND"] = "AGG"
    os.makedirs("/workspace", exist_ok=True)
    os.chdir("/workspace")

    before_files = {
        e: os.stat(os.path.join("/workspace", e)).st_mtime_ns
        for e in os.listdir("/workspace")
        if os.path.isfile(os.path.join("/workspace", e))
    }

    captured_charts = []
    has_mpl = importlib.util.find_spec("matplotlib") is not None
    plt = None
    Figure = None
    orig_savefig = None

    def _capture_figs():
        if plt is None or orig_savefig is None:
            return
        for num in list(plt.get_fignums()):
            fig = plt.figure(num)
            if not getattr(fig, "_devnuby_saved", False) and len(captured_charts) < MAX_CHARTS:
                buf = io.BytesIO()
                face = fig.get_facecolor() if hasattr(fig, "get_facecolor") else "white"
                orig_savefig(fig, buf, format="png", dpi=160, bbox_inches="tight", facecolor=face)
                raw = buf.getvalue()
                if 0 < len(raw) <= MAX_CHART_BYTES:
                    captured_charts.append((f"chart-{len(captured_charts) + 1}.png", raw))
                fig._devnuby_saved = True
            plt.close(fig)

    if has_mpl:
        import matplotlib
        matplotlib.use("Agg", force=True)
        import matplotlib.pyplot as _plt
        from matplotlib.figure import Figure as _Figure
        plt, Figure = _plt, _Figure
        plt.close("all")
        orig_savefig = Figure.savefig
        def _wrapped_savefig(self_fig, *args, **kwargs):
            self_fig._devnuby_saved = True
            return orig_savefig(self_fig, *args, **kwargs)
        Figure.savefig = _wrapped_savefig
        plt.show = lambda *a, **kw: _capture_figs()

    out_s, err_s = _CappedStream(MAX_STREAM_CHARS), _CappedStream(MAX_STREAM_CHARS)
    prev_out, prev_err = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = out_s, err_s
    ok, result_text = True, ""

    try:
        val = await eval_code_async(user_code, globals={"__name__": "__main__", "__builtins__": __builtins__})
        if val is not None:
            rendered = repr(val)
            if not rendered.startswith(("<matplotlib.", "[<matplotlib.", "Figure(")):
                result_text = rendered[:4000]
    except Exception:
        ok = False
        tb = traceback.format_exc().splitlines()
        cleaned = [l for l in tb if "_pyodide" not in l and "eval_code_async" not in l and "_devnuby_execute" not in l]
        err_s.write("\\n".join(cleaned if cleaned else tb))
    finally:
        sys.stdout, sys.stderr = prev_out, prev_err
        if has_mpl and plt is not None and Figure is not None:
            try:
                _capture_figs()
            finally:
                plt.close("all")
                if orig_savefig is not None:
                    Figure.savefig = orig_savefig

    if len(captured_charts) < MAX_CHARTS:
        for entry in sorted(os.listdir("/workspace")):
            if len(captured_charts) >= MAX_CHARTS:
                break
            full_p = os.path.join("/workspace", entry)
            if not os.path.isfile(full_p) or not entry.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                continue
            st = os.stat(full_p)
            if (entry not in before_files or before_files[entry] != st.st_mtime_ns) and 0 < st.st_size <= MAX_CHART_BYTES:
                with open(full_p, "rb") as fh:
                    captured_charts.append((entry, fh.read()))

    return {
        "ok": ok,
        "stdout": out_s.getvalue(),
        "stderr": err_s.getvalue(),
        "resultText": result_text,
        "charts": captured_charts,
    }

_devnuby_execute
`;

  async function ensurePyodideLoaded() {
    if (pyodideInstance && pythonRunnerProxy) return;
    allowPyodideCdn = true;
    try {
      if (!pyodideInstance) {
        nativeImportScripts(`${PYODIDE_CDN_PREFIX}pyodide.js`);
        const loader = self.loadPyodide;
        try {
          delete self.loadPyodide;
        } catch {
          self.loadPyodide = undefined;
        }
        pyodideInstance = await loader({ indexURL: PYODIDE_CDN_PREFIX });
      }
      if (!pythonRunnerProxy) {
        pythonRunnerProxy = pyodideInstance.runPython(PYTHON_HARNESS_SOURCE);
      }
    } finally {
      allowPyodideCdn = false;
    }
  }

  function cleanWorkspaceDir(FS, dirPath) {
    try {
      if (!FS.analyzePath(dirPath).exists) {
        FS.mkdirTree(dirPath);
        return;
      }
      for (const entry of FS.readdir(dirPath)) {
        if (entry === "." || entry === "..") continue;
        const full = `${dirPath}/${entry}`;
        if (FS.isDir(FS.stat(full).mode)) {
          cleanWorkspaceDir(FS, full);
          FS.rmdir(full);
        } else {
          FS.unlink(full);
        }
      }
    } catch {}
  }

  async function executePython(runId, code, files) {
    nativePostMessage({ type: "phase", runId, phase: "loading_runtime" });
    await ensurePyodideLoaded();

    allowPyodideCdn = true;
    try {
      await pyodideInstance.loadPackagesFromImports(code);
      if (/\b(plt|matplotlib)\b/.test(code)) {
        await pyodideInstance.loadPackage("matplotlib");
      }
    } finally {
      allowPyodideCdn = false;
    }

    const FS = pyodideInstance.FS;
    cleanWorkspaceDir(FS, "/workspace");
    if (Array.isArray(files)) {
      for (const f of files) {
        if (!f || !f.bytes) continue;
        const base = String(f.name || "data.txt").split(/[\\/]/).pop() || "data.txt";
        const safeName = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 96) || "data.txt";
        FS.writeFile(`/workspace/${safeName}`, new Uint8Array(f.bytes));
      }
    }

    allowPyodideCdn = false;
    nativePostMessage({ type: "phase", runId, phase: "executing" });

    const startTime = performance.now();
    const pyResult = await pythonRunnerProxy(code);
    const durationMs = Math.max(1, Math.round(performance.now() - startTime));

    let jsResult;
    try {
      jsResult = pyResult.toJs({ dict_converter: Object.fromEntries });
    } finally {
      if (pyResult && typeof pyResult.destroy === "function") pyResult.destroy();
      cleanWorkspaceDir(FS, "/workspace");
    }

    const charts = [];
    const transferList = [];
    if (Array.isArray(jsResult.charts)) {
      for (const item of jsResult.charts) {
        const filename = Array.isArray(item) ? item[0] : item.filename;
        const rawBytes = Array.isArray(item) ? item[1] : item.bytes;
        if (rawBytes) {
          const standalone = new Uint8Array(rawBytes);
          const copy = new Uint8Array(standalone.byteLength);
          copy.set(standalone);
          charts.push({
            filename: String(filename || `chart-${charts.length + 1}.png`),
            bytes: copy.buffer,
          });
          transferList.push(copy.buffer);
        }
      }
    }

    nativePostMessage(
      {
        type: "result",
        runId,
        ok: Boolean(jsResult.ok),
        stdout: String(jsResult.stdout || ""),
        stderr: String(jsResult.stderr || ""),
        resultText: String(jsResult.resultText || ""),
        durationMs,
        charts,
      },
      transferList
    );
  }

  function formatJsValue(val) {
    if (val === undefined) return "undefined";
    if (val === null) return "null";
    if (typeof val === "string") return val;
    if (typeof val === "number" || typeof val === "boolean" || typeof val === "bigint") {
      return String(val);
    }
    if (val instanceof Error) return val.stack || `${val.name}: ${val.message}`;
    try {
      const seen = new WeakSet();
      return JSON.stringify(
        val,
        (_k, v) => {
          if (typeof v === "bigint") return `${v.toString()}n`;
          if (typeof v === "object" && v !== null) {
            if (seen.has(v)) return "[Circular]";
            seen.add(v);
          }
          return v;
        },
        2
      );
    } catch {
      return String(val);
    }
  }

  function createCappedBuffer(limit) {
    let text = "";
    let truncated = false;
    return {
      append(line) {
        if (truncated) return;
        const chunk = `${line}\n`;
        if (text.length + chunk.length <= limit) {
          text += chunk;
        } else {
          text += `${chunk.slice(0, Math.max(0, limit - text.length))}\n...[output truncated]`;
          truncated = true;
        }
      },
      value() {
        return text.replace(/\n$/, "");
      },
    };
  }

  async function executeJavaScript(runId, code) {
    allowPyodideCdn = false;
    nativePostMessage({ type: "phase", runId, phase: "executing" });

    const outBuf = createCappedBuffer(MAX_STREAM_CHARS);
    const errBuf = createCappedBuffer(MAX_STREAM_CHARS);
    const fmt = (args) => args.map(formatJsValue).join(" ");
    const sandboxConsole = {
      log: (...a) => outBuf.append(fmt(a)),
      info: (...a) => outBuf.append(fmt(a)),
      debug: (...a) => outBuf.append(fmt(a)),
      warn: (...a) => errBuf.append(fmt(a)),
      error: (...a) => errBuf.append(fmt(a)),
      table: (data) => outBuf.append(formatJsValue(data)),
    };

    const startTime = performance.now();
    let ok = true;
    let resultText = "";

    try {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const shadowed = [
        "self",
        "globalThis",
        "window",
        "fetch",
        "XMLHttpRequest",
        "WebSocket",
        "EventSource",
        "importScripts",
        "postMessage",
        "caches",
        "indexedDB",
      ];
      const fn = new AsyncFunction("console", ...shadowed, `"use strict";\n${code}`);
      const returned = await fn(sandboxConsole, ...shadowed.map(() => undefined));
      if (returned !== undefined) resultText = formatJsValue(returned).slice(0, 4000);
    } catch (err) {
      ok = false;
      errBuf.append(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    }

    nativePostMessage({
      type: "result",
      runId,
      ok,
      stdout: outBuf.value(),
      stderr: errBuf.value(),
      resultText,
      durationMs: Math.max(1, Math.round(performance.now() - startTime)),
      charts: [],
    });
  }

  self.addEventListener("message", async (event) => {
    const payload = event.data;
    if (!payload || payload.type !== "execute") return;
    const { runId, language, code, files } = payload;

    try {
      if (language === "javascript") {
        await executeJavaScript(runId, String(code || ""));
      } else {
        await executePython(runId, String(code || ""), files);
      }
    } catch (err) {
      nativePostMessage({
        type: "result",
        runId,
        ok: false,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        resultText: "",
        durationMs: 1,
        charts: [],
      });
    }
  });
})();
