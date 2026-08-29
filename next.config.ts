import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // CORS for the native counting app (a bundled webview on its own
        // origin). Wildcard is safe because the app authenticates with a
        // bearer token, never a cookie — browsers refuse to attach
        // ambient credentials under `*`, so the web app's cookie session
        // cannot be ridden cross-site. lib/cors.ts carries the fuller
        // rationale and the OPTIONS handlers.
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" },
          { key: "Access-Control-Max-Age", value: "86400" },
        ],
      },
    ];
  },
};

export default nextConfig;
