// Starts TutorAI Local for the E2E suite: a temp config + data folder, a fake `claude`, and a mock
// OpenAI (sign-in + Responses). Runs the built binary when TUTORAI_BIN is set (CI), otherwise the
// source. Writes e2e-local/.state.json so tests can get one-time open links.
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startMockOpenAI } from "../apps/local/test/mock-openai.ts";

export const PORT = 4399;
const here = fileURLToPath(new URL(".", import.meta.url));

const root = mkdtempSync(join(tmpdir(), "tutorai-e2e-"));
const config = join(root, "config");
const data = join(root, "data");
const claudeState = join(root, "claude-state");
mkdirSync(config, { recursive: true });
mkdirSync(data, { recursive: true });
mkdirSync(claudeState, { recursive: true });
writeFileSync(join(config, "settings.json"), JSON.stringify({ dataDir: data }));
writeFileSync(join(claudeState, "scenario"), "ok");

// The fake CLI, signed out at first.
const fake = join(root, "bin", process.platform === "win32" ? "claude.cmd" : "claude");
mkdirSync(join(root, "bin"), { recursive: true });
const fakeScript = fileURLToPath(new URL("../apps/local/test/fake-claude.mjs", import.meta.url));
writeFileSync(fake, `#!/bin/sh\nexec "${process.execPath}" "${fakeScript}" "$@"\n`);
chmodSync(fake, 0o755);

const mock = await startMockOpenAI();
const env = {
  ...process.env,
  TUTORAI_TEST: "1",
  TUTORAI_CONFIG_DIR: config,
  TUTORAI_OPENAI_AUTH_BASE: mock.base,
  TUTORAI_OPENAI_API_BASE: mock.api,
  // Windows supports only the native claude.exe; the fake is a shell script, so leave Claude "not installed" there.
  ...(process.platform === "win32" ? {} : { TUTORAI_CLAUDE_PATH: fake }),
  CLAUDE_CONFIG_DIR: claudeState,
  TUTORAI_LOG_STDERR: "1",
};
writeFileSync(join(here, ".state.json"), JSON.stringify({ config, data, mock: mock.base, port: PORT }));

const bin = process.env.TUTORAI_BIN;
const child = bin
  ? spawn(bin, ["serve", "--port", String(PORT), "--strict-port"], { env, stdio: "inherit" })
  : spawn(process.execPath, ["--import", "tsx", join(here, "..", "apps", "local", "src", "main.ts"), "serve", "--port", String(PORT), "--strict-port"], { env, stdio: "inherit" });
const stop = () => {
  child.kill();
  void mock.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => {
  void mock.close();
  process.exit(code ?? 0);
});
