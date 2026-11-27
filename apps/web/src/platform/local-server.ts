import {
  Browse,
  ChatgptStart,
  CSRF_HEADER,
  Connections,
  Folder,
  Hello,
  InstallEvent,
  LLMEvent,
  LoginStarted,
  Logout,
  Settings,
  UpdateStatus,
  type LLMRequest,
  type SettingsPatch,
} from "@tutorai/local-api";
import type { z } from "zod";

/**
 * TutorAI Local: when this page is served by the local server on 127.0.0.1, the server adds
 * Claude/ChatGPT plan connections and stores files in a real folder. On the website
 * (GitHub Pages) none of this is used and no request is made.
 */

let hello: Hello | null = null;
let needsOpen = false;

/**
 * The API token arrives once, in the /open redirect's URL fragment (never sent to a server), and is
 * kept in this origin's storage, which other servers on 127.0.0.1 (other ports) can't read.
 */
const TOKEN_KEY = "tutorai.localToken";
let token: string | null = null;
(function captureToken() {
  if (typeof location === "undefined") return;
  const m = location.hash.match(/^#tutorai-token=([\w-]+)$/);
  try {
    if (m) {
      localStorage.setItem(TOKEN_KEY, m[1]);
      history.replaceState(null, "", `${location.pathname}${location.search}#/`);
    }
    token = localStorage.getItem(TOKEN_KEY);
  } catch {
    token = m?.[1] ?? null;
  }
})();

/** Served by TutorAI Local, but this tab wasn't opened from the TutorAI icon (no valid session). */
export const localNeedsOpen = () => needsOpen;

/** Set once at startup by detectLocalServer(). */
export const localServer = () => hello;

const servedLocally = () => {
  if (typeof location === "undefined") return false;
  const local = location.hostname === "127.0.0.1" || location.hostname === "localhost";
  // Vite dev (5173) and preview (4173) serve the plain web app.
  return local && location.port !== "5173" && location.port !== "4173";
};

export async function detectLocalServer(): Promise<Hello | null> {
  if (!servedLocally()) return null;
  try {
    const r = await fetch("/api/hello", { credentials: "same-origin", headers: { [CSRF_HEADER]: token ?? "" }, signal: AbortSignal.timeout(8000) });
    // Served from 127.0.0.1 by TutorAI Local but not usable (no session, or the server stopped while a
    // cached copy of the page opened): ask to open TutorAI from its icon.
    if (!r.ok) needsOpen = true;
    if (!r.ok) return null;
    const p = Hello.safeParse(await r.json());
    hello = p.success ? p.data : null;
  } catch {
    hello = null;
    needsOpen = true;
  }
  if (hello) startHeartbeat();
  return hello;
}

/* ---------------- low-level ---------------- */

export class LocalApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** A stable code from the server (e.g. a Moodle error kind) that the page turns into words. */
    public kind?: string,
  ) {
    super(message);
  }
}

export async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(CSRF_HEADER, token ?? "");
  const r = await fetch(path, { ...init, headers, credentials: "same-origin" });
  if (!r.ok && r.status !== 404) {
    let msg = `${r.status}`;
    let kind: string | undefined;
    try {
      const body = (await r.clone().json()) as { error?: string; kind?: string };
      msg = body.error ?? msg;
      kind = body.kind;
    } catch {
      /* not json */
    }
    throw new LocalApiError(r.status, msg, kind);
  }
  return r;
}

export async function getJson<S extends z.ZodType>(schema: S, path: string, init?: RequestInit): Promise<z.infer<S>> {
  const r = await call(path, init);
  if (r.status === 404) throw new LocalApiError(404, "Not found");
  return schema.parse(await r.json());
}

export const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** Reads a newline-delimited JSON stream. */
export async function* ndjson<S extends z.ZodType>(schema: S, r: Response): AsyncGenerator<z.infer<S>> {
  if (!r.body) return;
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += value;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) yield schema.parse(JSON.parse(line));
    }
    if (done) break;
  }
  if (buf.trim()) yield schema.parse(JSON.parse(buf));
}

/* ---------------- heartbeat (keeps the server alive while a tab is open) ---------------- */

let beating = false;
function startHeartbeat() {
  if (beating) return;
  beating = true;
  const beat = () => void call("/api/heartbeat", { method: "POST" }).catch(() => {});
  setInterval(beat, 30_000);
}

/* ---------------- typed API ---------------- */

export const localApi = {
  settings: () => getJson(Settings, "/api/settings"),
  saveSettings: (patch: SettingsPatch) => getJson(Settings, "/api/settings", jsonInit("PUT", patch)),
  connections: (fresh = false) => getJson(Connections, `/api/connections${fresh ? "?fresh=1" : ""}`),

  async installClaudeCode(onEvent: (e: z.infer<typeof InstallEvent>) => void) {
    const r = await call("/api/connections/claude-code/install", jsonInit("POST", { consent: true }));
    for await (const e of ndjson(InstallEvent, r)) onEvent(e);
  },
  claudeLogin: () => getJson(LoginStarted, "/api/connections/claude-code/login", { method: "POST" }),
  claudeLogout: () => call("/api/connections/claude-code/logout", { method: "POST" }),
  chatgptStart: () => getJson(ChatgptStart, "/api/connections/chatgpt/start", { method: "POST" }),
  chatgptLogout: () => getJson(Logout, "/api/connections/chatgpt/logout", { method: "POST" }),

  folder: () => getJson(Folder, "/api/fs/folder"),
  setFolder: (path: string) => getJson(Folder, "/api/fs/folder", jsonInit("PUT", { path })),
  browse: (path?: string) => getJson(Browse, `/api/fs/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`),

  update: () => getJson(UpdateStatus, "/api/update"),
  /** True once the server answers again (after a restart). */
  ping: async () => {
    try {
      return (await call("/api/hello")).ok;
    } catch {
      return false;
    }
  },
  restart: () => call("/api/update/restart", { method: "POST" }),
  quit: () => call("/api/quit", { method: "POST" }),

  /** One model call; yields deltas and ends with one result or error event. */
  async *llm(req: LLMRequest): AsyncGenerator<LLMEvent> {
    const r = await call("/api/llm", jsonInit("POST", req));
    yield* ndjson(LLMEvent, r);
  },

  /** fetch() replacement for local model servers: goes through the server, so no CORS setup is needed. */
  proxyFetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    return call(
      "/api/local-proxy",
      jsonInit("POST", {
        path: url.pathname + url.search,
        method: (init?.method ?? "GET").toUpperCase(),
        headers,
        body: typeof init?.body === "string" ? init.body : undefined,
      }),
    );
  }) as typeof fetch,

  /* files (ServerFileStore) */
  readFile: async (path: string) => {
    const r = await call(`/api/fs/file?path=${encodeURIComponent(path)}`);
    if (r.status === 404) throw new LocalApiError(404, `Not found: ${path}`);
    return new Uint8Array(await r.arrayBuffer());
  },
  fileExists: async (path: string) => (await call(`/api/fs/file?path=${encodeURIComponent(path)}`, { method: "HEAD" })).status === 200,
  writeFile: async (path: string, data: Uint8Array | Blob) => {
    const body = data instanceof Blob ? data : new Blob([data as BlobPart]);
    // keepalive lets small writes (the lock file on pagehide) finish as the tab closes; it caps bodies at 64 KB.
    await call(`/api/fs/file?path=${encodeURIComponent(path)}`, { method: "PUT", body, keepalive: body.size <= 60 * 1024 });
  },
  removeFile: async (path: string) => void (await call(`/api/fs/file?path=${encodeURIComponent(path)}`, { method: "DELETE" })),
};
