import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "plugins/**/*.test.ts"],
    environment: "node",
  },
});
