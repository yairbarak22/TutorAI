import { spawn } from "node:child_process";
import { rm, stat } from "node:fs/promises";
import { loadSettings, readRun } from "./config.ts";
import { ensureRunning, openBrowser, serve, stopRunning, VERSION, isSea } from "./lifecycle.ts";
import { configDir, installedBinary, launchers } from "./paths.ts";
import { findClaude, versionAtLeast } from "./providers/claude-code/find.ts";
import { activeClientId, readCredential } from "./providers/chatgpt/tokens.ts";
import { ChatgptOAuth } from "./providers/chatgpt/oauth.ts";
import { installNetPolicy } from "./net.ts";

const HELP = `TutorAI ${VERSION}

  tutorai             Open TutorAI in your browser (starts it if needed)
  tutorai stop        Stop TutorAI
  tutorai doctor      Show diagnostics (for support)
  tutorai uninstall   Remove TutorAI from this computer (your data folder is kept)
  tutorai --version
`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function doctor() {
  const s = await loadSettings();
  const run = await readRun();
  const claude = await findClaude();
  const chatId = await activeClientId();
  const chat = chatId ? await readCredential(chatId) : null;
  const lines = [
    `TutorAI ${VERSION} (${isSea() ? "binary" : "source"}) on ${process.platform}-${process.arch}, Node ${process.versions.node}`,
    `Config:       ${configDir()}`,
    `Data folder:  ${s.dataDir}`,
    `Server:       ${run ? `pid ${run.pid}, port ${run.port}` : "not running"}`,
    `Claude Code:  ${claude.found ? `${claude.found.path} ${claude.found.version ?? "?"}${versionAtLeast(claude.found.version) ? "" : " (too old)"}` : claude.cmdOnly ? "only an npm claude.cmd (reinstall with the official installer)" : "not found"}`,
    `ChatGPT:      ${chat?.access_token ? "signed in" : chatId ? "registered, signed out" : "not connected"}`,
  ];
  console.log(lines.join("\n"));
}

async function uninstall() {
  await stopRunning();
  // Sign out of ChatGPT properly (revokes the refresh token) before deleting the files.
  await new ChatgptOAuth().logout().catch(() => {});
  const s = await loadSettings().catch(() => null);
  for (const l of launchers()) await rm(l, { recursive: true, force: true }).catch(() => {});
  await rm(configDir(), { recursive: true, force: true }).catch(() => {});
  const bin = installedBinary();
  const exists = await stat(bin).then(() => true, () => false);
  if (exists) {
    if (process.platform === "win32") {
      // A running .exe can't delete itself: remove it right after we exit.
      spawn("cmd.exe", ["/d", "/c", `timeout /t 2 /nobreak >nul & del /f /q "${bin}"`], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    } else await rm(bin, { force: true });
  }
  console.log("TutorAI was removed from this computer.");
  if (s) console.log(`Your data folder was kept: ${s.dataDir}`);
}

async function main(argv: string[]) {
  const [cmd = "open", ...rest] = argv;
  switch (cmd) {
    case "open": {
      const url = await ensureRunning();
      if (rest.includes("--print-url")) console.log(url);
      else openBrowser(url);
      return;
    }
    case "serve": {
      const port = flag(rest, "--port");
      await serve({ port: port ? Number(port) : undefined, strictPort: rest.includes("--strict-port") });
      return; // keeps running
    }
    case "stop":
      console.log((await stopRunning()) ? "TutorAI stopped." : "TutorAI wasn't running.");
      return;
    case "doctor":
      return doctor();
    case "uninstall":
      installNetPolicy();
      return uninstall();
    case "--version":
    case "-v":
    case "version":
      console.log(VERSION);
      return;
    default:
      console.log(HELP);
  }
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
