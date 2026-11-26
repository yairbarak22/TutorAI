import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resetSettingsCache } from "../src/config.ts";

export const FAKE_CLAUDE = fileURLToPath(new URL("./fake-claude.mjs", import.meta.url));

/** A fresh config dir (TUTORAI_CONFIG_DIR) and data dir for one test. */
export function tempEnv() {
  const root = mkdtempSync(join(tmpdir(), "tutorai-test-"));
  const config = join(root, "config");
  const data = join(root, "data");
  mkdirSync(config, { recursive: true });
  mkdirSync(data, { recursive: true });
  process.env.TUTORAI_CONFIG_DIR = config;
  writeFileSync(join(config, "settings.json"), JSON.stringify({ dataDir: data }));
  resetSettingsCache();
  return { root, config, data };
}

/** Installs the fake CLI as an executable named `claude`; returns its path and its state dir. */
export function fakeClaude(root: string, scenario = "ok", loggedIn = true) {
  const bin = join(root, "bin");
  const state = join(root, "claude-state");
  mkdirSync(bin, { recursive: true });
  mkdirSync(state, { recursive: true });
  const path = join(bin, "claude");
  writeFileSync(path, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_CLAUDE}" "$@"\n`);
  chmodSync(path, 0o755);
  writeFileSync(join(state, "scenario"), scenario);
  if (loggedIn) writeFileSync(join(state, "logged-in"), "1");
  return {
    path,
    state,
    setScenario: (s: string) => writeFileSync(join(state, "scenario"), s),
    env: { PATH: process.env.PATH, HOME: process.env.HOME, CLAUDE_CONFIG_DIR: state, ANTHROPIC_API_KEY: "sk-ant-must-not-leak", SECRET_TOKEN: "x" } as NodeJS.ProcessEnv,
  };
}
