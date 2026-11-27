import { execFile, spawn } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { open as openFile, readFile } from "node:fs/promises";
import { rm } from "node:fs/promises";
import type { Server } from "node:http";
import { DEFAULT_PORT } from "@tutorai/local-api";
import { loadSettings, readRun, sessionKey, writeRun, type RunInfo } from "./config.ts";
import { DataFolder } from "./fs/folder.ts";
import { buildRoutes, type AppContext } from "./http/routes.ts";
import { Security } from "./http/security.ts";
import { createHttpServer, listen } from "./http/server.ts";
import { StaticFiles } from "./http/static.ts";
import { log } from "./log.ts";
import { installNetPolicy } from "./net.ts";
import { paths } from "./paths.ts";
import { createChatgpt } from "./providers/chatgpt/index.ts";
import { createClaudeCode } from "./providers/claude-code/index.ts";
import { killAllChildren } from "./providers/claude-code/run.ts";
import { Semaphore, type Services } from "./providers/types.ts";
import { Updater, cleanupOld } from "./update/index.ts";

declare const __TUTORAI_VERSION__: string | undefined;
export const VERSION = typeof __TUTORAI_VERSION__ === "string" ? __TUTORAI_VERSION__ : "0.1.0-dev";

/** Stop after this long with no open TutorAI tab and nothing running (closing the browser is enough). */
export const IDLE_EXIT_MS = Number(process.env.TUTORAI_IDLE_MS) || 15 * 60 * 1000;

/** True inside the single binary (then process.execPath is the binary itself). */
export function isSea(): boolean {
  try {
    const sea = (process as unknown as { getBuiltinModule?: (n: string) => { isSea(): boolean } | undefined }).getBuiltinModule?.("node:sea");
    return !!sea?.isSea();
  } catch {
    return false;
  }
}

/** How to start this program again (binary, or node + script from a source checkout). */
export function selfCommand(binary = process.execPath): { file: string; args: string[] } {
  if (isSea()) return { file: binary, args: [] };
  return { file: process.execPath, args: [...process.execArgv, process.argv[1]] };
}

export interface ServeOptions {
  port?: number;
  strictPort?: boolean;
  services?: Services;
}

export interface Running {
  server: Server;
  port: number;
  security: Security;
  close(): Promise<void>;
}

const pidAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** One server per user: an exclusive lock file holding our pid (stale locks of dead processes are taken over). */
async function takeLock(): Promise<() => Promise<void>> {
  const file = `${paths().dir}/serve.lock`;
  await import("node:fs/promises").then((f) => f.mkdir(paths().dir, { recursive: true, mode: 0o700 }));
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const h = await openFile(file, "wx", 0o600);
      await h.writeFile(String(process.pid));
      await h.close();
      return async () => {
        const owner = Number(await readFile(file, "utf8").catch(() => "0"));
        if (owner === process.pid) await rm(file, { force: true });
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const owner = Number(await readFile(file, "utf8").catch(() => "0"));
      if (owner && owner !== process.pid && pidAlive(owner)) throw new Error("TutorAI is already running");
      await rm(file, { force: true });
    }
  }
  throw new Error("Couldn't take the TutorAI lock");
}

export async function serve(opts: ServeOptions = {}): Promise<Running> {
  installNetPolicy();
  const unlock = opts.services ? async () => {} : await takeLock();

  const security = new Security(await sessionKey(), opts.port ?? DEFAULT_PORT);
  const services: Services = opts.services ?? { claudeCode: createClaudeCode(), chatgpt: createChatgpt(), settings: loadSettings };
  let busy = 0;
  let lastActivity = Date.now();
  let server!: Server;

  /** Stops accepting, ends open streams (model calls, installs) and kills CLI children, with a 3 s cap. */
  const closeServer = async () => {
    killAllChildren();
    const closed = new Promise<void>((r) => server.close(() => r()));
    server.closeAllConnections?.();
    await Promise.race([closed, new Promise((r) => setTimeout(r, 3000))]);
  };

  const shutdown = async (code = 0) => {
    log("info", "shutting down");
    updater.stop();
    clearInterval(watchdog);
    await closeServer();
    const run = await readRun();
    if (run?.pid === process.pid) await rm(paths().run, { force: true });
    await unlock();
    if (!opts.services) process.exit(code);
  };

  const relaunch = async (binary: string) => {
    // Free the port and the lock first; the new process waits for the port (--strict-port).
    await closeServer();
    await unlock();
    const cmd = selfCommand(binary);
    const child = spawn(cmd.file, [...cmd.args, "serve", "--port", String(port), "--strict-port"], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    process.exit(0);
  };

  const binary = isSea() ? process.execPath : null;
  await cleanupOld(binary);
  const updater = new Updater({ current: VERSION, binary, relaunch });

  const ctx: AppContext = {
    version: VERSION,
    security,
    services,
    semaphore: new Semaphore(2),
    updater,
    busy: { inc: () => busy++, dec: () => busy-- },
    quit: () => void shutdown(0),
  };
  server = createHttpServer({ security, routes: buildRoutes(ctx), statics: new StaticFiles(), onActivity: () => (lastActivity = Date.now()) });
  const port = await listen(server, opts.port ?? DEFAULT_PORT, { strict: opts.strictPort });
  security.port = port;

  const settings = await loadSettings();
  await new DataFolder(settings.dataDir).ensure().catch((e) => log("warn", `data folder: ${(e as Error).message}`));
  await writeRun({ pid: process.pid, port, controlSecret: security.controlSecret, version: VERSION });
  log("info", `TutorAI ${VERSION} listening on 127.0.0.1:${port}`);

  const watchdog = setInterval(() => {
    if (busy === 0 && Date.now() - lastActivity > IDLE_EXIT_MS) void shutdown(0);
  }, Math.min(60_000, IDLE_EXIT_MS / 2));
  watchdog.unref();
  if (!opts.services) {
    process.on("SIGINT", () => void shutdown(0));
    process.on("SIGTERM", () => void shutdown(0));
    updater.start();
  }

  return {
    server,
    port,
    security,
    close: async () => {
      updater.stop();
      clearInterval(watchdog);
      await closeServer();
      const run = await readRun();
      if (run?.pid === process.pid) await rm(paths().run, { force: true });
      await unlock();
    },
  };
}

/* ---------------- launcher side ---------------- */

async function control(run: RunInfo, path: string, timeoutMs = 2000): Promise<Response | null> {
  if (!pidAlive(run.pid)) return null;
  try {
    return await fetch(`http://127.0.0.1:${run.port}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${run.controlSecret}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
}

/**
 * A one-time code from the running server, after it proves it knows run.json's secret (so a stale
 * run.json plus some other program on the port can't hand the browser to the wrong server).
 */
async function codeFrom(run: RunInfo): Promise<string | null> {
  const nonce = randomBytes(16).toString("base64url");
  const r = await control(run, `/control/code?nonce=${nonce}`);
  if (!r?.ok) return null;
  const body = (await r.json().catch(() => ({}))) as { code?: string; proof?: string };
  const want = Buffer.from(createHmac("sha256", run.controlSecret).update(`tutorai-control:${nonce}`).digest("base64url"));
  const got = Buffer.from(body.proof ?? "");
  if (!body.code || want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return body.code;
}

export async function alive(run: RunInfo): Promise<boolean> {
  return (await codeFrom(run)) !== null;
}

/** Starts the server in the background (if needed) and returns a one-time sign-in URL. */
export async function ensureRunning(): Promise<string> {
  let run = await readRun();
  let code = run ? await codeFrom(run) : null;
  if (!code) {
    const cmd = selfCommand();
    const child = spawn(cmd.file, [...cmd.args, "serve"], { detached: true, stdio: "ignore", windowsHide: true, env: process.env });
    child.unref();
    const until = Date.now() + 15_000;
    while (!code && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 200));
      run = await readRun();
      if (run && run.pid === child.pid) code = await codeFrom(run);
    }
    if (!code || !run) throw new Error("TutorAI didn't start. Run `tutorai doctor` and look at ~/.tutorai/logs/tutorai.log");
  }
  return `http://127.0.0.1:${run!.port}/open?code=${encodeURIComponent(code)}`;
}

export function openBrowser(url: string) {
  // No shell: the URL is passed as one argument.
  if (process.platform === "darwin") execFile("open", [url]);
  else if (process.platform === "win32") execFile("rundll32", ["url.dll,FileProtocolHandler", url], { windowsHide: true });
  else execFile("xdg-open", [url]);
}

export async function stopRunning(): Promise<boolean> {
  const run = await readRun();
  if (!run) return false;
  const r = await control(run, "/control/quit");
  return !!r?.ok;
}
