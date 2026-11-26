import { dirname, delimiter } from "node:path";

/**
 * The Claude Code child's whole environment, built from an allowlist (as Rakazo does).
 * API keys, tokens and every other secret stay out, so the CLI can only use the sign-in
 * the student made with `claude auth login`, and usage always goes to the student's plan.
 * ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN are never passed.
 */
const ALLOW = [
  "PATH", "Path", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LANGUAGE",
  "TMPDIR", "TEMP", "TMP",
  "SystemRoot", "SYSTEMROOT", "windir", "ComSpec", "PATHEXT",
  "APPDATA", "LOCALAPPDATA", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
  "ProgramFiles", "ProgramFiles(x86)", "ProgramData",
  "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_GIT_BASH_PATH",
  "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy",
  "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS",
];

/** Documented settings: no auto-update in our runs, no memory/CLAUDE.md, no compaction, no telemetry. */
export const BRIDGE_ENV = {
  DISABLE_AUTOUPDATER: "1",
  DISABLE_AUTO_COMPACT: "1",
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
  DISABLE_TELEMETRY: "1",
} as const;

export function claudeEnv(claudePath: string, source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined) continue;
    if (ALLOW.includes(k) || k.startsWith("LC_")) env[k] = v;
  }
  // The CLI's own folder first, so a CLI launched from an icon finds its helpers.
  const pathKey = "PATH" in env ? "PATH" : "Path" in env ? "Path" : "PATH";
  env[pathKey] = [dirname(claudePath), env[pathKey]].filter(Boolean).join(delimiter);
  return { ...env, ...BRIDGE_ENV };
}
