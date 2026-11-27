import { PublicConfig } from "./schemas.ts";

/**
 * Nothing a site says about itself is trusted until it matches the address we probed
 * (docs/rfc-moodle.md §5.2). A hostile or mistyped address must not be able to impersonate
 * another site or put a script address into TutorAI's page.
 */

export const MAX_SITE_NAME = 80;
const LAUNCH_SUFFIX = "/tool/mobile/launch.php";

export interface ValidatedSite {
  /** The site key: the validated wwwroot, lower-case host, no trailing slash. */
  site: string;
  /** ASCII host, for display. */
  host: string;
  siteName: string;
  /** The validated launch page, or null when the site reports none. */
  launchUrl: string | null;
  /** Roots the site-id check accepts (wwwroot and httpswwwroot). */
  wwwroots: string[];
  config: PublicConfig;
}

export interface ValidateOptions {
  /** Tests only: allow http://127.0.0.1:<port> (the mock). */
  allowLocal?: boolean;
}

const isLoopbackHttp = (u: URL) => u.protocol === "http:" && u.hostname === "127.0.0.1";

function parseSiteUrl(raw: string, opts: ValidateOptions): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.username || u.password || u.search || u.hash) return null;
  if (opts.allowLocal && isLoopbackHttp(u)) return u;
  if (u.protocol !== "https:" || u.port) return null;
  return u;
}

const trimSlash = (p: string) => p.replace(/\/+$/, "");
const siteKey = (u: URL) => `${u.protocol}//${u.host.toLowerCase()}${trimSlash(u.pathname)}`;

/** True when `path` is `base` or lies under it, on a segment boundary. */
const under = (path: string, base: string) => {
  const b = trimSlash(base);
  return path === b || path.startsWith(`${b}/`);
};

/**
 * Checks a public configuration against the address that was probed. Returns null when the
 * configuration must not be used.
 */
export function validateSite(candidate: string, raw: unknown, opts: ValidateOptions = {}): ValidatedSite | null {
  const parsed = PublicConfig.safeParse(raw);
  if (!parsed.success) return null;
  const config = parsed.data;
  const cand = parseSiteUrl(candidate, opts);
  const root = parseSiteUrl(config.wwwroot, opts);
  if (!cand || !root) return null;
  // Same host, and the reported root is the candidate or an ancestor of it.
  if (root.host.toLowerCase() !== cand.host.toLowerCase() || root.protocol !== cand.protocol) return null;
  if (!under(trimSlash(cand.pathname), root.pathname)) return null;

  let launchUrl: string | null = null;
  if (config.launchurl) {
    const l = parseSiteUrl(config.launchurl, opts);
    if (!l || l.origin !== root.origin) return null;
    if (!under(l.pathname, root.pathname) || !l.pathname.endsWith(LAUNCH_SUFFIX)) return null;
    launchUrl = `${l.origin}${l.pathname}`;
  }

  const wwwroots = [siteKey(root)];
  if (config.httpswwwroot) {
    const h = parseSiteUrl(config.httpswwwroot, opts);
    if (h && h.host.toLowerCase() === root.host.toLowerCase() && !wwwroots.includes(siteKey(h))) wwwroots.push(siteKey(h));
  }
  return {
    site: siteKey(root),
    host: root.host.toLowerCase(),
    siteName: config.sitename.replace(/\s+/g, " ").trim().slice(0, MAX_SITE_NAME),
    launchUrl,
    wwwroots,
    config,
  };
}

export type MoodleLoginKind = "sso" | "unavailable";
export type UnavailableReason = "disabled" | "mobile_off" | "maintenance" | "password_only";

/**
 * What a validated site offers. v1 connects only through the site's own sign-in page (SSO);
 * a site that signs in inside the app (typeoflogin 1) is reported as not supported yet.
 */
export function classify(site: ValidatedSite): { login: MoodleLoginKind; reason?: UnavailableReason } {
  const c = site.config;
  if (!c.enablewebservices || !c.enablemobilewebservice) return { login: "unavailable", reason: "mobile_off" };
  if (c.maintenanceenabled) return { login: "unavailable", reason: "maintenance" };
  if ((c.typeoflogin === 2 || c.typeoflogin === 3) && site.launchUrl) return { login: "sso" };
  return { login: "unavailable", reason: "password_only" };
}

/** The only addresses the sign-in button may open. Server and page both apply this. */
export function isSafeLaunchUrl(url: string, testMode = false): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.username || u.password || u.hash) return false;
  if (testMode && isLoopbackHttp(u)) return true;
  return u.protocol === "https:" && !u.port;
}

/** Builds the sign-in address from a validated launch page (never by joining strings). */
export function buildLaunchUrl(launchUrl: string, passport: string): string {
  const u = new URL(launchUrl);
  u.searchParams.set("service", "moodle_mobile_app");
  u.searchParams.set("passport", passport);
  u.searchParams.set("urlscheme", "moodlemobile");
  u.searchParams.set("confirmed", "1");
  return u.toString();
}
