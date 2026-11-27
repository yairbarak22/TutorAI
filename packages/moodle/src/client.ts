import { z } from "zod";
import { type MoodleErrorKind, RawContents, RawCourse, type RemoteCourse, SiteInfo } from "./schemas.ts";

/** The three calls every Moodle client uses, plus the settings that make names single-language. */
export const NEEDED_FUNCTIONS = ["core_webservice_get_site_info", "core_enrol_get_users_courses", "core_course_get_contents"] as const;

export class MoodleError extends Error {
  constructor(
    public kind: MoodleErrorKind,
    /** Moodle's own error code, for the log. Never shown to the student. */
    public code = "",
  ) {
    super(code ? `moodle: ${kind} (${code})` : `moodle: ${kind}`);
  }
}

/** A minimal fetch: the server passes one bound to a site, with its host, path and pacing rules. */
export type MoodleFetch = (url: string, init: { method: "POST"; body: string; headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ status: number; contentType: string; text: string }>;

const AUTH = new Set(["invalidtoken", "wsaccessusersuspended", "wsaccessuserdeleted", "wsaccessuserexpired", "wsaccessusernologin", "wsaccessuserunconfirmed"]);
const POLICY = new Set(["sitepolicynotagreed", "usernotfullysetup", "forcepasswordchangenotice", "passwordisexpired"]);
const FORBIDDEN = new Set(["nopermissions", "requireloginerror", "notingroup", "coursehidden", "errorcoursecontextnotvalid"]);
const UNAVAILABLE = new Set(["sitemaintenance", "upgraderunning", "enablewsdescription", "servicenotavailable"]);

/** Maps a Moodle error code (and message, for the one case that needs it) to a kind. */
export function errorKind(code: string, message = ""): MoodleErrorKind {
  if (AUTH.has(code)) return "auth";
  // An expired token answers "accessexception" with this text once, then "invalidtoken".
  if (code === "accessexception") return /token/i.test(message) ? "auth" : "forbidden";
  if (POLICY.has(code)) return "policy";
  if (FORBIDDEN.has(code)) return "forbidden";
  if (UNAVAILABLE.has(code)) return "unavailable";
  if (code === "invalidrecord" || code === "invalidparameter") return "unsupported";
  return "other";
}

/**
 * Reads a JSON answer from Moodle. Errors come in two shapes: REST `{ exception, errorcode, message }`
 * and, from token.php and pluginfile.php, `{ error, errorcode }`. HTML where JSON was expected is a
 * challenge or sign-in page.
 */
export function parseAnswer(answer: { status: number; contentType: string; text: string }): unknown {
  const text = answer.text.trimStart();
  if (text.startsWith("<")) throw new MoodleError("blocked", `http${answer.status}`);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new MoodleError(answer.status >= 500 ? "unavailable" : "unsupported", `http${answer.status}`);
  }
  const err = moodleErrorOf(data);
  if (err) throw err;
  return data;
}

/** The error a JSON body describes, in either shape, or null. */
export function moodleErrorOf(data: unknown): MoodleError | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.exception === "string" || (typeof d.error === "string" && typeof d.errorcode === "string")) {
    // The site writes this string: keep it only when it looks like one of Moodle's codes.
    const code = typeof d.errorcode === "string" && /^[A-Za-z0-9_]{1,64}$/.test(d.errorcode) ? d.errorcode : "unknown";
    const message = typeof d.message === "string" ? d.message : typeof d.error === "string" ? d.error : "";
    return new MoodleError(errorKind(code, message), code);
  }
  return null;
}

function flatten(prefix: string, value: unknown, out: URLSearchParams) {
  if (Array.isArray(value)) value.forEach((v, i) => flatten(`${prefix}[${i}]`, v, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) flatten(`${prefix}[${k}]`, v, out);
  else out.append(prefix, String(value));
}

export interface ClientOptions {
  /** The site key (validated wwwroot). */
  site: string;
  token: string;
  lang: "he" | "en";
  fetch: MoodleFetch;
  signal?: AbortSignal;
}

export class MoodleClient {
  constructor(private o: ClientOptions) {}

  private async call<S extends z.ZodType>(fn: string, params: Record<string, unknown>, schema: S): Promise<z.infer<S>> {
    const body = new URLSearchParams({
      wstoken: this.o.token,
      wsfunction: fn,
      moodlewsrestformat: "json",
      moodlewssettingfilter: "true",
      moodlewssettinglang: this.o.lang,
    });
    for (const [k, v] of Object.entries(params)) flatten(k, v, body);
    const answer = await this.o.fetch(`${this.o.site}/webservice/rest/server.php`, {
      method: "POST",
      body: body.toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      signal: this.o.signal,
    });
    const parsed = schema.safeParse(parseAnswer(answer));
    if (!parsed.success) throw new MoodleError("unsupported", `shape:${fn}`);
    return parsed.data;
  }

  siteInfo(): Promise<SiteInfo> {
    return this.call("core_webservice_get_site_info", {}, SiteInfo);
  }

  async courses(userId: number): Promise<RemoteCourse[]> {
    const raw = await this.call("core_enrol_get_users_courses", { userid: userId, returnusercount: 0 }, z.array(RawCourse));
    return raw.map((c) => ({
      id: c.id,
      shortname: c.shortname,
      fullname: c.fullname,
      displayname: c.displayname || c.fullname || c.shortname,
      startdate: c.startdate,
      enddate: c.enddate,
      hidden: c.hidden,
      lastaccess: c.lastaccess ?? null,
    }));
  }

  contents(courseId: number): Promise<RawContents> {
    return this.call("core_course_get_contents", { courseid: courseId }, RawContents);
  }
}

/** True when the site offers the calls we need. */
export const hasNeededFunctions = (info: SiteInfo) => {
  const names = new Set(info.functions.map((f) => f.name));
  return NEEDED_FUNCTIONS.every((n) => names.has(n));
};
