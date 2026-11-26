import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, chmod, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_CLAUDE_CODE_MODELS, Settings, type SettingsPatch } from "@tutorai/local-api";
import { defaultDataDir, paths } from "./paths.ts";

/**
 * Atomic write (temp file + rename) with owner-only permissions.
 * POSIX: mode 0600. Windows: an ACL for the current user only (best effort).
 */
export async function writePrivate(file: string, data: string | Uint8Array) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${randomBytes(4).toString("hex")}`;
  await writeFile(tmp, data, { mode: 0o600 });
  await renameWithRetry(tmp, file);
  if (process.platform === "win32") await restrictToUser(file);
  else await chmod(file, 0o600);
}

/** Windows sync clients and antivirus briefly hold handles, so rename may fail with EPERM/EBUSY. */
export async function renameWithRetry(from: string, to: string, tries = 5) {
  for (let i = 0; ; i++) {
    try {
      return await rename(from, to);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i >= tries - 1 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw e;
      await new Promise((r) => setTimeout(r, 50 * (i + 1)));
    }
  }
}

function restrictToUser(file: string) {
  return new Promise<void>((resolve) => {
    const user = process.env.USERNAME;
    if (!user) return resolve();
    execFile("icacls", [file, "/inheritance:r", "/grant:r", `${user}:F`], { windowsHide: true }, () => resolve());
  });
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export function defaultSettings(): Settings {
  return {
    models: { "claude-code": { ...DEFAULT_CLAUDE_CODE_MODELS }, chatgpt: { fast: "", smart: "" } },
    dataDir: defaultDataDir(),
    autoUpdate: true,
    claudeCodeEnabled: true,
    chatgptWelcomeShown: false,
  };
}

let cache: Settings | null = null;
let writing: Promise<void> = Promise.resolve();

export async function loadSettings(): Promise<Settings> {
  if (cache) return cache;
  const raw = await readJson<unknown>(paths().settings);
  const base = defaultSettings();
  const parsed = Settings.partial().safeParse(raw ?? {});
  const s = parsed.success ? parsed.data : {};
  cache = {
    ...base,
    ...s,
    models: { "claude-code": { ...base.models["claude-code"], ...s.models?.["claude-code"] }, chatgpt: { ...base.models.chatgpt, ...s.models?.chatgpt } },
  };
  return cache;
}

export async function saveSettings(patch: SettingsPatch): Promise<Settings> {
  const cur = await loadSettings();
  const next: Settings = {
    ...cur,
    ...patch,
    models: { "claude-code": { ...cur.models["claude-code"], ...patch.models?.["claude-code"] }, chatgpt: { ...cur.models.chatgpt, ...patch.models?.chatgpt } },
  };
  cache = next;
  // Serialize writes so two quick saves can't interleave.
  writing = writing.then(() => writePrivate(paths().settings, JSON.stringify(next, null, 2))).catch(() => {});
  await writing;
  return next;
}

/** For tests. */
export function resetSettingsCache() {
  cache = null;
}

/** A stable, opaque id for this computer's install (OpenAI's ext_agent_host_id). Not a credential. */
export async function hostId(): Promise<string> {
  const file = paths().hostId;
  try {
    const v = (await readFile(file, "utf8")).trim();
    if (/^urn:uuid:[0-9a-f-]{36}$/.test(v)) return v;
  } catch {
    /* create below */
  }
  const id = `urn:uuid:${randomUUID()}`;
  await writePrivate(file, id);
  return id;
}

/** The key that signs session cookies; kept on disk so a restart doesn't sign the open tab out. */
export async function sessionKey(): Promise<Buffer> {
  const file = paths().sessionKey;
  try {
    const v = await readFile(file);
    if (v.length === 32) return v;
  } catch {
    /* create below */
  }
  const key = randomBytes(32);
  await writePrivate(file, key);
  return key;
}

export interface RunInfo {
  pid: number;
  port: number;
  controlSecret: string;
  version: string;
}
export const readRun = () => readJson<RunInfo>(paths().run);
export const writeRun = (r: RunInfo) => writePrivate(paths().run, JSON.stringify(r));
