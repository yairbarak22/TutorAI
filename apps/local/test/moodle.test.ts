import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync, mkdirSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MoodleDownloadEvent, MoodleDownloadRequest } from "@tutorai/local-api";
import { MoodleError } from "@tutorai/moodle";
import { serve, type Running } from "../src/lifecycle.ts";
import { DataFolder, PathError, TooLargeError } from "../src/fs/folder.ts";
import { redact } from "../src/log.ts";
import { appleScript, embeddable } from "../src/moodle/handler/macos.ts";
import { createHandler, noHandler, type Handler } from "../src/moodle/handler/index.ts";
import { MoodleHttp, allowedUrl } from "../src/moodle/http.ts";
import { createMoodle, type MoodleService } from "../src/moodle/index.ts";
import { paths } from "../src/paths.ts";
import { tempEnv } from "./helpers.ts";
import { FAKE_PDF, startMockMoodle, type MockMoodle } from "./mock-moodle.ts";

let env: ReturnType<typeof tempEnv>;
let mock: MockMoodle;
let moodle: MoodleService;
let clock: number;
const sleeps: number[] = [];

/** A handler that only records what happened (no system change). */
function recordingHandler(auto = false): Handler & { installed: number; removed: number } {
  const h = {
    installed: 0,
    removed: 0,
    install: async () => (h.installed++, auto),
    remove: async () => void h.removed++,
    cleanup: async () => void h.removed++,
  };
  return h;
}

function service(handler: Handler = noHandler, fetchImpl?: typeof fetch) {
  return createMoodle({
    version: "9.9.9-test",
    handlerCommand: [],
    handler,
    fetch: fetchImpl,
    folder: async () => new DataFolder(env.data),
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
  });
}

beforeEach(async () => {
  env = tempEnv();
  mock = await startMockMoodle();
  process.env.TUTORAI_TEST = "1";
  process.env.TUTORAI_MOODLE_ALLOW_LOCAL = "1";
  process.env.TUTORAI_MOODLE_TEST_SITES = JSON.stringify([{ id: "mock", site: mock.base }]);
  clock = Date.parse("2026-11-27T10:00:00Z");
  sleeps.length = 0;
  moodle = service();
});
afterEach(async () => {
  await moodle.cleanup();
  await mock.close();
  delete process.env.TUTORAI_MOODLE_TEST_SITES;
  delete process.env.TUTORAI_MOODLE_ALLOW_LOCAL;
  delete process.env.TUTORAI_MOODLE;
});

/** Resolve, start a sign-in and return what the launch page would hand back. */
async function begin(m = moodle) {
  const { candidates } = await m.resolve("mock");
  const start = await m.start(candidates[0].site);
  const passport = new URL(start.launchUrl).searchParams.get("passport")!;
  return { site: candidates[0].site, start, passport };
}
async function connect(m = moodle) {
  const b = await begin(m);
  expect(await m.paste(b.start.pendingId, mock.launchLink(b.passport))).toEqual({ ok: true });
  return b.site;
}
async function download(req: Partial<MoodleDownloadRequest> & { site: string }, m = moodle, signal = new AbortController().signal) {
  const events: MoodleDownloadEvent[] = [];
  await m.download({ remoteCourseId: 101, key: "11:/lecture1.pdf", courseId: 3, knownHashes: [], ...req }, (e) => events.push(e), signal);
  return events;
}
const sourcesDir = () => join(env.data, "courses", "3", "sources");
const filesIn = (dir: string) => (existsSync(dir) ? readdirSync(dir) : []);

describe("finding the site", () => {
  it("lists the registry, with the test institution only in test mode", async () => {
    expect(moodle.institutions().institutions.map((i) => i.id)).toEqual(["runi", "mock"]);
    delete process.env.TUTORAI_MOODLE_ALLOW_LOCAL;
    expect(service().institutions().institutions.map((i) => i.id)).toEqual(["runi"]);
  });

  it("offers single sign-on for a site that reports itself correctly, identified honestly", async () => {
    const r = await moodle.resolve("mock");
    expect(r).toEqual({ candidates: [{ site: mock.base, host: `127.0.0.1:${mock.port}`, siteName: "Mock Moodle", institutionId: "mock", login: "sso" }] });
    expect(mock.requests[0]).toMatchObject({ method: "POST", path: "/lib/ajax/service-nologin.php" });
    expect(mock.requests[0].userAgent).toBe("TutorAI-Local/9.9.9-test (+https://github.com/yairbarak22/TutorAI)");
  });

  it("refuses a site that points somewhere else, and says why there is nothing to offer", async () => {
    mock.config = { wwwroot: "https://evil.example" };
    expect(await moodle.resolve("mock")).toEqual({ candidates: [], problem: "refused" });
    mock.config = { launchurl: "javascript:alert(1)" };
    expect(await moodle.resolve("mock")).toEqual({ candidates: [], problem: "refused" });
    mock.config = "<html>not a moodle</html>";
    expect(await moodle.resolve("mock")).toEqual({ candidates: [], problem: "not_moodle" });
    expect(await moodle.resolve("nowhere")).toEqual({ candidates: [], problem: "refused" });
    await mock.close();
    expect(await moodle.resolve("mock")).toEqual({ candidates: [], problem: "offline" });
    mock = await startMockMoodle();
  });

  it("explains a site that can't be connected", async () => {
    mock.config = { enablemobilewebservice: 0 };
    expect((await moodle.resolve("mock")).candidates[0]).toMatchObject({ login: "unavailable", reason: "mobile_off" });
    mock.config = { typeoflogin: 1 };
    expect((await moodle.resolve("mock")).candidates[0]).toMatchObject({ login: "unavailable", reason: "password_only" });
    mock.config = { maintenanceenabled: 1 };
    expect((await moodle.resolve("mock")).candidates[0]).toMatchObject({ login: "unavailable", reason: "maintenance" });
  });
});

describe("signing in", () => {
  it("starts only for a site it resolved itself", async () => {
    await expect(moodle.start(mock.base)).rejects.toMatchObject({ kind: "not_listed" });
    await expect(moodle.start("https://evil.example")).rejects.toMatchObject({ kind: "not_listed" });
    await moodle.resolve("mock");
    clock += 31 * 60_000; // the resolved list is short-lived
    await expect(moodle.start(mock.base)).rejects.toMatchObject({ kind: "not_listed" });
  });

  it("connects with the link from the launch page, and keeps the token to itself", async () => {
    const { start, passport, site } = await begin();
    expect(start.mode).toBe("manual");
    const launch = new URL(start.launchUrl);
    expect(launch.origin + launch.pathname).toBe(`${mock.base}/admin/tool/mobile/launch.php`);
    expect(Object.fromEntries(launch.searchParams)).toMatchObject({ service: "moodle_mobile_app", urlscheme: "moodlemobile", confirmed: "1" });
    expect(passport).toMatch(/^[a-f0-9]{32}$/);
    expect((await moodle.status()).pending).toMatchObject({ id: start.pendingId, state: "waiting", mode: "manual" });

    expect(await moodle.paste(start.pendingId, `some text ${mock.launchLink(passport)}/`)).toEqual({ ok: true });
    const status = await moodle.status();
    expect(status.pending).toBeNull();
    expect(status.connections).toEqual([{ site, host: `127.0.0.1:${mock.port}`, siteName: "Mock Moodle", institutionId: "mock", fullName: "סטודנט לדוגמה", connectedAt: new Date(clock).toISOString(), expired: false }]);
    expect(JSON.stringify(status)).not.toContain(mock.token);

    const file = join(paths().moodle, readdirSync(paths().moodle).find((n) => n.endsWith(".json"))!);
    expect(JSON.parse(readFileSync(file, "utf8")).token).toBe(mock.token);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    // The token went to Moodle in the request body, never in an address.
    expect(mock.requests.some((r) => r.query.includes(mock.token))).toBe(false);
  });

  it("ignores a link when no sign-in is waiting, and accepts none twice", async () => {
    await moodle.link(mock.launchLink("anything"));
    expect((await moodle.status()).connections).toEqual([]);
    const { start, passport } = await begin();
    await moodle.link(mock.launchLink(passport)); // the handler's route
    expect((await moodle.status()).connections).toHaveLength(1);
    expect(await moodle.paste(start.pendingId, mock.launchLink(passport))).toEqual({ ok: false, kind: "expired" });
  });

  it("drops a link without the right passport and keeps waiting", async () => {
    const { start, passport } = await begin();
    // What any web page could fire at the handler: a valid-looking link with someone else's token.
    expect(await moodle.paste(start.pendingId, mock.launchLink("not-the-passport", { token: "f".repeat(32) }))).toEqual({ ok: false, kind: "wrong_site" });
    await moodle.link(mock.launchLink("guess"));
    expect((await moodle.status()).pending?.state).toBe("waiting");
    expect((await moodle.status()).connections).toEqual([]);
    expect(await moodle.paste(start.pendingId, mock.launchLink(passport))).toEqual({ ok: true });
    expect((await moodle.status()).connections).toHaveLength(1);
  });

  it("says what a wrong paste was, without echoing it", async () => {
    const { start } = await begin();
    expect(await moodle.paste(start.pendingId, start.launchUrl)).toEqual({ ok: false, kind: "not_a_link", hint: "page_address" });
    expect(await moodle.paste(start.pendingId, "https://auth.example.org/saml/sso?SAMLRequest=x")).toEqual({ ok: false, kind: "not_a_link", hint: "signin_address" });
    expect(await moodle.paste(start.pendingId, `${mock.base}/my/`)).toEqual({ ok: false, kind: "not_a_link", hint: "other_moodle_page" });
    expect(await moodle.paste(start.pendingId, "hello")).toEqual({ ok: false, kind: "not_a_link", hint: "not_a_link" });
    expect(await moodle.paste("another-id", "hello")).toEqual({ ok: false, kind: "expired" });
  });

  it("expires after ten minutes, and a new sign-in replaces the old one", async () => {
    const first = await begin();
    clock += 11 * 60_000;
    expect(await moodle.paste(first.start.pendingId, mock.launchLink(first.passport))).toEqual({ ok: false, kind: "expired" });
    const second = await begin();
    const third = await begin();
    expect(third.start.pendingId).not.toBe(second.start.pendingId);
    expect(await moodle.paste(second.start.pendingId, mock.launchLink(second.passport))).toEqual({ ok: false, kind: "expired" });
    expect(await moodle.paste(third.start.pendingId, mock.launchLink(second.passport))).toEqual({ ok: false, kind: "wrong_site" });
    await moodle.cancel(third.start.pendingId);
    expect((await moodle.status()).pending).toBeNull();
  });

  it("reports a link that Moodle then refuses, and uses its passport up", async () => {
    for (const [fault, kind] of [["policy", "policy"], ["nofunctions", "unsupported"], ["maintenance", "unavailable"]] as const) {
      const { start, passport } = await begin();
      mock.fault = fault;
      expect(await moodle.paste(start.pendingId, mock.launchLink(passport))).toEqual({ ok: true });
      expect((await moodle.status()).pending).toMatchObject({ state: "failed", error: kind });
      expect((await moodle.status()).connections).toEqual([]);
      mock.fault = "none";
      expect(await moodle.paste(start.pendingId, mock.launchLink(passport))).toEqual({ ok: false, kind: "expired" });
    }
  });

  it("installs the handler for the sign-in only, and removes it on every ending", async () => {
    const h = recordingHandler(true);
    const m = service(h);
    const a = await begin(m);
    expect(a.start.mode).toBe("auto");
    expect(h.installed).toBe(1);
    await m.cancel(a.start.pendingId);
    const afterCancel = h.removed;
    expect(afterCancel).toBeGreaterThan(0);
    const b = await begin(m);
    await m.link(mock.launchLink(b.passport));
    expect(h.removed).toBeGreaterThan(afterCancel);
    expect((await m.status()).connections).toHaveLength(1);
    const before = h.removed;
    await m.cleanup();
    expect(h.removed).toBeGreaterThan(before);
  });
});

describe("signing in, when things overlap", () => {
  /** A fetch that holds REST calls until released, to land other calls in the middle of a verification. */
  function gated() {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith("/webservice/rest/server.php")) await gate;
      return fetch(url, init);
    }) as typeof fetch;
    return { impl, release };
  }

  it("a sign-in cancelled while its link is being checked does not connect", async () => {
    const g = gated();
    const m = service(noHandler, g.impl);
    const a = await begin(m);
    const pasting = m.paste(a.start.pendingId, mock.launchLink(a.passport));
    await new Promise((r) => setTimeout(r, 30));
    expect((await m.status()).pending?.state).toBe("verifying");
    await m.cancel(a.start.pendingId);
    g.release();
    expect(await pasting).toEqual({ ok: true });
    expect(await m.status()).toEqual({ connections: [], pending: null });
  });

  it("a new sign-in started meanwhile is left untouched by the old one finishing", async () => {
    const g = gated();
    const m = service(noHandler, g.impl);
    const a = await begin(m);
    const pasting = m.paste(a.start.pendingId, mock.launchLink(a.passport));
    await new Promise((r) => setTimeout(r, 30));
    const { candidates } = await m.resolve("mock");
    const b = await m.start(candidates[0].site);
    g.release();
    await pasting;
    const status = await m.status();
    expect(status.connections).toEqual([]);
    expect(status.pending).toMatchObject({ id: b.pendingId, state: "waiting" });
  });

  it("a second link for the same passport is ignored while the first is being checked", async () => {
    const g = gated();
    const m = service(noHandler, g.impl);
    const a = await begin(m);
    const first = m.paste(a.start.pendingId, mock.launchLink(a.passport));
    await new Promise((r) => setTimeout(r, 30));
    expect(await m.paste(a.start.pendingId, mock.launchLink(a.passport))).toEqual({ ok: false, kind: "expired" });
    g.release();
    await first;
    expect((await m.status()).connections).toHaveLength(1);
  });

  it("refuses new sign-ins once the server is closing, and accepts them again after a start-up cleanup", async () => {
    const { candidates } = await moodle.resolve("mock");
    await moodle.cleanup(true);
    await expect(moodle.start(candidates[0].site)).rejects.toMatchObject({ kind: "unavailable" });
    await moodle.cleanup();
    expect((await moodle.start(candidates[0].site)).mode).toBe("manual");
  });

  it("does not mark a connection as ended if the student renewed or removed it meanwhile", async () => {
    const g = gated();
    const m = service(noHandler, g.impl);
    g.release();
    const site = await connect(m);
    mock.fault = "expired";
    const g2 = gated();
    const slow = service(noHandler, g2.impl);
    const failing = slow.courses(site, "he");
    await new Promise((r) => setTimeout(r, 30));
    await m.disconnect(site); // removed while the call was in flight
    g2.release();
    await expect(failing).rejects.toMatchObject({ kind: "auth" });
    expect((await m.status()).connections).toEqual([]);
  });

  it("accepts a root that reports itself when the probed year path falls through to it", async () => {
    process.env.TUTORAI_MOODLE_TEST_SITES = JSON.stringify([{ id: "mock", site: `${mock.base}/{yyyy}` }]);
    const m = service();
    const r = await m.resolve("mock");
    expect(r.candidates.map((c) => c.site)).toEqual([mock.base]);
    expect(mock.requests.filter((q) => q.path === "/lib/ajax/service-nologin.php")).toHaveLength(1); // the root was asked too
  });
});

describe("the sign-in handler's bookkeeping", () => {
  const app = () => join(env.root, "Applications", "TutorAI Moodle Sign-in.app");
  function fakeMac(opts: { delayMs?: number; ok?: boolean; failRemove?: boolean } = {}) {
    const state = { installs: 0, removes: 0 };
    return {
      state,
      install: async () => {
        await new Promise((r) => setTimeout(r, opts.delayMs ?? 0));
        if (opts.ok === false) return false;
        mkdirSync(app(), { recursive: true });
        state.installs++;
        return true;
      },
      remove: async (p: string) => {
        if (opts.failRemove) throw new Error("busy");
        const { rmSync } = await import("node:fs");
        rmSync(p, { recursive: true, force: true });
        state.removes++;
      },
    };
  }
  const handler = (mac: ReturnType<typeof fakeMac>) => {
    process.env.TUTORAI_MOODLE_HANDLER = "on";
    return createHandler({ command: ["/bin/true"], platform: "darwin", app: app(), mac });
  };
  afterEach(() => {
    process.env.TUTORAI_MOODLE_HANDLER = "off";
  });

  it("writes a marker while installed and leaves nothing after removal", async () => {
    const mac = fakeMac();
    const h = handler(mac);
    expect(await h.install()).toBe(true);
    expect(JSON.parse(readFileSync(paths().moodleHandler, "utf8"))).toMatchObject({ platform: "darwin", app: app() });
    await h.remove();
    expect(existsSync(app())).toBe(false);
    expect(existsSync(paths().moodleHandler)).toBe(false);
  });

  it("a removal that arrives while the app is being built still removes it", async () => {
    const mac = fakeMac({ delayMs: 80 });
    const h = handler(mac);
    const installing = h.install();
    const removing = h.remove(); // e.g. the server quitting, or another tab starting a sign-in
    expect(await installing).toBe(true);
    await removing;
    expect(existsSync(app())).toBe(false);
    expect(existsSync(paths().moodleHandler)).toBe(false);
  });

  it("removes our app even when the marker was lost, and leaves no marker when installing fails", async () => {
    const mac = fakeMac();
    mkdirSync(app(), { recursive: true }); // left by a run whose marker is gone
    await handler(mac).cleanup();
    expect(existsSync(app())).toBe(false);
    expect(await handler(fakeMac({ ok: false })).install()).toBe(false);
    expect(existsSync(paths().moodleHandler)).toBe(false);
  });

  it("keeps the marker when removal fails, so the next start tries again", async () => {
    const h = handler(fakeMac());
    await h.install();
    await handler(fakeMac({ failRemove: true })).remove();
    expect(existsSync(paths().moodleHandler)).toBe(true);
    await handler(fakeMac()).cleanup();
    expect(existsSync(app())).toBe(false);
    expect(existsSync(paths().moodleHandler)).toBe(false);
  });

  it("does nothing when switched off or on another system", async () => {
    const mac = fakeMac();
    process.env.TUTORAI_MOODLE_HANDLER = "off";
    expect(await createHandler({ command: [], platform: "darwin", app: app(), mac }).install()).toBe(false);
    process.env.TUTORAI_MOODLE_HANDLER = "on";
    expect(await createHandler({ command: [], platform: "win32", app: app(), mac }).install()).toBe(false);
    expect(mac.state.installs).toBe(0);
  });
});

describe("courses and files", () => {
  it("lists the student's courses and the importable files, never their addresses", async () => {
    const site = await connect();
    const courses = await moodle.courses(site, "he");
    expect(courses.map((c) => [c.id, c.displayname])).toEqual([[101, "רשתות תקשורת מחשבים"], [102, "תורת הסיבוכיות"]]);
    const rest = mock.requests.filter((r) => r.path === "/webservice/rest/server.php").map((r) => new URLSearchParams(r.body));
    expect(rest.at(-1)!.get("moodlewssettinglang")).toBe("he");
    expect(rest.at(-1)!.get("returnusercount")).toBe("0");

    const contents = await moodle.contents(site, 101, "he", false);
    expect(contents.files.map((f) => f.key)).toEqual(["11:/lecture1.pdf", "12:/week1/tirgul1.pdf", "12:/data.zip"]);
    expect(contents.other).toEqual({ textPages: 1, links: 0, external: 0, notImportable: { lti: 1 } });
    expect(JSON.stringify(contents)).not.toMatch(/pluginfile|token/);
  });

  it("caches the listing for ten minutes unless asked for a fresh one", async () => {
    const site = await connect();
    const count = () => mock.requests.filter((r) => r.body.includes("core_course_get_contents")).length;
    await moodle.contents(site, 101, "he", false);
    await moodle.contents(site, 101, "he", false);
    expect(count()).toBe(1);
    await moodle.contents(site, 101, "en", false);
    await moodle.contents(site, 101, "he", true);
    expect(count()).toBe(3);
    clock += 11 * 60_000;
    await moodle.contents(site, 101, "he", false);
    expect(count()).toBe(4);
  });

  it("marks the connection as ended when Moodle says the token expired, and remembers it", async () => {
    const site = await connect();
    mock.fault = "expired";
    await expect(moodle.courses(site, "he")).rejects.toMatchObject({ kind: "auth" });
    expect((await moodle.status()).connections[0].expired).toBe(true);
    mock.fault = "none";
    const restarted = service();
    expect((await restarted.status()).connections[0].expired).toBe(true);
    await expect(restarted.courses(site, "he")).rejects.toMatchObject({ kind: "auth" });
    await expect(moodle.courses("https://never-connected.example", "he")).rejects.toMatchObject({ kind: "auth" });
  });

  it("paces its requests and gives up politely when the site says to slow down", async () => {
    const site = await connect();
    sleeps.length = 0;
    await moodle.courses(site, "he");
    await moodle.courses(site, "he");
    expect(sleeps.some((ms) => ms > 0 && ms <= 300)).toBe(true);
    mock.fault = "429";
    sleeps.length = 0;
    await expect(moodle.courses(site, "he")).rejects.toMatchObject({ kind: "blocked" });
    expect(sleeps.filter((ms) => ms >= 2000)).toEqual([2000, 5000, 15000]);
    mock.fault = "challenge";
    await expect(moodle.courses(site, "he")).rejects.toMatchObject({ kind: "blocked" });
  });
});

describe("downloading a file", () => {
  it("writes it into the course folder under its hash, and tells the page", async () => {
    const site = await connect();
    await moodle.contents(site, 101, "he", false);
    const events = await download({ site });
    expect(events).toHaveLength(1);
    const done = events[0] as Extract<MoodleDownloadEvent, { type: "done" }>;
    expect(done).toMatchObject({ type: "done", name: "lecture1.pdf", size: FAKE_PDF("lecture 1").length });
    expect(done.path).toBe(`courses/3/sources/${done.hash.slice(0, 10)}-lecture1.pdf`);
    expect(readFileSync(join(env.data, done.path))).toEqual(FAKE_PDF("lecture 1"));
    expect(filesIn(sourcesDir())).toEqual([`${done.hash.slice(0, 10)}-lecture1.pdf`]);
    // The listing is fetched by itself when the server has none (e.g. after a restart).
    const cold = service();
    expect((await download({ site, key: "12:/week1/tirgul1.pdf" }, cold))[0]).toMatchObject({ type: "done", name: "tirgul1.pdf" });
  });

  it("writes nothing for a file the course already has", async () => {
    const site = await connect();
    const first = (await download({ site }))[0] as Extract<MoodleDownloadEvent, { type: "done" }>;
    expect(await download({ site, knownHashes: [first.hash] })).toEqual([{ type: "duplicate", hash: first.hash }]);
    expect(filesIn(sourcesDir())).toHaveLength(1);
  });

  it("fetches only what Moodle listed on the site itself", async () => {
    const site = await connect();
    mock.courses[0].sections[0].modules.push({ id: 15, modname: "resource", name: "Elsewhere", files: [{ filename: "ext.pdf", body: FAKE_PDF("x"), fileurl: "https://storage.example.org/ext.pdf" }] });
    expect(await download({ site, key: "15:/ext.pdf" })).toEqual([{ type: "error", kind: "not_listed" }]);
    expect(await download({ site, key: "99:/made-up.pdf" })).toEqual([{ type: "error", kind: "not_listed" }]);
    expect(await download({ site, key: "../../etc/passwd" })).toEqual([{ type: "error", kind: "not_listed" }]);
    expect(filesIn(sourcesDir())).toEqual([]);
  });

  it("stops at the size limit and leaves nothing behind", async () => {
    const site = await connect();
    mock.courses[0].sections[0].modules[0].files!.push({ filename: "huge.pdf", body: FAKE_PDF("huge"), endless: true });
    expect(await download({ site, key: "11:/huge.pdf" })).toEqual([{ type: "error", kind: "too_large" }]);
    expect(filesIn(sourcesDir())).toEqual([]);
  });

  it("rejects content that isn't the file it claims to be", async () => {
    const site = await connect();
    const files = mock.courses[0].sections[0].modules[0].files!;
    files.push({ filename: "notpdf.pdf", body: Buffer.from("just text") }, { filename: "challenge.pdf", body: Buffer.from("<!DOCTYPE html><html>Checking your browser</html>") }, { filename: "page.docx", body: Buffer.from("  <html>login</html>") });
    expect(await download({ site, key: "11:/notpdf.pdf" })).toEqual([{ type: "error", kind: "wrong_type" }]);
    expect(await download({ site, key: "11:/challenge.pdf" })).toEqual([{ type: "error", kind: "blocked" }]);
    expect(await download({ site, key: "11:/page.docx" })).toEqual([{ type: "error", kind: "blocked" }]);
    expect(filesIn(sourcesDir())).toEqual([]);
  });

  it("understands the file endpoint's own errors, and never follows it to another host", async () => {
    const site = await connect();
    await moodle.contents(site, 101, "he", false);
    mock.fault = "redirectAway";
    expect(await download({ site })).toEqual([{ type: "error", kind: "unsupported" }]);
    mock.fault = "fileJsonError";
    expect(await download({ site })).toEqual([{ type: "error", kind: "auth" }]);
    expect((await moodle.status()).connections[0].expired).toBe(true);
    expect(filesIn(sourcesDir())).toEqual([]);
  });

  it("cleans up when the page goes away or the student disconnects mid-download", async () => {
    const site = await connect();
    mock.courses[0].sections[0].modules[0].files!.push({ filename: "slow.pdf", body: FAKE_PDF("slow"), slow: true });
    await moodle.contents(site, 101, "he", true);
    const ctrl = new AbortController();
    const running = download({ site, key: "11:/slow.pdf" }, moodle, ctrl.signal);
    setTimeout(() => ctrl.abort(), 150);
    expect(await running).toEqual([]);
    expect(filesIn(sourcesDir())).toEqual([]);

    // Disconnecting while a file is on its way stops it and says why.
    const second = download({ site, key: "11:/slow.pdf" });
    await new Promise((r) => setTimeout(r, 150));
    await moodle.disconnect(site);
    expect(await second).toEqual([{ type: "error", kind: "auth" }]);
    expect(filesIn(sourcesDir())).toEqual([]);
    expect((await moodle.status()).connections).toEqual([]);
    expect(await download({ site })).toEqual([{ type: "error", kind: "auth" }]);
  });

  it("downloads only the kinds of file the app can read, whatever the page asks for", async () => {
    const site = await connect();
    expect(await download({ site, key: "12:/data.zip" })).toEqual([{ type: "error", kind: "wrong_type" }]);
    expect(mock.requests.some((r) => r.path.endsWith("/data.zip"))).toBe(false);
    expect(filesIn(sourcesDir())).toEqual([]);
  });

  it("cuts off an endless error answer instead of buffering it", async () => {
    const site = await connect();
    await moodle.contents(site, 101, "he", false);
    mock.fault = "hugeFileError";
    const started = Date.now();
    expect(await download({ site })).toEqual([{ type: "error", kind: "forbidden" }]);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(filesIn(sourcesDir())).toEqual([]);
  });

  it("removes parts an interrupted download left, but only old ones", async () => {
    const site = await connect();
    mkdirSync(sourcesDir(), { recursive: true });
    const old = join(sourcesDir(), "incoming-aaaaaaaaaaaa.part");
    const recent = join(sourcesDir(), "incoming-bbbbbbbbbbbb.part");
    writeFileSync(old, "x");
    writeFileSync(recent, "x");
    const twoHoursAgo = new Date(clock - 2 * 3600_000);
    utimesSync(old, twoHoursAgo, twoHoursAgo);
    utimesSync(recent, new Date(clock), new Date(clock));
    await download({ site });
    expect(existsSync(old)).toBe(false);
    expect(existsSync(recent)).toBe(true);
  });
});

describe("the rules around it", () => {
  it("allows a Moodle address only by host, path and state", () => {
    const site = "https://moodle.runi.ac.il/2027";
    const ok = (level: "probe" | "signin" | "connected", url: string) => allowedUrl({ site, level }, url);
    expect(ok("probe", `${site}/lib/ajax/service-nologin.php?info=tool_mobile_get_public_config`)).toBe(true);
    expect(ok("probe", `${site}/webservice/rest/server.php`)).toBe(false);
    expect(ok("signin", `${site}/webservice/rest/server.php`)).toBe(true);
    expect(ok("signin", `${site}/webservice/pluginfile.php/1/mod_resource/content/1/a.pdf`)).toBe(false);
    expect(ok("connected", `${site}/webservice/pluginfile.php/1/mod_resource/content/1/a.pdf?token=t`)).toBe(true);
    for (const bad of [
      `${site}/webservice/rest/server.php?wstoken=t`, // the token belongs in the body
      `${site}/login/index.php`,
      `${site}/pluginfile.php/1/a.pdf`,
      `${site}/webservice/pluginfile.php/../../login/index.php`,
      "https://moodle.runi.ac.il/2026/webservice/rest/server.php", // another year's site
      "https://moodle.runi.ac.il/webservice/rest/server.php",
      "https://evil.example/2027/webservice/rest/server.php",
      "http://moodle.runi.ac.il/2027/webservice/rest/server.php",
      "https://moodle.runi.ac.il:8443/2027/webservice/rest/server.php",
      "https://user@moodle.runi.ac.il/2027/webservice/rest/server.php",
    ])
      expect(ok("connected", bad)).toBe(false);
    // The loopback mock is reachable only in test mode.
    expect(allowedUrl({ site: "http://127.0.0.1:4401", level: "connected" }, "http://127.0.0.1:4401/webservice/rest/server.php")).toBe(false);
    expect(allowedUrl({ site: "http://127.0.0.1:4401", level: "connected" }, "http://127.0.0.1:4401/webservice/rest/server.php", true)).toBe(true);
    expect(allowedUrl({ site: "http://10.0.0.5", level: "connected" }, "http://10.0.0.5/webservice/rest/server.php", true)).toBe(false);
  });

  it("refuses a disallowed address before any request, and never follows the API elsewhere", async () => {
    const calls: string[] = [];
    const http = new MoodleHttp({
      userAgent: "t",
      sleep: async () => {},
      fetch: (async (url: string) => {
        calls.push(String(url));
        return new Response(null, { status: 302, headers: { location: "https://evil.example/" } });
      }) as typeof fetch,
    });
    const access = { site: "https://moodle.runi.ac.il/2027", level: "connected" as const };
    await expect(http.text(access, "https://evil.example/x", { body: "", headers: {} })).rejects.toMatchObject({ kind: "forbidden" });
    expect(calls).toEqual([]);
    await expect(http.text(access, "https://moodle.runi.ac.il/2027/webservice/rest/server.php", { body: "", headers: {} })).rejects.toBeInstanceOf(MoodleError);
    expect(calls).toEqual(["https://moodle.runi.ac.il/2027/webservice/rest/server.php"]);
  });

  it("reads no answer without a size limit, and keeps a site's error code out of the log unless it looks like one", async () => {
    const big = "x".repeat(300_000);
    const http = new MoodleHttp({ userAgent: "t", sleep: async () => {}, fetch: (async () => new Response(big, { status: 200 })) as typeof fetch });
    const access = { site: "https://moodle.runi.ac.il/2027", level: "connected" as const };
    await expect(http.text(access, "https://moodle.runi.ac.il/2027/webservice/rest/server.php", { body: "", headers: {}, maxBytes: 1000 })).rejects.toMatchObject({ kind: "unsupported" });
    const { moodleErrorOf } = await import("@tutorai/moodle");
    expect(moodleErrorOf({ exception: "x", errorcode: "invalidtoken" })!.message).toBe("moodle: auth (invalidtoken)");
    const hostile = moodleErrorOf({ exception: "x", errorcode: `bad\ncode token=${"a".repeat(5000)}` })!;
    expect(hostile.message).toBe("moodle: other (unknown)");
  });

  it("only the Moodle transport file may use the unguarded fetch", () => {
    const src = fileURLToPath(new URL("../src", import.meta.url));
    const users: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith(".ts") && readFileSync(p, "utf8").includes("moodleTransport")) users.push(p.slice(src.length + 1).replaceAll("\\", "/"));
      }
    };
    walk(src);
    expect(users.sort()).toEqual(["moodle/http.ts", "net.ts"]);
  });

  it("keeps Moodle secrets out of the log", () => {
    const out = redact(
      'failed: https://m.example/webservice/pluginfile.php/1/a.pdf?forcedownload=1&token=0123456789abcdef wstoken=aaaabbbbcccc&x=1 {"token":"deadbeefdeadbeef","privatetoken":"PPPPPPPP"} password=hunter2 moodlemobile://token=QUJDREVG==',
    );
    for (const secret of ["0123456789abcdef", "aaaabbbbcccc", "deadbeefdeadbeef", "PPPPPPPP", "hunter2", "QUJDREVG"]) expect(out).not.toContain(secret);
    expect(out).toContain("forcedownload=1");
  });

  it("streams a file into the folder safely", async () => {
    const data = new DataFolder(env.data);
    const chunks = async function* () {
      yield Buffer.from("%PDF-");
      yield Buffer.from("rest of the file");
    };
    const got = await data.importStream("courses/3/sources", chunks(), { maxBytes: 1000 });
    expect(got.head.toString()).toBe("%PDF-rest of the file");
    expect(got.size).toBe(21);
    await data.commitPart(got.part, "courses/3/sources/abc-file.pdf");
    expect(filesIn(sourcesDir())).toEqual(["abc-file.pdf"]);

    await expect(data.importStream("courses/3/sources", chunks(), { maxBytes: 10 })).rejects.toBeInstanceOf(TooLargeError);
    expect(filesIn(sourcesDir())).toEqual(["abc-file.pdf"]);
    await expect(data.importStream("../outside", chunks(), { maxBytes: 1000 })).rejects.toBeInstanceOf(PathError);
    const again = await data.importStream("courses/3/sources", chunks(), { maxBytes: 1000 });
    await expect(data.commitPart(again.part, "courses/4/sources/abc.pdf")).rejects.toBeInstanceOf(PathError);
    await expect(data.commitPart("courses/3/sources/abc-file.pdf", "courses/3/sources/x.pdf")).rejects.toBeInstanceOf(PathError);
    await data.discardPart(again.part);
    expect(filesIn(sourcesDir())).toEqual(["abc-file.pdf"]);
  });

  it("writes the handler's script only from paths it can quote safely", () => {
    const spec = { app: "/Users/x/Applications/TutorAI Moodle Sign-in.app", command: ["/Users/x/.local/bin/tutorai"], cwd: "/Users/x/My Folder/שלום", configDir: "/Users/x/.tutorai", inbox: "/Users/x/.tutorai/moodle/inbox" };
    const script = appleScript(spec)!;
    expect(script).toContain('quoted form of "/Users/x/.local/bin/tutorai"');
    expect(script).toContain('" moodle-link --config " & quoted form of "/Users/x/.tutorai" & " --from-file " & quoted form of p');
    expect(script).toContain('"/Users/x/.tutorai/moodle/inbox/link-"');
    expect(script).not.toContain("theURL &"); // the link is written to a file, never put on a command line
    expect(appleScript({ ...spec, command: ['/Users/x/bad"path/tutorai'] })).toBeNull();
    expect(appleScript({ ...spec, configDir: "/Users/x/back\\slash" })).toBeNull();
    expect(appleScript({ ...spec, cwd: "/Users/x/new\nline" })).toBeNull();
    expect(embeddable("")).toBe(false);
  });
});

describe("over HTTP", () => {
  let running: Running;
  let cookie: string;
  let origin: string;

  const http = (path: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const r = request({ host: "127.0.0.1", port: running.port, path, method: opts.method ?? "GET", headers: { host: `127.0.0.1:${running.port}`, ...opts.headers } }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString("utf8") }));
      });
      r.on("error", reject);
      if (opts.body) r.write(opts.body);
      r.end();
    });
  const api = (path: string, o: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) =>
    http(path, {
      method: o.method,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      headers: { cookie, "sec-fetch-site": "same-origin", "x-tutorai": running.security.apiToken, ...(o.method === "POST" ? { origin, "content-type": "application/json" } : {}), ...o.headers },
    });
  const control = (path: string, body?: unknown, secret = running.security.controlSecret) =>
    http(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body), headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" } });

  beforeEach(async () => {
    running = await serve({ port: 4900 + Math.floor(Math.random() * 400), moodle, services: { settings: async () => ({}) as never, claudeCode: {} as never, chatgpt: {} as never } });
    origin = `http://127.0.0.1:${running.port}`;
    const r = await new Promise<{ cookie: string }>((resolve) => {
      request({ host: "127.0.0.1", port: running.port, path: `/open?code=${running.security.issueCode()}`, headers: { host: `127.0.0.1:${running.port}` } }, (res) => {
        res.resume();
        resolve({ cookie: String(res.headers["set-cookie"]).split(";")[0] });
      }).end();
    });
    cookie = r.cookie;
  });
  afterEach(async () => {
    await running.close();
  });

  it("serves the whole flow to the page, and reports the feature in hello", async () => {
    expect(JSON.parse((await api("/api/hello")).body)).toMatchObject({ features: { moodle: true }, testMode: true });
    expect(JSON.parse((await api("/api/moodle/institutions")).body).institutions.map((i: { id: string }) => i.id)).toContain("mock");
    const resolved = JSON.parse((await api("/api/moodle/resolve", { method: "POST", body: { institutionId: "mock" } })).body);
    const site = resolved.candidates[0].site as string;
    const start = JSON.parse((await api("/api/moodle/connect/start", { method: "POST", body: { site } })).body);
    const passport = new URL(start.launchUrl).searchParams.get("passport")!;

    // The handler's route: needs the control secret, says nothing either way.
    expect((await control("/control/moodle-link", { link: mock.launchLink(passport) }, "wrong-secret")).status).toBe(401);
    expect(JSON.parse((await api("/api/moodle/status")).body).connections).toEqual([]);
    expect(await control("/control/moodle-link", { link: "garbage" })).toEqual({ status: 204, body: "" });
    expect(await control("/control/moodle-link", { link: mock.launchLink(passport) })).toEqual({ status: 204, body: "" });
    const status = JSON.parse((await api("/api/moodle/status")).body);
    expect(status.connections).toHaveLength(1);
    expect(JSON.stringify(status)).not.toContain(mock.token);

    const q = `site=${encodeURIComponent(site)}&lang=he`;
    expect(JSON.parse((await api(`/api/moodle/courses?${q}`)).body).courses).toHaveLength(2);
    expect(JSON.parse((await api(`/api/moodle/contents?${q}&course=101&fresh=1`)).body).files).toHaveLength(3);
    const dl = await api("/api/moodle/download", { method: "POST", body: { site, remoteCourseId: 101, key: "11:/lecture1.pdf", courseId: 3, knownHashes: [] } });
    const events = dl.body.trim().split("\n").map((l) => JSON.parse(l));
    expect(events.at(-1)).toMatchObject({ type: "done", name: "lecture1.pdf" });

    mock.fault = "expired";
    const failed = await api(`/api/moodle/courses?${q}`);
    expect(failed.status).toBe(502);
    expect(JSON.parse(failed.body).kind).toBe("auth");
    expect((await api("/api/moodle/connect/start", { method: "POST", body: { site: "https://evil.example" } })).status).toBe(400);
    expect((await api("/api/moodle/disconnect", { method: "POST", body: { site } })).status).toBe(204);
  });

  it("guards every Moodle route like the rest of the API, and can be switched off", async () => {
    const routes: [string, string][] = [
      ["GET", "/api/moodle/institutions"],
      ["GET", "/api/moodle/status"],
      ["POST", "/api/moodle/resolve"],
      ["POST", "/api/moodle/connect/start"],
      ["POST", "/api/moodle/connect/paste"],
      ["POST", "/api/moodle/connect/cancel"],
      ["POST", "/api/moodle/disconnect"],
      ["GET", "/api/moodle/courses?site=x"],
      ["GET", "/api/moodle/contents?site=x&course=1"],
      ["POST", "/api/moodle/download"],
    ];
    for (const [method, path] of routes) {
      const body = method === "POST" ? "{}" : undefined;
      expect((await http(path, { method, body, headers: { "x-tutorai": running.security.apiToken, "sec-fetch-site": "same-origin" } })).status, `${path} without a cookie`).toBe(401);
      expect((await http(path, { method, body, headers: { cookie, origin: "https://evil.example", "x-tutorai": running.security.apiToken } })).status, `${path} from another origin`).toBe(403);
      expect((await http(path, { method, body, headers: { cookie, "sec-fetch-site": "same-origin", ...(method === "POST" ? { origin } : {}) } })).status, `${path} without the token`).toBe(403);
    }
    expect((await api("/api/moodle/resolve", { method: "POST", body: { institutionId: "x".repeat(300_000) } })).status).toBe(413);
    process.env.TUTORAI_MOODLE = "off";
    for (const [method, path] of routes) {
      const r = await api(path, { method, body: method === "POST" ? {} : undefined });
      expect(r.status, `${path} when off`).toBe(403);
      expect(JSON.parse(r.body).kind).toBe("unavailable");
    }
    expect(JSON.parse((await api("/api/hello")).body).features.moodle).toBe(false);
    expect((await control("/control/moodle-link", { link: "x" })).status).toBe(204);
  });

  it("the moodle-link command passes exactly one well-formed link to its own server", async () => {
    const main = fileURLToPath(new URL("../src/main.ts", import.meta.url));
    const cli = (...args: string[]) =>
      new Promise<{ code: number | null; out: string }>((resolve) => {
        const child = spawn(process.execPath, ["--import", "tsx", main, "moodle-link", ...args], { env: { ...process.env, TUTORAI_CONFIG_DIR: "/nonexistent-default" } });
        let out = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (out += d));
        child.on("close", (code) => resolve({ code, out }));
      });
    const fresh = async () => {
      const { candidates } = await moodle.resolve("mock");
      const start = await moodle.start(candidates[0].site);
      return new URL(start.launchUrl).searchParams.get("passport")!;
    };
    const connections = async () => (await moodle.status()).connections.length;

    let passport = await fresh();
    const link = mock.launchLink(passport);
    for (const args of [[link], ["--config"], ["--config", env.config], ["--config", env.config, link, "extra"], ["--config", env.config, "--config", "/elsewhere", link], ["--config", env.config, "https://evil.example/"], ["--config", "/nonexistent", link]]) {
      expect(await cli(...args)).toEqual({ code: 0, out: "" });
      expect(await connections(), JSON.stringify(args.map((a) => (a === link ? "<link>" : a)))).toBe(0);
    }
    expect(await cli("--config", env.config, link)).toEqual({ code: 0, out: "" });
    expect(await connections()).toBe(1);

    if (process.platform === "darwin") {
      await moodle.disconnect(mock.base);
      passport = await fresh();
      const inbox = paths().moodleInbox;
      mkdirSync(inbox, { recursive: true });
      const outside = join(env.root, "link-outside");
      writeFileSync(outside, mock.launchLink(passport));
      await cli("--config", env.config, "--from-file", outside);
      expect(await connections()).toBe(0);
      expect(existsSync(outside)).toBe(true); // not ours to touch
      const inside = join(inbox, "link-1");
      writeFileSync(inside, `${mock.launchLink(passport)}\n`);
      expect(await cli("--config", env.config, "--from-file", inside)).toEqual({ code: 0, out: "" });
      expect(existsSync(inside)).toBe(false);
      expect(await connections()).toBe(1);
    } else {
      expect(await cli("--config", env.config, "--from-file", join(env.root, "x"))).toEqual({ code: 0, out: "" });
    }
  }, 60_000);
});
