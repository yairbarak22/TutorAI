import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { z } from "zod";
import type { Connections, InstallEvent } from "@tutorai/local-api";
import { loadSettings } from "../../config.ts";
import { log } from "../../log.ts";
import type { ClaudeCodeService, Provider } from "../types.ts";
import { claudeEnv } from "./env.ts";
import { findClaude, needsGitBash, versionAtLeast, type FindResult } from "./find.ts";
import { runClaude } from "./run.ts";

/** Anthropic's official installers, run unmodified after the student agrees (RFC §5.2). */
export function installCommand(platform = process.platform): { file: string; args: string[]; display: string } {
  if (platform === "win32")
    return {
      file: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "irm https://claude.ai/install.ps1 | iex"],
      display: "irm https://claude.ai/install.ps1 | iex",
    };
  return { file: "/bin/bash", args: ["-c", "curl -fsSL https://claude.ai/install.sh | bash"], display: "curl -fsSL https://claude.ai/install.sh | bash" };
}

const AuthStatus = z.object({ loggedIn: z.boolean(), authMethod: z.string().optional() }).passthrough();

const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const CACHE_MS = 30_000;

export interface ClaudeCodeOptions {
  /** Overrides for tests. */
  find?: () => Promise<FindResult>;
  install?: { file: string; args: string[] };
  env?: NodeJS.ProcessEnv;
}

export function createClaudeCode(opts: ClaudeCodeOptions = {}): ClaudeCodeService {
  let cached: { at: number; value: FindResult } | null = null;
  let loginProc: ChildProcess | null = null;

  const find = async (fresh = false) => {
    if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.value;
    const value = await (opts.find ?? (() => findClaude({ env: opts.env })))();
    cached = { at: Date.now(), value };
    return value;
  };

  const exec = (path: string, args: string[], timeoutMs = 20_000) =>
    new Promise<{ ok: boolean; stdout: string }>((resolve) => {
      try {
        execFile(path, args, { timeout: timeoutMs, windowsHide: true, env: claudeEnv(path, opts.env) }, (err, stdout) =>
          resolve({ ok: !err, stdout: String(stdout ?? "") }),
        );
      } catch {
        resolve({ ok: false, stdout: "" }); // e.g. EINVAL for a .cmd on Windows
      }
    });

  const authStatus = async (path: string) => {
    const r = await exec(path, ["auth", "status", "--json"]);
    try {
      return AuthStatus.parse(JSON.parse(r.stdout));
    } catch {
      return { loggedIn: false as const, authMethod: undefined };
    }
  };

  const provider: Provider = {
    async call(req, emit, signal) {
      const { found } = await find();
      if (!found) return emit({ type: "error", kind: "not_installed", message: "Claude Code is not installed." });
      const settings = await loadSettings();
      const model = settings.models["claude-code"][req.tier];
      await runClaude(req, emit, { claudePath: found.path, model, signal, env: opts.env });
    },
  };

  return {
    provider,

    async status(fresh = false): Promise<Connections["claudeCode"]> {
      const { found, cmdOnly } = await find(fresh);
      const gitBash = await needsGitBash(opts.env);
      if (!found)
        return {
          installed: false,
          versionOk: false,
          loggedIn: false,
          ...(gitBash ? { needsGitBash: true } : {}),
          ...(cmdOnly ? { hint: "reinstall-official" } : {}),
        };
      const auth = await authStatus(found.path);
      return {
        installed: true,
        path: found.path,
        version: found.version ?? undefined,
        versionOk: versionAtLeast(found.version),
        loggedIn: auth.loggedIn,
        authMethod: auth.authMethod,
        ...(gitBash ? { needsGitBash: true } : {}),
      };
    },

    async install(emit: (e: InstallEvent) => void, signal: AbortSignal) {
      if (await needsGitBash(opts.env)) {
        emit({ type: "done", ok: false, error: "git-for-windows" });
        return;
      }
      const cmd = opts.install ?? installCommand();
      log("info", `installing Claude Code: ${cmd.file} ${cmd.args.join(" ")}`);
      await new Promise<void>((resolve) => {
        const child = spawn(cmd.file, cmd.args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: { ...process.env, ...opts.env } });
        const timer = setTimeout(() => child.kill(), INSTALL_TIMEOUT_MS);
        const onAbort = () => child.kill();
        signal.addEventListener("abort", onAbort, { once: true });
        for (const stream of [child.stdout, child.stderr]) {
          createInterface({ input: stream }).on("line", (line) => {
            // Installer output may contain colors; strip ANSI codes for the page.
            const clean = line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trimEnd();
            if (clean) emit({ type: "log", line: clean });
          });
        }
        child.on("error", (e) => {
          clearTimeout(timer);
          emit({ type: "done", ok: false, error: e.message });
          resolve();
        });
        child.on("close", async (code) => {
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          const { found } = await find(true);
          emit(found ? { type: "done", ok: true } : { type: "done", ok: false, error: code === 0 ? "installed-but-not-found" : `exit ${code}` });
          resolve();
        });
      });
    },

    async login() {
      const manualCommand = "claude auth login";
      const { found } = await find(true);
      if (!found) return { started: false, manualCommand };
      if (loginProc && loginProc.exitCode === null) return { started: true, manualCommand };
      // The CLI opens Anthropic's own sign-in page; TutorAI never sees the credentials.
      try {
        loginProc = spawn(found.path, ["auth", "login", "--claudeai"], {
          stdio: "ignore",
          windowsHide: true,
          env: claudeEnv(found.path, opts.env),
          detached: process.platform !== "win32",
        });
      } catch {
        return { started: false, manualCommand };
      }
      loginProc.on("error", () => (loginProc = null));
      loginProc.on("close", () => {
        loginProc = null;
        cached = null;
      });
      // Don't wait for it: the page polls /api/connections; a stuck login dies with the 10-minute timer.
      const p = loginProc;
      setTimeout(() => p.exitCode === null && p.kill(), 10 * 60 * 1000).unref();
      return { started: true, manualCommand };
    },

    async logout() {
      const { found } = await find(true);
      if (found) await exec(found.path, ["auth", "logout"]);
    },
  };
}
