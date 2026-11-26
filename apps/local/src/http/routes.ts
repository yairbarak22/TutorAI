import type { IncomingMessage, ServerResponse } from "node:http";
import {
  CSRF_HEADER,
  LLMRequest,
  LocalProxyRequest,
  SettingsPatch,
  type Hello,
  type InstallEvent,
  type LLMEvent,
  type UpdateStatus,
} from "@tutorai/local-api";
import { z } from "zod";
import { loadSettings, resetSettingsCache, saveSettings, writePrivate } from "../config.ts";
import { paths } from "../paths.ts";
import { rm } from "node:fs/promises";
import { DataFolder, PathError, browse, prepareFolder } from "../fs/folder.ts";
import { log } from "../log.ts";
import type { Semaphore, Services } from "../providers/types.ts";
import { HttpError, json, ndjson, readBody, readJson, send, type Route } from "./server.ts";
import { BASE_HEADERS, type Security } from "./security.ts";

export interface Updater {
  status(): Promise<UpdateStatus>;
  restart(): Promise<void>;
}

export interface AppContext {
  version: string;
  security: Security;
  services: Services;
  semaphore: Semaphore;
  updater: Updater;
  /** Counts work that must keep the server alive (model calls, installs). */
  busy: { inc(): void; dec(): void };
  quit(): void;
  /** For tests: the local model proxy's fetch. */
  fetch?: typeof fetch;
}

let folder: DataFolder | null = null;
async function dataFolder() {
  const s = await loadSettings();
  if (!folder || folder.root !== s.dataDir) folder = new DataFolder(s.dataDir);
  return folder;
}

const relPath = (url: URL) => {
  const p = url.searchParams.get("path");
  if (!p) throw new HttpError(400, "path is required");
  return p;
};

const fsError = (e: unknown) => {
  if (e instanceof PathError) throw new HttpError(400, e.message);
  throw e;
};

function abortOnClose(req: IncomingMessage, res: ServerResponse) {
  const ctrl = new AbortController();
  // "close" on the response fires when the client goes away before we finished (tab closed/reloaded).
  res.on("close", () => {
    if (!res.writableFinished) ctrl.abort();
  });
  req.on("aborted", () => ctrl.abort());
  return ctrl;
}

const page = (title: string, body: string) => `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f8fafc;color:#0f172a}main{max-width:460px;padding:32px;text-align:center}p{color:#475569}</style></head>
<body><main>${body}</main></body></html>`;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function buildRoutes(ctx: AppContext): Route[] {
  const { security, services } = ctx;
  return [
    /* ---------- session ---------- */
    {
      method: "GET",
      path: "/open",
      kind: "public",
      handler: (_req, res, url) => {
        if (!security.redeemCode(url.searchParams.get("code")))
          return send(
            res,
            403,
            page("TutorAI", `<h1>TutorAI</h1><p>הקישור הזה כבר לא תקף. פתחו את TutorAI מהסמל שלו.</p><p dir="ltr">This link has expired. Open TutorAI from its icon.</p>`),
            { "Content-Type": "text/html; charset=utf-8" },
          );
        // The API token travels in the fragment: browsers never send it to any server.
        send(res, 302, "", { Location: `/#tutorai-token=${security.apiToken}`, "Set-Cookie": security.newSessionCookie() });
      },
    },
    {
      method: "POST",
      path: "/control/code",
      kind: "control",
      handler: (_q, res, url) => json(res, 200, { code: security.issueCode(), proof: security.proof(url.searchParams.get("nonce") ?? "") }),
    },
    {
      method: "POST",
      path: "/control/quit",
      kind: "control",
      handler: (_q, res) => {
        res.on("finish", () => ctx.quit());
        send(res, 204);
      },
    },

    /* ---------- tests only: back to a fresh install (keeps the data folder setting) ---------- */
    ...(process.env.TUTORAI_TEST === "1"
      ? [
          {
            method: "POST",
            path: "/control/test-reset",
            kind: "control" as const,
            handler: async (_q: IncomingMessage, res: ServerResponse) => {
              const { dataDir } = await loadSettings();
              await writePrivate(paths().settings, JSON.stringify({ dataDir }));
              resetSettingsCache();
              await rm(paths().chatgpt, { recursive: true, force: true });
              send(res, 204);
            },
          },
        ]
      : []),

    /* ---------- basics ---------- */
    {
      method: "GET",
      path: "/api/hello",
      kind: "api",
      handler: async (_q, res) => {
        const s = await loadSettings();
        const hello: Hello = {
          app: "tutorai-local",
          version: ctx.version,
          platform: process.platform,
          arch: process.arch,
          dataDir: s.dataDir,
          features: { claudeCode: s.claudeCodeEnabled, chatgpt: true },
        };
        json(res, 200, hello);
      },
    },
    { method: "POST", path: "/api/heartbeat", kind: "api", handler: (_q, res) => send(res, 204) },
    {
      method: "POST",
      path: "/api/quit",
      kind: "api",
      handler: (_q, res) => {
        res.on("finish", () => ctx.quit());
        send(res, 204);
      },
    },

    /* ---------- data folder ---------- */
    {
      method: ["GET", "HEAD"],
      path: "/api/fs/file",
      kind: "api",
      handler: async (req, res, url) => {
        const f = await dataFolder();
        if (req.method === "HEAD") {
          const ok = await f.exists(relPath(url)).catch(fsError);
          return send(res, ok ? 200 : 404);
        }
        const data = await f.read(relPath(url)).catch(fsError);
        if (!data) return json(res, 404, { error: "Not found" });
        send(res, 200, data, { "Content-Type": "application/octet-stream" });
      },
    },
    {
      method: "PUT",
      path: "/api/fs/file",
      kind: "api",
      handler: async (req, res, url) => {
        const f = await dataFolder();
        const path = relPath(url);
        const body = await readBody(req);
        await f.write(path, body).catch(fsError);
        send(res, 204);
      },
    },
    {
      method: "DELETE",
      path: "/api/fs/file",
      kind: "api",
      handler: async (_q, res, url) => {
        await (await dataFolder()).remove(relPath(url)).catch(fsError);
        send(res, 204);
      },
    },
    {
      method: "GET",
      path: "/api/fs/folder",
      kind: "api",
      handler: async (_q, res) => {
        const f = await dataFolder();
        await f.ensure();
        json(res, 200, { path: f.root, label: f.label });
      },
    },
    {
      method: "PUT",
      path: "/api/fs/folder",
      kind: "api",
      handler: async (req, res) => {
        const { path } = z.object({ path: z.string().min(1) }).parse(await readJson(req));
        const abs = await prepareFolder(path).catch(fsError);
        await saveSettings({ dataDir: abs });
        const f = await dataFolder();
        json(res, 200, { path: f.root, label: f.label });
      },
    },
    {
      method: "GET",
      path: "/api/fs/browse",
      kind: "api",
      handler: async (_q, res, url) => {
        const out = await browse(url.searchParams.get("path") ?? undefined).catch(fsError);
        json(res, 200, out);
      },
    },

    /* ---------- models ---------- */
    {
      method: "POST",
      path: "/api/llm",
      kind: "api",
      handler: async (req, res) => {
        const parsed = LLMRequest.safeParse(await readJson(req));
        if (!parsed.success) return json(res, 400, { error: "Invalid request" });
        const request = parsed.data;
        const settings = await loadSettings();
        if (request.provider === "claude-code" && !settings.claudeCodeEnabled) return json(res, 403, { error: "Claude Code is turned off" });
        const ctrl = abortOnClose(req, res);
        const write = ndjson(res);
        let done = false;
        const emit = (e: LLMEvent) => {
          if (done) return;
          if (e.type !== "delta") done = true;
          write(e);
        };
        ctx.busy.inc();
        let release: (() => void) | null = null;
        try {
          release = await ctx.semaphore.acquire(ctrl.signal);
          const provider = request.provider === "claude-code" ? services.claudeCode.provider : services.chatgpt.provider;
          await provider.call(request, emit, ctrl.signal);
          if (!done) emit({ type: "error", kind: "other", message: "The model ended without an answer." });
        } catch (e) {
          if (!ctrl.signal.aborted) {
            log("error", `llm call failed: ${e instanceof Error ? e.message : String(e)}`);
            emit({ type: "error", kind: "other", message: e instanceof Error ? e.message : String(e) });
          }
        } finally {
          release?.();
          ctx.busy.dec();
          res.end();
        }
      },
    },

    /* ---------- connections ---------- */
    {
      method: "GET",
      path: "/api/connections",
      kind: "api",
      handler: async (_q, res, url) => {
        const fresh = url.searchParams.get("fresh") === "1";
        // One provider's problem must not hide the other's status.
        const [claudeCode, chatgpt] = await Promise.all([
          services.claudeCode.status(fresh).catch((e) => {
            log("warn", `claude code status: ${(e as Error).message}`);
            return { installed: false, versionOk: false, loggedIn: false };
          }),
          services.chatgpt.status().catch(() => ({ signedIn: false })),
        ]);
        json(res, 200, { claudeCode, chatgpt });
      },
    },
    {
      method: "POST",
      path: "/api/connections/claude-code/install",
      kind: "api",
      handler: async (req, res) => {
        const { consent } = z.object({ consent: z.literal(true) }).parse(await readJson(req));
        void consent;
        const ctrl = abortOnClose(req, res);
        const write = ndjson(res);
        ctx.busy.inc();
        try {
          await services.claudeCode.install((e: InstallEvent) => write(e), ctrl.signal);
        } catch (e) {
          write({ type: "done", ok: false, error: e instanceof Error ? e.message : String(e) });
        } finally {
          ctx.busy.dec();
          res.end();
        }
      },
    },
    { method: "POST", path: "/api/connections/claude-code/login", kind: "api", handler: async (_q, res) => json(res, 200, await services.claudeCode.login()) },
    {
      method: "POST",
      path: "/api/connections/claude-code/logout",
      kind: "api",
      handler: async (_q, res) => {
        await services.claudeCode.logout();
        send(res, 204);
      },
    },
    {
      method: "POST",
      path: "/api/connections/chatgpt/start",
      kind: "api",
      handler: async (_q, res) => json(res, 200, { authorizeUrl: await services.chatgpt.start(`${security.origin}/auth/callback`) }),
    },
    {
      method: "GET",
      path: "/auth/callback",
      kind: "public",
      handler: async (_q, res, url) => {
        const r = await services.chatgpt.callback(url.searchParams);
        const body = r.ok
          ? `<h1>✓</h1><p>${escapeHtml(r.message)}</p><script>setTimeout(()=>{try{window.close()}catch(e){}},1500)</script>`
          : `<h1>TutorAI</h1><p>${escapeHtml(r.message)}</p>`;
        send(res, r.ok ? 200 : 400, page("TutorAI", body), {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
        });
      },
    },
    { method: "POST", path: "/api/connections/chatgpt/logout", kind: "api", handler: async (_q, res) => json(res, 200, await services.chatgpt.logout()) },

    /* ---------- settings ---------- */
    { method: "GET", path: "/api/settings", kind: "api", handler: async (_q, res) => json(res, 200, await loadSettings()) },
    {
      method: "PUT",
      path: "/api/settings",
      kind: "api",
      handler: async (req, res) => {
        const patch = SettingsPatch.parse(await readJson(req));
        // The data folder changes only through PUT /api/fs/folder (validated there).
        delete patch.dataDir;
        if (patch.localModelBase !== undefined && patch.localModelBase !== "") {
          let u: URL;
          try {
            u = new URL(patch.localModelBase);
          } catch {
            throw new HttpError(400, "Not a valid address");
          }
          const okHost = u.hostname === "localhost" || u.hostname === "127.0.0.1";
          if (u.protocol !== "http:" || !okHost || Number(u.port || 80) === security.port) throw new HttpError(400, "The model server must be on this computer");
        }
        json(res, 200, await saveSettings(patch));
      },
    },

    /* ---------- updates ---------- */
    { method: "GET", path: "/api/update", kind: "api", handler: async (_q, res) => json(res, 200, await ctx.updater.status()) },
    {
      method: "POST",
      path: "/api/update/restart",
      kind: "api",
      handler: async (_q, res) => {
        res.on("finish", () => void ctx.updater.restart());
        send(res, 204);
      },
    },

    /* ---------- local model proxy (Ollama / LM Studio without CORS setup) ---------- */
    {
      method: "POST",
      path: "/api/local-proxy",
      kind: "api",
      handler: async (req, res) => {
        const p = LocalProxyRequest.parse(await readJson(req));
        const base = (await loadSettings()).localModelBase;
        if (!base) throw new HttpError(400, "No local model server is configured");
        const target = new URL(p.path, base);
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(p.headers ?? {})) {
          const key = k.toLowerCase();
          if (["cookie", "authorization", "origin", "host", "referer", CSRF_HEADER].includes(key)) continue;
          headers[key] = v;
        }
        const ctrl = abortOnClose(req, res);
        let upstream: Response;
        try {
          upstream = await (ctx.fetch ?? fetch)(target, { method: p.method, headers, body: p.method === "POST" ? p.body : undefined, signal: ctrl.signal });
        } catch {
          throw new HttpError(502, `The local model server at ${base} isn't answering. Is Ollama / LM Studio running?`);
        }
        res.writeHead(upstream.status, { ...BASE_HEADERS, "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream", "Cache-Control": "no-store" });
        if (upstream.body) for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk);
        res.end();
      },
    },
  ];
}
