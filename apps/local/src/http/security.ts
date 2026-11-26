import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { CSRF_HEADER, SESSION_COOKIE } from "@tutorai/local-api";

/**
 * Localhost security (RFC §4.2). Any website the student visits can send requests to
 * 127.0.0.1, and a DNS-rebinding page can even look same-origin. Every /api request must:
 *  - name our exact host (blocks DNS rebinding),
 *  - come from our own page (Origin, or Sec-Fetch-Site when browsers omit Origin),
 *  - carry the session cookie (issued only from a one-time code the launcher opens),
 *  - and, if it changes anything, carry the X-TutorAI header (forces a CORS preflight we never answer).
 */

export const SESSION_MAX_AGE_S = 30 * 24 * 3600;
const CODE_TTL_MS = 60_000;
const MAX_CODES = 20;

export type Verdict = { status: number; message: string } | null;

const b64 = (b: Buffer) => b.toString("base64url");

export class Security {
  private codes = new Map<string, number>();
  readonly controlSecret = b64(randomBytes(32));

  constructor(
    private key: Buffer,
    public port: number,
    private now: () => number = Date.now,
  ) {}

  /**
   * The per-install API token the page sends in X-TutorAI on every request. It reaches the page only
   * through the /open redirect's URL fragment (never sent to any server) and lives in this origin's
   * storage, so another server on 127.0.0.1 that receives our cookie still can't use the API.
   */
  get apiToken() {
    return b64(createHmac("sha256", this.key).update("tutorai-api-token").digest());
  }

  get origin() {
    return `http://127.0.0.1:${this.port}`;
  }

  /* ---------- one-time codes (launcher → browser) ---------- */

  issueCode(): string {
    const t = this.now();
    for (const [c, exp] of this.codes) if (exp < t) this.codes.delete(c);
    while (this.codes.size >= MAX_CODES) this.codes.delete(this.codes.keys().next().value!);
    const code = b64(randomBytes(32));
    this.codes.set(code, t + CODE_TTL_MS);
    return code;
  }

  redeemCode(code: string | null): boolean {
    if (!code) return false;
    const exp = this.codes.get(code);
    this.codes.delete(code);
    return exp !== undefined && exp >= this.now();
  }

  /* ---------- session cookie (survives restarts: HMAC with a key on disk) ---------- */

  private sign(issuedAt: string) {
    return b64(createHmac("sha256", this.key).update(`tutorai-session:${issuedAt}`).digest());
  }

  newSessionCookie(): string {
    const issuedAt = String(Math.floor(this.now() / 1000));
    const value = `${issuedAt}.${this.sign(issuedAt)}`;
    return `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE_S}`;
  }

  validSession(cookieHeader: string | undefined): boolean {
    const value = parseCookies(cookieHeader)[SESSION_COOKIE];
    if (!value) return false;
    const [issuedAt, sig] = value.split(".");
    if (!issuedAt || !sig || !/^\d+$/.test(issuedAt)) return false;
    const age = this.now() / 1000 - Number(issuedAt);
    if (age < -60 || age > SESSION_MAX_AGE_S) return false;
    const want = Buffer.from(this.sign(issuedAt));
    const got = Buffer.from(sig);
    return want.length === got.length && timingSafeEqual(want, got);
  }

  /* ---------- request checks ---------- */

  /** Host must be exactly ours. "localhost" is answered with a redirect to 127.0.0.1 (one origin). */
  checkHost(host: string | undefined): "ok" | "redirect" | "bad" {
    if (host === `127.0.0.1:${this.port}`) return "ok";
    if (host === `localhost:${this.port}`) return "redirect";
    return "bad";
  }

  /** Our own page only. Browsers omit Origin on same-origin GET/HEAD, so then use Sec-Fetch-Site. */
  sameOrigin(req: IncomingMessage): boolean {
    const origin = header(req, "origin");
    if (origin !== undefined) return origin === this.origin;
    const site = header(req, "sec-fetch-site");
    // "same-site" would include any page on another 127.0.0.1 port (cookies ignore ports).
    // No header at all: a non-browser client on this machine, which can't hold the cookie anyway.
    return site === undefined || site === "same-origin" || site === "none";
  }

  /** Checks for /api/*. Returns null when the request may proceed. */
  guardApi(req: IncomingMessage): Verdict {
    if (!this.sameOrigin(req)) return { status: 403, message: "Forbidden origin" };
    if (!this.validSession(header(req, "cookie"))) return { status: 401, message: "Open TutorAI from its icon" };
    const got = Buffer.from(header(req, CSRF_HEADER) ?? "");
    const want = Buffer.from(this.apiToken);
    if (got.length !== want.length || !timingSafeEqual(got, want)) return { status: 403, message: "Missing request token" };
    return null;
  }

  /** Answers the launcher's challenge, so it knows it reached the server it started (not a squatter). */
  proof(nonce: string) {
    return b64(createHmac("sha256", this.controlSecret).update(`tutorai-control:${nonce}`).digest());
  }

  /** Checks for /control/* (the launcher on this machine): the secret from run.json, nothing else. */
  guardControl(req: IncomingMessage): Verdict {
    if (header(req, "origin") !== undefined) return { status: 403, message: "Forbidden" };
    const auth = header(req, "authorization") ?? "";
    const want = Buffer.from(`Bearer ${this.controlSecret}`);
    const got = Buffer.from(auth);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return { status: 401, message: "Unauthorized" };
    return null;
  }
}

export function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

export function parseCookies(h: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (h ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** Headers on every response. */
export const BASE_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "SAMEORIGIN",
};
