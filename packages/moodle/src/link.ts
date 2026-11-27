/**
 * The link Moodle's launch page hands back after sign-in: `<scheme>://token=<base64>`, where the
 * payload is `md5(wwwroot + passport):::token[:::privatetoken]` (docs/rfc-moodle.md §6.4).
 */

export const MAX_LINK_LENGTH = 1024;
/** What `tutorai moodle-link` accepts as its one argument. */
export const LINK_ARGUMENT = /^moodlemobile:\/\/token=(?:[A-Za-z0-9+/=_-]|%[0-9A-Fa-f]{2})+[/#]?$/;

export interface LaunchLink {
  scheme: string;
  /** The site-and-passport hash Moodle computed. */
  siteId: string;
  token: string;
}

const LINK = /([a-zA-Z][a-zA-Z0-9+.-]*):\/\/token=([A-Za-z0-9+/=_-]+)/;

function decodeBase64(b64: string): string | null {
  try {
    const std = b64.replace(/-/g, "+").replace(/_/g, "/");
    return atob(std);
  } catch {
    return null;
  }
}

/** Finds a launch link anywhere in the text, also when it is percent-encoded. */
export function findLaunchLink(text: string): LaunchLink | null {
  const candidates = [text];
  try {
    candidates.push(decodeURIComponent(text));
  } catch {
    /* not percent-encoded */
  }
  for (const c of candidates) {
    const m = c.match(LINK);
    if (!m) continue;
    // The address may end with "/" (some browsers add it), which is also a base64 character.
    for (const b64 of new Set([m[2], m[2].replace(/\/+$/, "")])) {
      const parts = (decodeBase64(b64) ?? "").split(":::");
      if (parts.length >= 2 && /^[a-f0-9]{32}$/.test(parts[0]) && /^[A-Za-z0-9]{8,128}$/.test(parts[1])) return { scheme: m[1].toLowerCase(), siteId: parts[0], token: parts[1] };
    }
  }
  return null;
}

/** The hashes a link for this sign-in may carry. `md5` returns lower-case hex. */
export const expectedSiteIds = (wwwroots: string[], passport: string, md5: (s: string) => string) => wwwroots.map((root) => md5(root + passport));

export type PasteHint = "page_address" | "signin_address" | "other_moodle_page" | "not_a_link";

/** Says what a wrong paste was, as a code only: nothing of the text itself is kept or returned. */
export function describePaste(text: string, site: string): PasteHint {
  let u: URL;
  try {
    u = new URL(text.trim());
  } catch {
    return "not_a_link";
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "not_a_link";
  if (u.pathname.endsWith("/launch.php")) return "page_address";
  try {
    if (u.host.toLowerCase() !== new URL(site).host.toLowerCase()) return "signin_address";
  } catch {
    return "not_a_link";
  }
  return "other_moodle_page";
}
