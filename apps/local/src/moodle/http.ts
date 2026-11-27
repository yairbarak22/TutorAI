import { MoodleError } from "@tutorai/moodle";
import { moodleTransport } from "../net.ts";

/**
 * The ONLY code in TutorAI Local that contacts a Moodle site (docs/rfc-moodle.md §5.4, §9).
 * Every request must match the site's host, one of a few paths, and the state of the connection.
 * Requests to one site run one at a time, with a pause between them, and are never redirected
 * to another host.
 */

/** How far a site has got: being probed, signing in, or connected. Each level allows more paths. */
export type AccessLevel = "probe" | "signin" | "connected";
export interface SiteAccess {
  /** The site key: the validated wwwroot (during a probe: the candidate address). */
  site: string;
  level: AccessLevel;
  /** Minimum pause between requests to this site. */
  paceMs?: number;
}

const PROBE = "/lib/ajax/service-nologin.php";
const REST = "/webservice/rest/server.php";
const FILES = "/webservice/pluginfile.php/";

export const API_PACE_MS = 300;
export const FILE_PACE_MS = 500;
const API_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 10_000;
const FILE_TIMEOUT_MS = 10 * 60_000;
const RETRY_WAITS_MS = [2000, 5000, 15_000];
export const PROBE_MAX_BYTES = 256 * 1024;
export const API_MAX_BYTES = 10 * 1024 * 1024;

/** True when this address may be requested for this site at this level. */
export function allowedUrl(access: SiteAccess, url: string, testMode = false): boolean {
  let u: URL;
  let root: URL;
  try {
    u = new URL(url);
    root = new URL(access.site);
  } catch {
    return false;
  }
  const loopback = testMode && root.protocol === "http:" && root.hostname === "127.0.0.1";
  if (!loopback && (root.protocol !== "https:" || root.port)) return false;
  if (u.origin !== root.origin || u.username || u.password || u.hash) return false;
  const base = root.pathname.replace(/\/+$/, "");
  if (!u.pathname.startsWith(`${base}/`)) return false;
  const rest = u.pathname.slice(base.length);
  if (rest.includes("/../") || rest.includes("/./") || rest.includes("\\")) return false;
  if (rest === PROBE) return true;
  if (rest === REST) return access.level !== "probe" && !u.search;
  if (rest.startsWith(FILES)) return access.level === "connected";
  return false;
}

export interface MoodleHttpOptions {
  userAgent: string;
  testMode?: boolean;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface TextAnswer {
  status: number;
  contentType: string;
  text: string;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class MoodleHttp {
  private queues = new Map<string, Promise<unknown>>();
  private lastAt = new Map<string, number>();
  private sleep: (ms: number) => Promise<void>;
  private now: () => number;

  constructor(private o: MoodleHttpOptions) {
    this.sleep = o.sleep ?? realSleep;
    this.now = o.now ?? Date.now;
  }

  private host(access: SiteAccess) {
    return new URL(access.site).host;
  }

  /** One request at a time per host, with a pause after the previous one. */
  private queued<T>(access: SiteAccess, gapMs: number, fn: () => Promise<T>): Promise<T> {
    const host = this.host(access);
    const gap = Math.max(gapMs, access.paceMs ?? 0);
    const run = async () => {
      const wait = (this.lastAt.get(host) ?? 0) + gap - this.now();
      if (wait > 0) await this.sleep(wait);
      try {
        return await fn();
      } finally {
        this.lastAt.set(host, this.now());
      }
    };
    const next = (this.queues.get(host) ?? Promise.resolve()).then(run, run);
    this.queues.set(
      host,
      next.catch(() => {}),
    );
    return next;
  }

  private async send(access: SiteAccess, url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
    if (!allowedUrl(access, url, this.o.testMode)) throw new MoodleError("forbidden", "address");
    const timeout = AbortSignal.timeout(timeoutMs);
    const merged = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const doFetch = this.o.fetch ?? moodleTransport();
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(url, { ...init, redirect: "manual", signal: merged, headers: { ...(init.headers as Record<string, string>), "user-agent": this.o.userAgent } });
      } catch (e) {
        if (signal?.aborted) throw e;
        throw new MoodleError("network", timeout.aborted ? "timeout" : "offline");
      }
      if (res.status === 429 || res.status === 503) {
        await res.body?.cancel().catch(() => {});
        if (attempt >= RETRY_WAITS_MS.length) throw new MoodleError("blocked", `http${res.status}`);
        await this.sleep(RETRY_WAITS_MS[attempt]);
        if (signal?.aborted) throw new DOMException("aborted", "AbortError");
        continue;
      }
      return res;
    }
  }

  /** Reads a body as text, up to `max` bytes. A site can send anything: nothing is read without a limit. */
  async readCapped(res: Response, max: number, signal?: AbortSignal): Promise<string> {
    if (!res.body) return "";
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.length;
        if (size > max) {
          await res.body.cancel().catch(() => {});
          throw new MoodleError("unsupported", "toolarge");
        }
        chunks.push(chunk);
      }
    } catch (e) {
      if (e instanceof MoodleError || signal?.aborted) throw e;
      throw new MoodleError("network", "offline");
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  /**
   * A POST that answers JSON (the probe and the REST endpoint). Redirects end the request.
   * Probes of a site nobody is connected to yet run side by side with a short timeout, so a host
   * that doesn't answer can't hold up the screen or the queue.
   */
  text(access: SiteAccess, url: string, init: { body: string; headers: Record<string, string>; signal?: AbortSignal; maxBytes?: number }): Promise<TextAnswer> {
    const probe = access.level === "probe";
    const run = async () => {
      const res = await this.send(access, url, { method: "POST", body: init.body, headers: init.headers }, probe ? PROBE_TIMEOUT_MS : API_TIMEOUT_MS, init.signal);
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel().catch(() => {});
        // A sign-in gateway or a moved site: there is no API behind this address.
        throw new MoodleError("unavailable", `http${res.status}`);
      }
      const text = await this.readCapped(res, init.maxBytes ?? API_MAX_BYTES, init.signal);
      return { status: res.status, contentType: res.headers.get("content-type") ?? "", text };
    };
    return probe ? run() : this.queued(access, API_PACE_MS, run);
  }

  /**
   * A file download. `consume` reads the body while this site's queue slot is held, so files come
   * one at a time. One redirect on the same host is followed if it still passes the path rule.
   */
  file<T>(access: SiteAccess, url: string, consume: (res: Response) => Promise<T>, signal?: AbortSignal): Promise<T> {
    return this.queued(access, FILE_PACE_MS, async () => {
      let res = await this.send(access, url, { method: "GET" }, FILE_TIMEOUT_MS, signal);
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        const next = location ? new URL(location, url).toString() : "";
        // Files served from separate storage (another host) are not supported: the token never leaves the site.
        if (!next || !allowedUrl(access, next, this.o.testMode)) throw new MoodleError("unsupported", "redirect");
        res = await this.send(access, next, { method: "GET" }, FILE_TIMEOUT_MS, signal);
        if (res.status >= 300 && res.status < 400) {
          await res.body?.cancel().catch(() => {});
          throw new MoodleError("unsupported", "redirect");
        }
      }
      return consume(res);
    });
  }
}
