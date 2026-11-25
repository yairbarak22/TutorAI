import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Relative base: the same build works at /, /RuecAI_Tutor/ and /pr-preview/pr-12/.
  base: "./",
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "RuecAI Teacher",
        short_name: "RuecAI",
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
