#!/usr/bin/env node
/**
 * Moodle connection check (research spike, read-only).
 *
 * Answers, against a real Moodle site and a real student login, the questions the Moodle
 * integration design depends on:
 *   1. Does the single sign-on "launch" flow hand a mobile web-service token to a desktop browser?
 *   2. Which URL scheme does the site send back (is `moodlemobile` forced)?
 *   3. Do the three calls every open-source client uses work with that token?
 *   4. Can a course file be fetched with the token, and are the answers readable from a web page (CORS)?
 *
 * Usage:  node scripts/moodle-check.mjs [site URL]     (default: https://moodle.runi.ac.il/2027)
 *
 * You sign in yourself, in your own browser. This script never sees your password. The token you
 * paste is kept in memory only: it is not printed, not written to disk, and sent only to the site
 * you named. Nothing is changed on Moodle and no file is saved.
 */
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import readline from "node:readline";

const base = (process.argv[2] ?? "https://moodle.runi.ac.il/2027").replace(/\/+$/, "");
const SERVICE = "moodle_mobile_app";
const REQUESTED_SCHEME = "web+tutorai"; // if the site returns another scheme, it forces its own
const COURSES_TO_SCAN = Number(process.env.MOODLE_CHECK_COURSES ?? 3);
const HEADERS = { "User-Agent": "tutorai-moodle-check", Origin: "https://example.org" };
const NEEDED = [
  "core_webservice_get_site_info",
  "core_enrol_get_users_courses",
  "core_course_get_contents",
  "core_course_get_updates_since",
  "mod_assign_get_assignments",
  "core_calendar_get_action_events_by_timesort",
];

const results = [];
const note = (ok, label, detail = "") => {
  results.push({ ok, label, detail });
  console.log(`${ok === true ? "[ok]" : ok === false ? "[!!]" : "[--]"} ${label}${detail ? ": " + detail : ""}`);
};
const fail = (msg) => {
  console.error(`\nStopped: ${msg}`);
  process.exit(1);
};

if (!/^https:\/\//.test(base) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(base)) {
  fail("the site URL must start with https://");
}

class WsError extends Error {
  constructor(fn, code, message) {
    super(`${fn}: ${code} (${message})`);
    this.code = code;
  }
}

function flatten(prefix, value, out) {
  if (Array.isArray(value)) value.forEach((v, i) => flatten(`${prefix}[${i}]`, v, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) flatten(`${prefix}[${k}]`, v, out);
  else out.append(prefix, String(value));
}

async function ws(token, fn, params = {}) {
  const body = new URLSearchParams({ wstoken: token, wsfunction: fn, moodlewsrestformat: "json", moodlewssettingfilter: "true", moodlewssettinglang: "he" });
  for (const [k, v] of Object.entries(params)) flatten(k, v, body);
  const t0 = performance.now();
  const res = await fetch(`${base}/webservice/rest/server.php`, { method: "POST", body, headers: HEADERS });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${fn}: the answer was not JSON (HTTP ${res.status})`);
  }
  if (data && data.exception) throw new WsError(fn, data.errorcode, data.message);
  return { data, ms, cors: res.headers.get("access-control-allow-origin") };
}

async function publicConfig() {
  const res = await fetch(`${base}/lib/ajax/service-nologin.php?info=tool_mobile_get_public_config`, {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify([{ index: 0, methodname: "tool_mobile_get_public_config", args: {} }]),
  });
  const json = await res.json();
  if (!Array.isArray(json) || json[0]?.error) throw new Error("the site did not return its public configuration");
  return json[0].data;
}

/** Reads one line without showing it (the pasted link contains the token). */
function readHidden(prompt) {
  process.stdout.write(prompt);
  if (!process.stdin.isTTY) {
    // Piped input (tests): one line per call, from one shared reader so no line is lost.
    pipedLines ??= readline.createInterface({ input: process.stdin })[Symbol.asyncIterator]();
    return pipedLines.next().then((r) => (r.done ? fail("no input.") : r.value));
  }
  return new Promise((resolve) => {
    let buf = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const onData = (chunk) => {
      const chars = [...chunk];
      for (const [i, ch] of chars.entries()) {
        if (ch === "\u0003") {
          process.stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\r" || ch === "\n") {
          // A line break in the middle of a paste is part of the paste; only a final one is Enter.
          if (i < chars.length - 1) buf += "\n";
          else if (buf.trim()) {
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.off("data", onData);
            process.stdout.write(`(received ${buf.trim().length} characters, hidden)\n`);
            return resolve(buf);
          }
        } else if (ch === "\u007f") buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    process.stdin.on("data", onData);
  });
}
let pipedLines;

function openInBrowser(url) {
  if (process.env.NO_OPEN) return;
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    /* the URL is printed as well */
  }
}

const md5 = (s) => createHash("md5").update(s).digest("hex");
const human = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

// ---------------------------------------------------------------------------------------------

console.log(`Moodle connection check for ${base}\n`);

// 1. What the site says about itself, before any login.
const cfg = await publicConfig().catch((e) => fail(e.message));
const loginKinds = { 1: "username and password in the app", 2: "single sign-on in the browser", 3: "single sign-on in an embedded browser" };
note(null, "Site", `${cfg.sitename ?? "?"} (${cfg.wwwroot})`);
note(Boolean(cfg.enablewebservices && cfg.enablemobilewebservice), "Mobile web service enabled");
note(null, "Login type", loginKinds[cfg.typeoflogin] ?? String(cfg.typeoflogin));
if (!cfg.enablemobilewebservice) fail("this site has the mobile service turned off, so there is no token to get.");

// 2. Sign in through the site's own launch page and bring the link back.
const passport = randomBytes(8).toString("hex");
const launch = new URL(cfg.launchurl || `${base}/admin/tool/mobile/launch.php`);
launch.search = new URLSearchParams({ service: SERVICE, passport, urlscheme: REQUESTED_SCHEME, confirmed: "1" }).toString();

console.log(`
Step 1. Your browser opens the page below. Sign in as you always do.
        ${launch}

Step 2. After signing in you get a Moodle page with one link in a box
        ("click here to launch the app"; the wording may be in Hebrew).
        Your browser may say it can't open the link. That is expected.
        If you land on the Moodle home page instead, open the link above again.

Step 3. Right-click that link, choose "Copy Link Address", come back here,
        paste (Cmd+V / Ctrl+V) and press Enter. The paste is not shown.
`);
openInBrowser(launch.toString());

/** Finds "<scheme>://token=<base64>" anywhere in the pasted text (also when percent-encoded). */
function findLaunchLink(text) {
  const candidates = [text];
  try {
    candidates.push(decodeURIComponent(text));
  } catch {
    /* not percent-encoded */
  }
  for (const c of candidates) {
    const m = c.match(/([a-zA-Z][a-zA-Z0-9+.-]*):\/\/token=([A-Za-z0-9+/=_-]+)/);
    if (!m) continue;
    const parts = Buffer.from(m[2], "base64").toString("utf8").split(":::");
    if (parts.length >= 2 && /^[a-f0-9]{32}$/.test(parts[0]) && parts[1]) return { scheme: m[1], parts };
  }
  return null;
}

/** Says what was pasted without showing any secret: host, masked path and parameter NAMES only. */
function describePaste(text) {
  const lines = text.split(/\r?\n/).length;
  let shape = `${text.length} characters${lines > 1 ? `, ${lines} lines` : ""}`;
  let hint = "";
  try {
    const u = new URL(text);
    const path = u.pathname.replace(/[A-Za-z0-9_-]{20,}/g, "…").slice(0, 70);
    shape += `; a link to ${u.protocol}//${u.host}${path}`;
    const names = [...new Set(u.searchParams.keys())];
    if (names.length) shape += ` with parameters: ${names.join(", ")}`;
    if (u.hash) shape += " and a # part";
    if (u.pathname.endsWith("/launch.php")) hint = "That is the address of the page itself. Copy the link INSIDE the page (right-click the link in the box).";
    else if (u.host !== new URL(base).host) hint = "That address is on the sign-in server, so the sign-in has not finished yet.";
    else hint = "That is another Moodle page. Open the launch link from Step 1 again, now that you are signed in.";
  } catch {
    shape += "; not a single link";
  }
  console.log(`\n[!!] Not the launch link (${shape}).`);
  if (hint) console.log(`     ${hint}`);
}

let found = null;
for (let attempt = 1; attempt <= 4 && !found; attempt++) {
  const pasted = (await readHidden(attempt === 1 ? "Paste the link here: " : "Try again, paste the link here: ")).trim();
  found = findLaunchLink(pasted);
  if (!found) describePaste(pasted);
}
if (!found) fail('no launch link was pasted. It looks like "moodlemobile://token=…".');
const { scheme } = found;
const [siteId, token, privateToken] = found.parts;

console.log("");
note(true, "Sign-on returned a token to a desktop browser");
note(
  scheme.toLowerCase() === REQUESTED_SCHEME ? true : null,
  "URL scheme the site sent back",
  scheme.toLowerCase() === REQUESTED_SCHEME
    ? `${scheme} (the site accepts any app's scheme, so a web page can catch the link by itself)`
    : `${scheme} (we asked for ${REQUESTED_SCHEME}, so the site forces its own scheme)`,
);
const expected = [cfg.wwwroot, cfg.httpswwwroot, base].filter(Boolean).map((root) => md5(root + passport));
note(expected.includes(siteId), "Link belongs to this run (site + passport check)", expected.includes(siteId) ? "" : "mismatch: was this link copied from an earlier run?");
note(null, "Private token included", privateToken ? "yes (not needed, discarded)" : "no");

// 3. The three calls every client uses.
let info;
try {
  const r = await ws(token, "core_webservice_get_site_info");
  info = r.data;
  note(true, "core_webservice_get_site_info", `Moodle ${info.release ?? "?"}, ${r.ms} ms`);
  note(r.cors === "*", "API answers are readable from a web page (CORS)", `Access-Control-Allow-Origin: ${r.cors ?? "none"}`);
} catch (e) {
  note(false, "core_webservice_get_site_info", e.message);
  fail("the token was not accepted.");
}
const available = new Set((info.functions ?? []).map((f) => f.name));
const missing = NEEDED.filter((n) => !available.has(n));
note(missing.length === 0, "Functions the sync needs", missing.length ? `missing: ${missing.join(", ")}` : `all ${NEEDED.length} available (${available.size} in total)`);
note(Boolean(info.downloadfiles), "File download allowed for this service");

let courses = [];
try {
  const r = await ws(token, "core_enrol_get_users_courses", { userid: info.userid });
  courses = r.data;
  note(true, "core_enrol_get_users_courses", `${courses.length} courses, ${r.ms} ms`);
  for (const c of courses.slice(0, 12)) console.log(`       - ${c.fullname}`);
  if (courses.length > 12) console.log(`       … and ${courses.length - 12} more`);
} catch (e) {
  note(false, "core_enrol_get_users_courses", e.message);
}

let sample;
for (const course of courses.slice(0, COURSES_TO_SCAN)) {
  try {
    const r = await ws(token, "core_course_get_contents", { courseid: course.id });
    const kinds = {};
    const types = {};
    let files = 0;
    let bytes = 0;
    for (const section of r.data) {
      for (const mod of section.modules ?? []) {
        kinds[mod.modname] = (kinds[mod.modname] ?? 0) + 1;
        for (const f of mod.contents ?? []) {
          if (f.type !== "file" || !f.fileurl) continue;
          files++;
          bytes += f.filesize ?? 0;
          const ext = (f.filename?.split(".").pop() ?? "?").toLowerCase();
          types[ext] = (types[ext] ?? 0) + 1;
          if (!sample || (ext === "pdf" && sample.ext !== "pdf")) sample = { url: f.fileurl, ext, hasModified: Boolean(f.timemodified) };
        }
      }
    }
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(", ");
    note(true, `core_course_get_contents: ${course.shortname ?? course.id}`, `${r.data.length} sections, ${files} files (${human(bytes)}), ${r.ms} ms`);
    console.log(`       activities: ${top(kinds) || "none"}`);
    console.log(`       file types: ${top(types) || "none"}`);
  } catch (e) {
    note(false, `core_course_get_contents: ${course.shortname ?? course.id}`, e.message);
  }
}

// 4. One file: read the first bytes only, keep nothing.
if (sample) {
  try {
    const url = new URL(sample.url);
    note(url.pathname.includes("/webservice/pluginfile.php"), "File links use the token endpoint", url.pathname.split("/").slice(0, -3).join("/").replace(/\/\d+/g, "/…"));
    note(sample.hasModified, "Files carry a last-modified time (for change detection)");
    url.searchParams.set("token", token);
    const res = await fetch(url, { headers: { ...HEADERS, Range: "bytes=0-1023" } });
    const reader = res.body.getReader();
    const first = (await reader.read()).value ?? new Uint8Array();
    await reader.cancel().catch(() => {});
    const looksRight = sample.ext !== "pdf" || Buffer.from(first.slice(0, 4)).toString("latin1") === "%PDF";
    note(res.ok && looksRight, `File download (.${sample.ext}, first bytes only)`, `HTTP ${res.status}, ${res.headers.get("content-type") ?? "?"}${looksRight ? "" : ", but the content is not the file (a login or challenge page?)"}`);
    note(res.headers.get("access-control-allow-origin") === "*", "Files are readable from a web page (CORS)", `Access-Control-Allow-Origin: ${res.headers.get("access-control-allow-origin") ?? "none"}`);
  } catch (e) {
    note(false, "File download", e.message);
  }
} else {
  note(null, "File download", "no file found in the scanned courses");
}

const bad = results.filter((r) => r.ok === false);
console.log(`\nRESULT: ${bad.length === 0 ? "everything the design relies on works on this site." : `${bad.length} check(s) failed: ${bad.map((r) => r.label).join("; ")}`}`);
console.log("The token was kept in memory only and is now gone. To cancel it on Moodle: Preferences → Security keys → Reset.");
process.exit(bad.length ? 1 : 0); // open connections and the input stream would otherwise keep the process alive
