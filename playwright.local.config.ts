import { defineConfig, devices } from "@playwright/test";

/**
 * E2E for TutorAI Local: the app served by the local server, with a fake Claude Code CLI and a
 * mock OpenAI. CI runs it against the built binary (TUTORAI_BIN). Needs the web build in apps/web/dist.
 */
export default defineConfig({
  testDir: "e2e-local",
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: "http://127.0.0.1:4399", locale: "he-IL", trace: "retain-on-failure" },
  webServer: {
    command: "node --import tsx e2e-local/start.ts",
    url: "http://127.0.0.1:4399/index.html",
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
});
