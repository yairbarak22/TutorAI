import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "plugins/**/*.test.ts", "apps/web/src/platform/**/*.test.ts", "apps/web/src/moodle/**/*.test.ts", ".github/scripts/**/*.test.ts", "apps/local/test/**/*.test.ts"],
    environment: "node",
  },
});
