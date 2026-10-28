import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
