import { spawn } from "node:child_process";
import { readFile, realpath, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { LINK_ARGUMENT, MAX_LINK_LENGTH } from "@tutorai/moodle";
import { loadSettings, readRun } from "./config.ts";
import { control, ensureRunning, openBrowser, serve, stopRunning, VERSION, isSea } from "./lifecycle.ts";
import { createHandler } from "./moodle/handler/index.ts";
import { listConnections } from "./moodle/tokens.ts";
import { configDir, installedBinary, launchers, paths } from "./paths.ts";
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
    `Moodle:       ${(await listConnections()).length} connection(s)`,
  ];
  console.log(lines.join("\n"));
}

/**
 * `tutorai moodle-link --config <dir> <link>` (macOS: `--from-file <path>` instead of the link).
 * Run by the temporary sign-in handler, never by a person. It passes one well-formed link to the
 * running server and does nothing else: no output, exit 0, whatever it was given
 * (docs/rfc-moodle.md §6.3). The link's content is checked by the server against the passport.
 */
async function moodleLink(args: string[]) {
  try {
    // Only the first --config counts, and only one more argument (or --from-file <path>) may follow.
    if (args[0] !== "--config" || !args[1]) return;
    process.env.TUTORAI_CONFIG_DIR = args[1];
    const rest = args.slice(2);
    let link: string;
    if (rest[0] === "--from-file") {
      if (process.platform !== "darwin" || rest.length !== 2) return;
      const inbox = await realpath(paths().moodleInbox);
      // The file must sit directly in this config's inbox (compared by real location).
      if ((await realpath(dirname(resolve(rest[1]))).catch(() => "")) !== inbox) return;
      const file = join(inbox, basename(rest[1]));
      const info = await stat(file).catch(() => null);
      const text = info && info.isFile() && info.size <= MAX_LINK_LENGTH + 64 ? await readFile(file, "utf8").catch(() => "") : "";
      await rm(file, { force: true });
      link = text.trim();
    } else {
      if (rest.length !== 1) return;
      link = rest[0];
    }
    if (link.length > MAX_LINK_LENGTH || !LINK_ARGUMENT.test(link)) return;
    const run = await readRun();
    if (run) await control(run, "/control/moodle-link", 15_000, { link });
  } catch {
    /* silent by design */
  }
}

async function uninstall() {
  await stopRunning();
  // A Moodle sign-in handler left behind by an interrupted sign-in.
  await createHandler({ command: [] }).cleanup().catch(() => {});
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
    case "moodle-link":
      return moodleLink(rest);
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
