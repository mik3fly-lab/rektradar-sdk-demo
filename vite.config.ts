import { defineConfig } from "vite";

// Plain Vite SPA. The SDK talks to https://api.rektradar.io directly from the
// browser (the /v1 API sends CORS headers), so no dev proxy is needed.
export default defineConfig({
  build: {
    target: "es2022",
    rollupOptions: {
      onwarn(warning, warn) {
        // The SDK's verifyWebhook is server-only and references node:crypto. It
        // is never called in the browser, so the "externalized for browser"
        // notice is harmless - silence it to keep the build output clean.
        const m = warning.message || "";
        if (m.includes("node:crypto") || m.includes("__vite-browser-external")) return;
        warn(warning);
      },
    },
  },
});
