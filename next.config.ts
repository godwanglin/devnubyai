import type { NextConfig } from "next";

const PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/";

// The code sandbox worker runs model-written code on our origin. Its CSP only
// lets it load Pyodide; same-origin import() and any other network egress are blocked.
const SANDBOX_WORKER_CSP = [
  "default-src 'none'",
  `script-src ${PYODIDE_CDN} 'unsafe-eval' 'wasm-unsafe-eval'`,
  `connect-src ${PYODIDE_CDN}`,
].join("; ");

// Baseline hardening for every route. A full CSP needs nonces for the inline
// theme script, so it is not set globally here.
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]
    : []),
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      {
        source: "/workers/wasm-sandbox.worker.js",
        headers: [{ key: "Content-Security-Policy", value: SANDBOX_WORKER_CSP }],
      },
    ];
  },
  // Allow LAN/dev-tunnel access to the dev server (fixes HMR websocket failures).
  allowedDevOrigins: [
    "localhost",
    "localhost:3000",
    "127.0.0.1",
    "127.0.0.1:3000",
    "192.168.18.217",
    "192.168.18.217:3000",
    "*.trycloudflare.com",
  ],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
