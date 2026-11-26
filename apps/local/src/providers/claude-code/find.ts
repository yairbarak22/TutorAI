import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/** The oldest Claude Code whose print-mode flags we rely on (Rakazo needs the same; final value from the spike). */
export const MIN_CLAUDE_CODE_VERSION = "2.1.280";

export interface Found {
  path: string;
  version: string | null;
}

const isWin = () => process.platform === "win32";

/** Known install folders first: an app opened from an icon gets a minimal PATH on macOS. */
export function candidatePaths(home = homedir(), env = process.env): string[] {
  if (isWin()) {
    return [
      join(env.USERPROFILE || home, ".local", "bin", "claude.exe"),
      join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "Programs", "claude", "claude.exe"),
    ];
  }
  return [
    join(home, ".local", "bin", "claude"),
    join(home, ".claude", "local", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    join(home, ".npm-global", "bin", "claude"),
    join(home, ".bun", "bin", "claude"),
  ];
}

async function executable(p: string) {
  try {
    await access(p, isWin() ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Windows: only the native claude.exe. An npm claude.cmd can't take a multi-line prompt through cmd.exe. */
async function onPath(env = process.env): Promise<{ exe: string | null; cmdOnly: boolean }> {
  let cmdOnly = false;
  for (const dir of (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean)) {
    if (isWin()) {
      if (await executable(join(dir, "claude.exe"))) return { exe: join(dir, "claude.exe"), cmdOnly: false };
      if (await executable(join(dir, "claude.cmd"))) cmdOnly = true;
    } else if (await executable(join(dir, "claude"))) return { exe: join(dir, "claude"), cmdOnly: false };
  }
  return { exe: null, cmdOnly };
}

function run(file: string, args: string[], timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, env }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}

/** Custom setups (nvm, asdf, …): ask the login shell. */
async function fromLoginShell(): Promise<string | null> {
  if (isWin()) return null;
  const shell = process.env.SHELL || "/bin/zsh";
  const out = await run(shell, ["-lic", "command -v claude"], 5000);
  const line = out?.trim().split("\n").pop()?.trim();
  return line && line.startsWith("/") && (await executable(line)) ? line : null;
}

export async function version(path: string): Promise<string | null> {
  const out = await run(path, ["--version"], 15_000);
  return out?.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
}

export function versionAtLeast(v: string | null, min = MIN_CLAUDE_CODE_VERSION) {
  if (!v) return false;
  const a = v.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
}

export interface FindResult {
  found: Found | null;
  /** Windows: only an npm claude.cmd was found. */
  cmdOnly: boolean;
}

export async function findClaude(opts: { home?: string; env?: NodeJS.ProcessEnv; loginShell?: boolean } = {}): Promise<FindResult> {
  const env = opts.env ?? process.env;
  if (env.TUTORAI_CLAUDE_PATH && (await executable(env.TUTORAI_CLAUDE_PATH))) {
    return { found: { path: env.TUTORAI_CLAUDE_PATH, version: await version(env.TUTORAI_CLAUDE_PATH) }, cmdOnly: false };
  }
  for (const p of candidatePaths(opts.home, env)) if (await executable(p)) return { found: { path: p, version: await version(p) }, cmdOnly: false };
  const path = await onPath(env);
  if (path.exe) return { found: { path: path.exe, version: await version(path.exe) }, cmdOnly: false };
  const shell = opts.loginShell === false ? null : await fromLoginShell();
  if (shell) return { found: { path: shell, version: await version(shell) }, cmdOnly: false };
  return { found: null, cmdOnly: path.cmdOnly };
}

/** Claude Code on Windows needs Git for Windows (bash). True when it's missing. */
export async function needsGitBash(env = process.env): Promise<boolean> {
  if (!isWin()) return false;
  if (env.CLAUDE_CODE_GIT_BASH_PATH && (await executable(env.CLAUDE_CODE_GIT_BASH_PATH))) return false;
  const roots = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs")].filter(Boolean) as string[];
  for (const r of roots) if (await executable(join(r, "Git", "bin", "bash.exe"))) return false;
  return true;
}
