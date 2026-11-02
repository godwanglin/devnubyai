import http from "node:http";
import { captureCodeForState, failCodeForState } from "./sessions";

/**
 * Optional auto-capture for PKCE redirects (xAI 127.0.0.1:56121/callback,
 * OpenAI localhost:1455/auth/callback). Only works when the admin's browser runs
 * on the same machine as this server; otherwise the redirect page fails to load
 * and the admin pastes the URL/code. One listener per port, pinned on globalThis
 * so HMR reloads don't try to bind a port twice.
 */
interface LoopbackEntry {
  server: http.Server | null;
  starting: Promise<boolean> | null;
}

const globalLoopback = globalThis as unknown as {
  __oauthLoopbacks?: Map<number, LoopbackEntry>;
};
const listeners = (globalLoopback.__oauthLoopbacks ??= new Map<number, LoopbackEntry>());

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function page(title: string, body: string, color: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:system-ui,sans-serif;padding:32px;background:#18181b;color:#fafafa">
<h2 style="color:${color}">${title}</h2>${body}</body></html>`;
}

function createHandler(port: number, callbackPath: string) {
  return (req: http.IncomingMessage, res: http.ServerResponse): void => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (url.pathname !== callbackPath) {
      res.writeHead(404).end("Not Found");
      return;
    }

    const code = url.searchParams.get("code");
    const stateParam = url.searchParams.get("state") ?? "";
    const error = url.searchParams.get("error");

    if (error) {
      const desc = url.searchParams.get("error_description") || error;
      failCodeForState(stateParam, desc);
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(page("Authorization failed", `<p>${escapeHtml(desc)}</p><p>You can close this window.</p>`, "#f43f5e"));
      return;
    }

    if (code && captureCodeForState(stateParam, code)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        page(
          "Authorization successful",
          "<p>You can close this window and return to Devnuby AI.</p><script>setTimeout(()=>window.close(),1200)</script>",
          "#10b981"
        )
      );
      return;
    }

    // Unknown/expired state: show the code so the admin can still paste it manually
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      page(
        "Authorization code",
        `<p>Paste this code into the Devnuby AI popup:</p><pre style="background:#27272a;padding:12px;border-radius:6px;word-break:break-all;white-space:pre-wrap">${escapeHtml(code ?? "")}</pre>`,
        "#fafafa"
      )
    );
  };
}

/**
 * Bind the loopback port once (all interfaces on the loopback host, so both
 * "localhost" and "127.0.0.1" redirects work); resolves false when the port is unavailable.
 */
export function ensureLoopbackServer(port: number, callbackPath: string, host = "127.0.0.1"): Promise<boolean> {
  const entry = listeners.get(port) ?? { server: null, starting: null };
  listeners.set(port, entry);

  if (entry.server?.listening) return Promise.resolve(true);
  if (entry.starting) return entry.starting;

  entry.starting = new Promise<boolean>((resolve) => {
    const server = http.createServer(createHandler(port, callbackPath));
    server.once("error", () => {
      entry.server = null;
      entry.starting = null;
      resolve(false);
    });
    server.listen(port, host, () => {
      entry.server = server;
      entry.starting = null;
      // Don't keep the process alive just for this listener
      server.unref();
      resolve(true);
    });
  });
  return entry.starting;
}
