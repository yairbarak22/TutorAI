import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { widgetKit } from "./widget-kit-plugin.ts";

/**
 * Security policy for the production page (defense in depth for the API key).
 * The browser blocks the app's data requests (fetch, XHR, beacon, WebSocket), images, fonts, media
 * and form posts to any address except this site, Anthropic's API, a model server on this computer,
 * and the Pyodide runtime. Scripts are not restricted: model-written widgets run inline in a
 * sandboxed srcdoc iframe, which inherits this policy. Dev builds skip it (Vite's dev client needs more).
 */
export const NETWORK_POLICY = [
  "connect-src 'self' https://api.anthropic.com http://localhost:* http://127.0.0.1:* https://cdn.jsdelivr.net/pyodide/ blob: data:",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'self'",
].join("; ");

function networkPolicy(): Plugin {
  return {
    name: "tutorai-network-policy",
    apply: "build",
    transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: NETWORK_POLICY }, injectTo: "head-prepend" }],
  };
}

export default defineConfig({
  // Relative base: the same build works at / and /TutorAI/.
  base: "./",
  plugins: [
    react(),
    networkPolicy(),
    widgetKit(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "TutorAI",
        short_name: "TutorAI",
        description: "עוזר לימודים מבוסס AI — החומרים נשארים אצלכם",
        lang: "he",
        dir: "rtl",
        theme_color: "#1e3a5f",
        background_color: "#f8fafc",
        display: "standalone",
        start_url: "./",
        scope: "./",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,wasm,mjs}"],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
      },
    }),
  ],
  worker: { format: "es" },
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
  server: { port: 5173 },
});
