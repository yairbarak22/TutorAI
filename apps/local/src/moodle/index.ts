import { createHash, randomBytes } from "node:crypto";
import {
  MoodleClient,
  MoodleError,
  buildLaunchUrl,
  describePaste,
  expectedSiteIds,
  extensionOf,
  findLaunchLink,
  flattenContents,
  hasNeededFunctions,
  isSafeLaunchUrl,
  isSiteFileUrl,
  moodleErrorOf,
  safeName,
  MAX_FILE_BYTES,
  SUPPORTED_EXTENSIONS,
  type MoodleErrorKind,
  type MoodleFetch,
} from "@tutorai/moodle";
import type { MoodleContents, MoodleDownloadEvent, MoodleDownloadRequest, MoodleInstitutions, MoodlePasteResult, MoodlePending, MoodleResolve, MoodleStart, MoodleStatus, RemoteCourse } from "@tutorai/local-api";
import { loadSettings } from "../config.ts";
import { DataFolder, PathError, TooLargeError } from "../fs/folder.ts";
import { log } from "../log.ts";
import { createHandler, type Handler } from "./handler/index.ts";
import { MoodleHttp, type SiteAccess } from "./http.ts";
import { Sites } from "./sites.ts";
import { listConnections, readConnection, removeAllConnections, removeConnection, writeConnection, type Connection } from "./tokens.ts";

/**
 * The Moodle connection (docs/rfc-moodle.md): sign-in through the institution's own page, a
 * token kept on this computer only, and read-only calls to the student's own Moodle.
 */

/** On unless a setting or TUTORAI_MOODLE turns it off (docs/rfc-moodle.md §4.4). */
export const MOODLE_DEFAULT_ON = true;
const PENDING_TTL_MS = 10 * 60_000;
const CONTENTS_TTL_MS = 10 * 60_000;
const STALE_PART_MS = 60 * 60_000;
/** The file endpoint's own error answers are small; anything longer is not one. */
const FILE_ERROR_MAX_BYTES = 64 * 1024;

export const moodleTestMode = () => process.env.TUTORAI_TEST === "1" && process.env.TUTORAI_MOODLE_ALLOW_LOCAL === "1";

export interface MoodleOptions {
  version: string;
  /** What the sign-in handler runs before `moodle-link …` (absolute paths). */
  handlerCommand: string[];
  handler?: Handler;
  /** The data folder files are imported into. */
  folder?: () => Promise<DataFolder>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface MoodleService {
  enabled(): Promise<boolean>;
  testMode(): boolean;
  institutions(): MoodleInstitutions;
  resolve(institutionId: string): Promise<MoodleResolve>;
  status(): Promise<MoodleStatus>;
  /** `site` must be a key from a resolve in the last 30 minutes. */
  start(site: string): Promise<MoodleStart>;
  paste(pendingId: string, text: string): Promise<MoodlePasteResult>;
  cancel(pendingId: string): Promise<void>;
  /** From the control route (the sign-in handler). Never throws, never reports. */
  link(text: string): Promise<void>;
  disconnect(site: string): Promise<void>;
  courses(site: string, lang: "he" | "en"): Promise<RemoteCourse[]>;
  contents(site: string, remoteCourseId: number, lang: "he" | "en", fresh: boolean): Promise<MoodleContents>;
  download(req: MoodleDownloadRequest, emit: (e: MoodleDownloadEvent) => void, signal: AbortSignal): Promise<void>;
  /**
   * Start-up and every exit: remove our sign-in handler and anything it left. `closing` also
   * refuses new sign-ins from then on, so none can start while the server is going down.
   */
  cleanup(closing?: boolean): Promise<void>;
  /** Tests: forget everything. */
  reset(): Promise<void>;
}

interface Pending extends Omit<MoodlePending, "expiresAt"> {
  wwwroots: string[];
  passport: string;
  host: string;
  siteName: string;
  institutionId: string;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
}

const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const kindOf = (e: unknown): MoodleErrorKind => (e instanceof MoodleError ? e.kind : "other");

/** The first bytes must be what the file's name says; HTML where a file was expected is a challenge page. */
function contentProblem(filename: string, head: Buffer): MoodleErrorKind | null {
  const ext = extensionOf(filename);
  const text = head.toString("latin1").trimStart().toLowerCase();
  const html = text.startsWith("<!doctype") || text.startsWith("<html");
  if (ext === "pdf") return head.subarray(0, 4).toString("latin1") === "%PDF" ? null : html ? "blocked" : "wrong_type";
  if (ext === "pptx" || ext === "docx") return head.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ? null : html ? "blocked" : "wrong_type";
  return html ? "blocked" : null;
}

export function createMoodle(opts: MoodleOptions): MoodleService {
  const now = opts.now ?? Date.now;
  const testMode = moodleTestMode;
  const http = new MoodleHttp({ userAgent: `TutorAI-Local/${opts.version} (+https://github.com/yairbarak22/TutorAI)`, testMode: testMode(), fetch: opts.fetch, sleep: opts.sleep, now });
  const sites = new Sites(http, { testMode: testMode(), now });
  const handler = opts.handler ?? createHandler({ command: opts.handlerCommand });
  const folder = opts.folder ?? (async () => new DataFolder((await loadSettings()).dataDir));

  let pending: Pending | null = null;
  let closing = false;
  /** key → address per site and course. Language-independent; never sent to the page. */
  const fileUrls = new Map<string, Map<string, string>>();
  const contentsCache = new Map<string, { at: number; value: MoodleContents }>();
  const downloads = new Map<string, Set<AbortController>>();
  const courseKey = (site: string, course: number) => `${site}\n${course}`;

  const clearPending = async () => {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending = null;
    await handler.remove();
  };

  const paceOf = (institutionId?: string) => sites.registry().find((i) => i.id === institutionId)?.paceMs;

  const fetchFor = (access: SiteAccess): MoodleFetch => (url, init) => http.text(access, url, init);

  /** A connected site's client; marks the connection as ended when the site says the token is no longer valid. */
  async function connected(site: string): Promise<{ connection: Connection; access: SiteAccess }> {
    const connection = await readConnection(site);
    if (!connection) throw new MoodleError("auth", "notconnected");
    if (connection.expiredAt) throw new MoodleError("auth", "expired");
    return { connection, access: { site, level: "connected", paceMs: paceOf(connection.institutionId) } };
  }
  async function withExpiry<T>(connection: Connection, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof MoodleError && e.kind === "auth") {
        // Only if this is still the connection that failed: not one the student removed or renewed meanwhile.
        const current = await readConnection(connection.site);
        if (current && current.token === connection.token && !current.expiredAt) await writeConnection({ ...current, expiredAt: new Date(now()).toISOString() });
      }
      throw e;
    }
  }

  /** The only way a token enters the system (docs/rfc-moodle.md §6.4). */
  async function acceptLink(text: string): Promise<MoodlePasteResult> {
    const p = pending;
    if (!p || p.state !== "waiting" || p.expiresAt < now()) return { ok: false, kind: "expired" };
    const found = findLaunchLink(text);
    if (!found) return { ok: false, kind: "not_a_link", hint: describePaste(text, p.site) };
    // Only Moodle knows the passport: a link made anywhere else fails here and changes nothing.
    if (!expectedSiteIds(p.wwwroots, p.passport, md5).includes(found.siteId)) return { ok: false, kind: "wrong_site" };

    p.state = "verifying"; // the passport is used: no further link is accepted for it
    await handler.remove();
    try {
      const access: SiteAccess = { site: p.site, level: "signin", paceMs: paceOf(p.institutionId) };
      const info = await new MoodleClient({ site: p.site, token: found.token, lang: "en", fetch: fetchFor(access) }).siteInfo();
      if (!info.userid || !hasNeededFunctions(info)) throw new MoodleError("unsupported", "functions");
      if (pending !== p) return { ok: true }; // cancelled or replaced meanwhile
      await writeConnection({
        site: p.site,
        host: p.host,
        siteName: (info.sitename || p.siteName).slice(0, 80),
        institutionId: p.institutionId,
        userId: info.userid,
        fullName: info.fullname.slice(0, 120),
        token: found.token,
        connectedAt: new Date(now()).toISOString(),
        release: info.release.slice(0, 80),
        downloadFiles: info.downloadfiles,
      });
      if (pending === p) {
        clearTimeout(p.timer);
        pending = null;
      }
    } catch (e) {
      if (pending === p) {
        p.state = "failed";
        p.error = kindOf(e);
      }
      log("warn", `moodle sign-in could not be verified: ${e instanceof MoodleError ? e.message : "error"}`);
    }
    return { ok: true };
  }

  async function loadContents(site: string, remoteCourseId: number, lang: "he" | "en"): Promise<MoodleContents> {
    const { connection, access } = await connected(site);
    const client = new MoodleClient({ site, token: connection.token, lang, fetch: fetchFor(access) });
    const flat = flattenContents(await withExpiry(connection, () => client.contents(remoteCourseId)), site);
    fileUrls.set(courseKey(site, remoteCourseId), flat.urls);
    const value: MoodleContents = { files: flat.files, other: flat.other };
    contentsCache.set(`${courseKey(site, remoteCourseId)}\n${lang}`, { at: now(), value });
    return value;
  }

  return {
    async enabled() {
      const env = process.env.TUTORAI_MOODLE;
      if (env === "on") return true;
      if (env === "off") return false;
      return (await loadSettings()).moodleEnabled ?? MOODLE_DEFAULT_ON;
    },
    testMode,
    institutions: () => sites.institutions(),
    resolve: (institutionId) => sites.resolve(institutionId),

    async status() {
      // Read the pending sign-in first: a sign-in that finishes while the files are listed must
      // never look like "no pending and no connection".
      const p = pending;
      const connections = (await listConnections()).map((c) => ({
        site: c.site,
        host: c.host,
        siteName: c.siteName,
        institutionId: c.institutionId,
        fullName: c.fullName,
        connectedAt: c.connectedAt,
        expired: !!c.expiredAt,
      }));
      return {
        connections,
        pending: p ? { id: p.id, site: p.site, mode: p.mode, state: p.state, error: p.error, expiresAt: new Date(p.expiresAt).toISOString() } : null,
      };
    },

    async start(site) {
      if (closing) throw new MoodleError("unavailable", "closing");
      const resolved = sites.get(site);
      if (!resolved?.site.launchUrl) throw new MoodleError("not_listed", "site");
      await clearPending();
      const passport = randomBytes(16).toString("hex");
      const launchUrl = buildLaunchUrl(resolved.site.launchUrl, passport);
      if (!isSafeLaunchUrl(launchUrl, testMode())) throw new MoodleError("forbidden", "launchurl");
      const id = randomBytes(12).toString("base64url");
      const expiresAt = now() + PENDING_TTL_MS;
      const timer = setTimeout(() => {
        if (pending?.id === id) void clearPending();
      }, PENDING_TTL_MS);
      timer.unref?.();
      const p: Pending = {
        id,
        site,
        mode: "manual",
        state: "waiting",
        wwwroots: resolved.site.wwwroots,
        passport,
        host: resolved.site.host,
        siteName: resolved.site.siteName,
        institutionId: resolved.institution.id,
        expiresAt,
        timer,
      };
      pending = p;
      const auto = await handler.install();
      if (pending !== p) {
        // Cancelled or replaced while the handler was being installed.
        if (!pending) await handler.remove();
        throw new MoodleError("other", "replaced");
      }
      p.mode = auto ? "auto" : "manual";
      return { pendingId: id, launchUrl, mode: p.mode, expiresAt: new Date(expiresAt).toISOString() };
    },

    async paste(pendingId, text) {
      if (!pending || pending.id !== pendingId) return { ok: false, kind: "expired" };
      return acceptLink(text);
    },

    async cancel(pendingId) {
      if (pending?.id === pendingId) await clearPending();
    },

    async link(text) {
      try {
        await acceptLink(text);
      } catch (e) {
        log("warn", `moodle link: ${e instanceof MoodleError ? e.message : "error"}`);
      }
    },

    async disconnect(site) {
      for (const c of downloads.get(site) ?? []) c.abort();
      await removeConnection(site);
      for (const key of [...fileUrls.keys()]) if (key.startsWith(`${site}\n`)) fileUrls.delete(key);
      for (const key of [...contentsCache.keys()]) if (key.startsWith(`${site}\n`)) contentsCache.delete(key);
    },

    async courses(site, lang) {
      const { connection, access } = await connected(site);
      const client = new MoodleClient({ site, token: connection.token, lang, fetch: fetchFor(access) });
      return withExpiry(connection, () => client.courses(connection.userId));
    },

    async contents(site, remoteCourseId, lang, fresh) {
      const cached = contentsCache.get(`${courseKey(site, remoteCourseId)}\n${lang}`);
      if (!fresh && cached && now() - cached.at < CONTENTS_TTL_MS) {
        await connected(site); // still connected
        return cached.value;
      }
      return loadContents(site, remoteCourseId, lang);
    },

    async download(req, emit, signal) {
      const ctrl = new AbortController();
      const abort = () => ctrl.abort();
      signal.addEventListener("abort", abort, { once: true });
      const running = downloads.get(req.site) ?? new Set<AbortController>();
      downloads.set(req.site, running);
      running.add(ctrl);
      let part: string | null = null;
      let data: DataFolder | null = null;
      try {
        const { connection, access } = await connected(req.site);
        if (!fileUrls.has(courseKey(req.site, req.remoteCourseId))) await loadContents(req.site, req.remoteCourseId, "en");
        const listed = fileUrls.get(courseKey(req.site, req.remoteCourseId));
        const address = listed?.get(req.key);
        // The page picks from what Moodle listed; it never supplies an address.
        if (!address || !isSiteFileUrl(address, req.site)) throw new MoodleError("not_listed", "key");
        const filename = req.key.slice(req.key.lastIndexOf("/") + 1);
        // Only what the app can read, whatever the page asks for.
        if (!SUPPORTED_EXTENSIONS.includes(extensionOf(filename))) throw new MoodleError("wrong_type", "extension");
        const url = new URL(address);
        url.searchParams.set("token", connection.token);

        data = await folder();
        const dir = `courses/${req.courseId}/sources`;
        await data.sweepParts(dir, STALE_PART_MS, now()).catch(() => {});
        const folderNow = data;
        const got = await withExpiry(connection, () =>
          http.file(
            access,
            url.toString(),
            async (res) => {
              const type = res.headers.get("content-type") ?? "";
              if (type.includes("application/json")) {
                // The file endpoint answers errors as JSON (an ended token, a missing file).
                const body = await http.readCapped(res, FILE_ERROR_MAX_BYTES, ctrl.signal).catch(() => "");
                let parsed: unknown = null;
                try {
                  parsed = JSON.parse(body);
                } catch {
                  /* not JSON after all */
                }
                throw moodleErrorOf(parsed) ?? new MoodleError("forbidden", `http${res.status}`);
              }
              if (!res.ok || !res.body) {
                await res.body?.cancel().catch(() => {});
                throw new MoodleError(res.status === 403 || res.status === 404 ? "forbidden" : "unavailable", `http${res.status}`);
              }
              const total = Number(res.headers.get("content-length")) || null;
              if (total && total > MAX_FILE_BYTES) {
                await res.body.cancel().catch(() => {});
                throw new MoodleError("too_large");
              }
              let last = 0;
              return folderNow.importStream(dir, res.body as unknown as AsyncIterable<Uint8Array>, {
                maxBytes: MAX_FILE_BYTES,
                onProgress: (received) => {
                  if (received - last >= 256 * 1024) {
                    last = received;
                    emit({ type: "progress", received, total });
                  }
                },
              });
            },
            ctrl.signal,
          ),
        );
        part = got.part;
        const problem = contentProblem(filename, got.head);
        if (problem) throw new MoodleError(problem);
        if (req.knownHashes.includes(got.hash)) {
          await data.discardPart(part);
          part = null;
          return emit({ type: "duplicate", hash: got.hash });
        }
        const path = `${dir}/${got.hash.slice(0, 10)}-${safeName(filename)}`;
        await data.commitPart(part, path);
        part = null;
        emit({ type: "done", path, hash: got.hash, size: got.size, name: filename });
      } catch (e) {
        if (part && data) await data.discardPart(part).catch(() => {});
        if (signal.aborted) return; // the page is gone: nothing to tell
        // A stream that broke in the middle (connection lost, timeout) is a network problem.
        const kind: MoodleErrorKind = e instanceof TooLargeError ? "too_large" : ctrl.signal.aborted ? "auth" : e instanceof MoodleError ? e.kind : e instanceof PathError ? "other" : "network";
        if (!(e instanceof MoodleError) && !(e instanceof TooLargeError)) log("warn", `moodle download failed: ${e instanceof Error ? e.name : "error"}`);
        emit({ type: "error", kind });
      } finally {
        signal.removeEventListener("abort", abort);
        running.delete(ctrl);
      }
    },

    async cleanup(final = false) {
      closing = final;
      if (pending) {
        clearTimeout(pending.timer);
        pending = null;
      }
      await handler.cleanup();
    },

    async reset() {
      if (pending) clearTimeout(pending.timer);
      pending = null;
      await handler.cleanup();
      await removeAllConnections();
      sites.forget();
      fileUrls.clear();
      contentsCache.clear();
    },
  };
}
