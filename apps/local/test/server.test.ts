import { request } from "node:http";
import { mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LLMEvent } from "@tutorai/local-api";
import { serve, type Running } from "../src/lifecycle.ts";
import { readRun } from "../src/config.ts";
import { Security } from "../src/http/security.ts";
import { DataFolder, PathError, lexicalInside } from "../src/fs/folder.ts";
import { redact } from "../src/log.ts";
import { allowed } from "../src/net.ts";
import type { Services } from "../src/providers/types.ts";
import { tempEnv } from "./helpers.ts";

/* A raw HTTP client: fetch() won't let us set Host, Origin or Sec-Fetch-Site freely. */
function http(port: number, path: string, opts: { method?: string; headers?: Record<string, string>; body?: string | Buffer } = {}) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }>((resolve, reject) => {
    const r = request({ host: "127.0.0.1", port, path, method: opts.method ?? "GET", headers: { host: `127.0.0.1:${port}`, ...opts.headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on("error", reject);
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

const stubServices = (): Services => ({
  settings: async () => ({}) as never,
  claudeCode: {
    provider: {
      async call(req, emit) {
        emit({ type: "delta", text: "שלום" });
        emit({ type: "result", text: `echo:${req.prompt}`, model: "plan:x", usage: { input: 1, output: 1, cacheRead: 0 } });
      },
    },
    status: async () => ({ installed: true, versionOk: true, loggedIn: true }),
    install: async (emit) => emit({ type: "done", ok: true }),
    login: async () => ({ started: true, manualCommand: "claude auth login" }),
    logout: async () => {},
  },
  chatgpt: {
    provider: { async call(_r, emit) { emit({ type: "error", kind: "auth", message: "sign in" }); } },
    status: async () => ({ signedIn: false }),
    start: async (redirect) => `https://auth.openai.com/api/accounts/authorize?redirect_uri=${encodeURIComponent(redirect)}`,
    callback: async () => ({ ok: true, message: "ok" }),
    logout: async () => ({ revoked: true }),
  },
});

let running: Running;
let env: ReturnType<typeof tempEnv>;
let cookie: string;
let origin: string;

beforeEach(async () => {
  env = tempEnv();
  running = await serve({ port: 4500 + Math.floor(Math.random() * 400), services: stubServices() });
  origin = `http://127.0.0.1:${running.port}`;
  const code = running.security.issueCode();
  const r = await http(running.port, `/open?code=${code}`);
  expect(r.status).toBe(302);
  expect(r.headers.location).toBe(`/#tutorai-token=${running.security.apiToken}`);
  cookie = String(r.headers["set-cookie"]).split(";")[0];
});
afterEach(async () => {
  await running.close();
});

const api = (path: string, o: { method?: string; headers?: Record<string, string>; body?: string | Buffer } = {}) =>
  http(running.port, path, { ...o, headers: { cookie, "sec-fetch-site": "same-origin", "x-tutorai": running.security.apiToken, ...(o.method && o.method !== "GET" && o.method !== "HEAD" ? { origin } : {}), ...o.headers } });

describe("localhost security", () => {
  it("writes run.json with the port and a control secret", async () => {
    const run = await readRun();
    expect(run).toMatchObject({ pid: process.pid, port: running.port });
    expect(run!.controlSecret.length).toBeGreaterThan(30);
  });

  it("serves the app with a session from a one-time code, and the code can't be reused", async () => {
    expect((await api("/api/hello")).status).toBe(200);
    const code = running.security.issueCode();
    expect((await http(running.port, `/open?code=${code}`)).status).toBe(302);
    expect((await http(running.port, `/open?code=${code}`)).status).toBe(403);
    expect((await http(running.port, `/open?code=forged`)).status).toBe(403);
  });

  it("rejects requests without the session cookie or with a forged one", async () => {
    const tok = { "x-tutorai": running.security.apiToken, "sec-fetch-site": "same-origin" };
    expect((await http(running.port, "/api/hello", { headers: tok })).status).toBe(401);
    expect((await http(running.port, "/api/hello", { headers: { ...tok, cookie: "tutorai_session=1.abc" } })).status).toBe(401);
    const other = new Security(Buffer.alloc(32, 7), running.port);
    const foreign = other.newSessionCookie().split(";")[0];
    expect((await http(running.port, "/api/hello", { headers: { ...tok, cookie: foreign } })).status).toBe(401);
  });

  it("rejects other origins, including other ports on 127.0.0.1 (same-site)", async () => {
    expect((await api("/api/hello", { headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await api("/api/hello", { headers: { origin: "http://127.0.0.1:9999" } })).status).toBe(403);
    expect((await api("/api/hello", { headers: { "sec-fetch-site": "same-site" } })).status).toBe(403);
    expect((await api("/api/hello", { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
  });

  it("requires the API token on every request, even with a valid cookie", async () => {
    // e.g. another server on 127.0.0.1 that received our cookie (cookies ignore ports)
    expect((await http(running.port, "/api/heartbeat", { method: "POST", headers: { cookie, origin } })).status).toBe(403);
    expect((await http(running.port, "/api/hello", { headers: { cookie } })).status).toBe(403);
    expect((await api("/api/hello", { headers: { "x-tutorai": "1" } })).status).toBe(403);
    expect((await api("/api/heartbeat", { method: "POST" })).status).toBe(204);
  });

  it("blocks DNS rebinding and redirects localhost to 127.0.0.1", async () => {
    expect((await http(running.port, "/api/hello", { headers: { host: `evil.example:${running.port}` } })).status).toBe(421);
    const r = await http(running.port, "/x", { headers: { host: `localhost:${running.port}` } });
    expect(r.status).toBe(308);
    expect(r.headers.location).toBe(`${origin}/x`);
  });

  it("control routes need the secret and no Origin", async () => {
    expect((await http(running.port, "/control/code", { method: "POST" })).status).toBe(401);
    const auth = { authorization: `Bearer ${running.security.controlSecret}` };
    expect((await http(running.port, "/control/code", { method: "POST", headers: { ...auth, origin } })).status).toBe(403);
    const r = await http(running.port, "/control/code?nonce=n1", { method: "POST", headers: auth });
    const body = JSON.parse(r.body.toString());
    expect(body.code).toBeTruthy();
    expect(body.proof).toBe(running.security.proof("n1"));
  });

  it("sends protective headers", async () => {
    const r = await api("/api/hello");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["cross-origin-resource-policy"]).toBe("same-origin");
  });

  it("session cookies survive a restart (same key on disk) and expire after 30 days", () => {
    const key = Buffer.alloc(32, 1);
    let now = Date.parse("2026-11-26T10:00:00Z");
    const a = new Security(key, 4317, () => now);
    const c = a.newSessionCookie().split(";")[0];
    const b = new Security(key, 4317, () => now);
    expect(b.validSession(c)).toBe(true);
    now += 31 * 24 * 3600 * 1000;
    expect(b.validSession(c)).toBe(false);
  });
});

describe("data folder API", () => {
  it("writes, reads, checks and removes files inside the data folder", async () => {
    const body = Buffer.from("SQLite format 3\0");
    expect((await api("/api/fs/file?path=tutorai.db", { method: "PUT", body })).status).toBe(204);
    expect(readFileSync(join(env.data, "tutorai.db"))).toEqual(body);
    expect((await api("/api/fs/file?path=tutorai.db")).body).toEqual(body);
    expect((await api("/api/fs/file?path=tutorai.db", { method: "HEAD" })).status).toBe(200);
    expect((await api("/api/fs/file?path=courses/1/a.pdf", { method: "PUT", body: "x" })).status).toBe(204);
    expect((await api("/api/fs/file?path=courses/1/a.pdf", { method: "DELETE" })).status).toBe(204);
    expect((await api("/api/fs/file?path=courses/1/a.pdf", { method: "HEAD" })).status).toBe(404);
    expect((await api("/api/fs/file?path=missing")).status).toBe(404);
  });

  it("refuses paths outside the folder", async () => {
    for (const p of ["../x", "/etc/passwd", "a/../../x", "C:\\\\x", "%2e%2e/x"]) {
      const r = await api(`/api/fs/file?path=${encodeURIComponent(p)}`);
      expect([400, 404]).toContain(r.status);
      expect(r.status).not.toBe(200);
    }
  });

  it("refuses to follow a symlink out of the folder", async () => {
    if (process.platform === "win32") return;
    mkdirSync(join(env.root, "outside"));
    writeFileSync(join(env.root, "outside", "secret"), "s");
    symlinkSync(join(env.root, "outside"), join(env.data, "link"));
    expect((await api("/api/fs/file?path=link/secret")).status).toBe(400);
    expect((await api("/api/fs/file?path=link/new", { method: "PUT", body: "x" })).status).toBe(400);
  });

  it("reports the folder", async () => {
    const r = JSON.parse((await api("/api/fs/folder")).body.toString());
    expect(r.path).toBe(env.data);
  });
});

describe("model calls and settings", () => {
  it("streams NDJSON events from the provider", async () => {
    const r = await api("/api/llm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "claude-code", tier: "fast", prompt: "hi" }) });
    expect(r.headers["content-type"]).toBe("application/x-ndjson");
    const events = r.body.toString().trim().split("\n").map((l) => JSON.parse(l) as LLMEvent);
    expect(events.map((e) => e.type)).toEqual(["delta", "result"]);
    expect(events[1]).toMatchObject({ text: "echo:hi" });
  });

  it("rejects malformed model requests", async () => {
    expect((await api("/api/llm", { method: "POST", body: JSON.stringify({ provider: "evil" }) })).status).toBe(400);
  });

  it("saves settings but never the data folder through /api/settings", async () => {
    const r = await api("/api/settings", { method: "PUT", body: JSON.stringify({ provider: "chatgpt", dataDir: "/tmp/elsewhere" }) });
    const s = JSON.parse(r.body.toString());
    expect(s.provider).toBe("chatgpt");
    expect(s.dataDir).toBe(env.data);
  });

  it("only allows a local model server on this computer", async () => {
    expect((await api("/api/settings", { method: "PUT", body: JSON.stringify({ localModelBase: "http://evil.example:11434" }) })).status).toBe(400);
    expect((await api("/api/settings", { method: "PUT", body: JSON.stringify({ localModelBase: `http://127.0.0.1:${running.port}` }) })).status).toBe(400);
    expect((await api("/api/settings", { method: "PUT", body: JSON.stringify({ localModelBase: "http://localhost:11434" }) })).status).toBe(200);
  });

  it("starts ChatGPT sign-in with the loopback callback on 127.0.0.1", async () => {
    const r = JSON.parse((await api("/api/connections/chatgpt/start", { method: "POST" })).body.toString());
    expect(new URL(r.authorizeUrl).searchParams.get("redirect_uri")).toBe(`${origin}/auth/callback`);
  });
});

describe("helpers", () => {
  it("rejects bad paths lexically", () => {
    expect(() => lexicalInside("/d", "../x")).toThrow(PathError);
    expect(() => lexicalInside("/d", "")).toThrow(PathError);
    expect(lexicalInside("/d", "a/b")).toBe(join("/d", "a", "b"));
  });

  it("writes atomically (no temp files left)", async () => {
    const e = tempEnv();
    const f = new DataFolder(e.data);
    await f.write("x/y.bin", new Uint8Array([1, 2, 3]));
    await f.write("x/y.bin", new Uint8Array([4]));
    expect(readFileSync(join(e.data, "x", "y.bin"))).toEqual(Buffer.from([4]));
    expect(statSync(join(e.data, "x")).isDirectory()).toBe(true);
  });

  it("redacts secrets in logs", () => {
    const line = redact('Bearer abc.def refresh_token="rt-1" eyJhbGciOi.eyJzdWIi.sig sk-ant-api03-xyz code=12345');
    for (const secret of ["abc.def", "rt-1", "eyJhbGciOi", "sk-ant-api03-xyz", "12345"]) expect(line).not.toContain(secret);
  });

  it("allows outbound requests only to known hosts", () => {
    expect(allowed("https://api.openai.com/v1/responses")).toBe(true);
    expect(allowed("https://auth.openai.com/x")).toBe(true);
    expect(allowed("http://localhost:11434/api/tags")).toBe(true);
    expect(allowed("https://evil.example/")).toBe(false);
    expect(allowed("http://api.openai.com/")).toBe(false);
  });
});
