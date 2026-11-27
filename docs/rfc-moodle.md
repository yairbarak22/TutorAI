# RFC: Connect your Moodle — import course materials with one sign-in

Status: **accepted; the first version is implemented for Reichman University** (what was built: [impl-moodle.md](impl-moodle.md#status)) · Owner: core maintainers · Scope: new `packages/moodle`, new code in `apps/local` and `apps/web`, a schema change in `packages/core`, docs and security rules

Build plan: [impl-moodle.md](impl-moodle.md). Institutions: [Appendix A](#appendix-a-institutions).

## 1. Summary

A student connects TutorAI to their institution's Moodle by signing in the way they always do, about once a semester. TutorAI then lists their courses, shows the files in each course, and imports the ones the student picks into the existing ingestion pipeline. Later it tells them when new files appear.

- It uses **Moodle's own mobile web service**, the API the official Moodle app uses, with the student's personal token. Every mature open-source Moodle client does the same.
- It runs in **TutorAI Local** (the program on the student's computer). The token stays in `~/.tutorai`, never in the browser and never in `tutorai.db`.
- It works at any institution whose Moodle has the mobile service turned on: 37 of the 59 Israeli institutions surveyed (Appendix A). There is no per-institution code. A small registry holds names and addresses, and the site's own public configuration decides the sign-in path.
- **Still true after this change:** no TutorAI server on the internet, no telemetry, course files only on the student's computer.

### What the student sees

1. Home → **"Import from Moodle"** → pick the institution from a list.
2. **"Sign in to Moodle"** opens a tab with the institution's normal sign-in page. After signing in, the browser asks "Open TutorAI?" and the app shows "Connected as …". Where the automatic hand-back isn't possible, the student copies one link and pastes it.
3. Pick courses → for each, a list of its files with checkboxes → **Import**. The files are downloaded to the data folder and analyzed like uploaded files.
4. Next visits: "3 new files in Moodle" on the course's Materials tab.

### Scope of the first version

The maintainer decided (2026-11-27) that the first version is **Reichman University only**. This document describes the whole design, so that other institutions can follow; the parts below are **not built yet**:

| In the first version | Designed here, not built yet |
|---|---|
| Reichman (single sign-on) in the registry | The other institutions of Appendix A |
| Sign-in through the institution's page; one-click hand-back on macOS; copy-and-paste everywhere | The Windows handler (§6.3); the password form (§6.5), which Reichman does not need |
| Institutions from the registry | Pasting another Moodle's address (§5.2), and with it the public-address rule |
| Course list, file list, import, "new files" notice, expiry and reconnect, disconnect | Deadlines, text pages, automatic import (§14) |

Everything in §11 (security) applies to the first version as written.

## 2. Facts this design rests on

Everything here was checked on 2026-11-27. "Source" rows refer to `moodle/moodle` at `main` (`7e0fe78`).

| # | Fact | How it was checked |
|---|---|---|
| F1 | A token for the `moodle_mobile_app` service plus three calls gives everything needed: `core_webservice_get_site_info`, `core_enrol_get_users_courses`, `core_course_get_contents`. Files are fetched from the returned `fileurl` with `token=` added. | Source; Moodle-DL, edu-sync, syncMyMoodle and the Moodle MCP servers all do exactly this |
| F2 | Every Moodle answers `tool_mobile_get_public_config` **without login** at `lib/ajax/service-nologin.php`: `wwwroot`, `sitename`, `enablewebservices`, `enablemobilewebservice`, `typeoflogin` (1 in-app, 2 browser SSO, 3 embedded-browser SSO), `launchurl`, `identityproviders`. These values come from the site and are **untrusted** until checked (§5.2). | Live, 59 Israeli sites |
| F3 | SSO sign-in: `…/tool/mobile/launch.php?service=…&passport=…&urlscheme=…` signs the user in and then redirects to **`<scheme>://token=<base64>`**, never to an http(s) address. The payload is `md5(wwwroot + passport):::token[:::privatetoken]`. | Source `launch.php` L93-116 |
| F4 | `tool_mobile/forcedurlscheme` **defaults to `moodlemobile`** and overrides the requested scheme. Reichman returned `moodlemobile` when asked for `web+tutorai`. | Source `settings.php` L516-521; live at Reichman |
| F5 | With `confirmed=1` (or an iOS browser) `launch.php` returns a page with a visible link to that address and clicks it by script; otherwise a 302. | Source `launch.php` L121-150. How each desktop browser shows that page when nothing handles the link: **not yet checked** (S2) |
| F6 | In-app sign-in (sites with `typeoflogin` 1): POST `login/token.php` (`username`, `password`, `service`). It answers `invalidlogin` for accounts that exist only through an identity provider. | Source `login/token.php`; README of Faixiang/Moodle-MCP |
| F7 | A token is valid for `tokenduration` (default **12 weeks**) from its creation, not sliding. An existing valid token is reused, so the token TutorAI receives is the official app's too and **may already be weeks old**. An expired token answers `accessexception` once, then `invalidtoken`. | Source `lib/external/classes/util.php` L370-431, `webservice/lib.php` L1140-1151 |
| F8 | REST and file endpoints send `Access-Control-Allow-Origin: *`. **Reichman's proxy adds a second value** on `webservice/pluginfile.php`, so a web page there can call the API but cannot read file bytes. Ten other sites send a single `*`. | Source; live headers; a real Chromium page |
| F9 | QR login and `tool_mobile_get_autologin_key` require a `MoodleMobile` User-Agent. | Source `admin/tool/mobile/classes/external.php` L316, L658 |
| F10 | `core_course_get_contents` is **not** callable through the browser session (`lib/ajax/service.php`); it has no `ajax => true`. An extension riding the session must scrape HTML to find files. | Source `lib/db/services.php` |
| F11 | Reichman end to end with a real student login, by copy-and-paste in the maintainer's browser: SSO returned a token to a desktop browser, Moodle 4.5.16, all needed functions present, 5 courses, contents and a PDF download worked, about 140 ms per call. The first paste was the wrong text. | `scripts/moodle-check.mjs`, run by the maintainer |
| F12 | macOS: an AppleScript applet built with tools that ship with macOS (`osacompile`, `plutil`, ad-hoc `codesign`, `lsregister`) receives `moodlemobile://…` from the system and from Chromium, writes it to a private file and runs a command. Build and registration take about 0.2 s. It must live in an Applications folder (a temp folder is not registered). A shell-script bundle like today's `TutorAI.app` is launched **without** the URL. | Spike on macOS 27.2.1 arm64; test apps removed |
| F13 | REST accepts `moodlewssettingfilter` and `moodlewssettinglang`, which apply Moodle's text filters (including multi-language) in a chosen language. Reichman course names came back with Hebrew and English joined when these were not sent. | Source `webservice/lib.php` L1188-1215; live at Reichman. **Effect not yet verified** (S3) |
| F14 | Many Israeli sites change address every academic year: Reichman `/2026`, `/2027`; HUJI `/2026-27`; Technion `moodle26.`; Haifa `mw27.`; Braude `moodle27.`. Reichman's root redirects to `/2026` although `/2027` is the current year, so a root redirect cannot be trusted. | Live |
| F15 | Of 59 Israeli institutions surveyed: 37 have the mobile service **on** (25 with SSO sign-in, 12 with in-app sign-in), 9 have it **off** (no token can be issued there), 7 sit behind a gateway or bot wall that could not be probed, and 6 don't appear to use Moodle. | Live; Appendix A |
| F16 | Errors from `login/token.php` and `webservice/pluginfile.php` are JSON of the form `{ error, errorcode }`; REST errors are `{ exception, errorcode, message }`. | Source (`AJAX_SCRIPT` in both files); live |

## 3. Decisions

| Decision | Why |
|---|---|
| **D1. Token + mobile web service** is the data layer. | F1. Structured JSON, stable across Moodle versions and themes, used by every mature client. |
| **D2. v1 runs in TutorAI Local only.** The website shows what the feature does and how to install TutorAI Local. | F8: file download from a web page fails at Reichman, the first pilot. F4: the one-click hand-back needs a program on the computer. The token stays out of the browser, like the ChatGPT tokens. One code path to test. A web transport is sketched in §13. |
| **D3. Sign in through the site's own page in the student's own browser** wherever the site supports it. TutorAI never sees a password there. | Same principle as the Claude and ChatGPT connections. Works with MFA, OTP and whatever the institution adds later. |
| **D4. Hand-back by a temporary `moodlemobile://` handler** on macOS and Windows, installed when the student starts a sign-in and removed when it finishes or times out. If another program already handles that scheme, TutorAI does not take it over. | F3, F4, F12. Temporary keeps the official Moodle app's behaviour intact the rest of the time. |
| **D5. Copy-and-paste of the link is always available** in the same screen, and is the only mode on Linux in v1. | Covers browsers and systems where D4 fails. It is error-prone (F11), so it is the fallback, not the main path. |
| **D6. No stored passwords, no scripted SSO, no User-Agent spoofing, no HTML scraping.** | Stored passwords and TOTP seeds are a liability and break with MFA. Spoofing the Moodle app (F9) misrepresents the client. Scraping breaks on every theme and upgrade (Moodle Buddy, Noodle and the BGU extensions all report it). |
| **D7. Import is an explicit choice.** Refreshing the file list is automatic; downloading and analyzing happen when the student confirms. | Analysis spends the student's tokens or plan limit. One Reichman course had 109 MB of PDFs. |
| **D8. After the student names a site, the page never gives the server an address.** It refers to sites by a key the server issued and to files by a key from Moodle's own listing; the server resolves addresses itself and sends the token only to the connected site. | Keeps a compromised page from using the token or the server as a proxy. |
| **D9. Nothing a site says about itself is trusted** until it matches the address that was probed (§5.2). | F2. A hostile or mistyped address must not be able to impersonate another site, run script in TutorAI's page, or receive a password. |
| **D10. A registry of institutions in the repo**, with the live public configuration as the source of truth. Another Moodle can be added by pasting its address, with SSO sign-in only (D11). | F2, F14, F15. Adding or correcting an institution is a small data PR, a good first contribution. |
| **D11. The password form exists only for institutions in the registry.** | A pasted look-alike address must never produce a password form inside TutorAI's trusted screen. |
| **D12. Honest identification.** Requests carry `User-Agent: TutorAI-Local/<version> (+https://github.com/yairbarak22/TutorAI)`. | An institution's IT can see what it is and reach the project. If a site blocks it, the site is marked unsupported until its IT allows it. |
| **D13. Polite by construction.** One request at a time per site, a pause between requests, one file at a time, back-off on errors, stop on a challenge page. | Bar-Ilan's anti-bot layer flags fast downloads (BiuMoodleDownloader README). A student tool must not look like a scraper. |

## 4. Architecture

```
┌──────────────── The student's browser (any) ─────────────────┐
│ http://127.0.0.1:4317  — apps/web                             │
│  ui/MoodleConnect · views/MoodleImport · Materials "new files"│
│  moodle/sync.ts ── planSync (packages/moodle) ── Store        │
│                       (tutorai.db: moodle_links, moodle_files)│
│  platform/moodle.ts ── fetch, same origin ─────────┐          │
└─────────────────────────────────────────────────────┼─────────┘
        new tab (noopener): the institution's sign-in  │ /api/moodle/*
                        │ moodlemobile://token=…       ▼
┌───────────────────────┼──── tutorai (127.0.0.1 only) ──────────────────────┐
│  temporary handler ───┘   (macOS applet · Windows registry)                 │
│        │ tutorai moodle-link ──► POST /control/moodle-link                  │
│  apps/local/src/moodle/                                                     │
│    sites.ts     registry, probe, validation, resolved-site keys             │
│    connect.ts   pending sign-in (passport), link check, password sign-in    │
│    tokens.ts    ~/.tutorai/moodle/<site>.json (0600)                        │
│    http.ts      the only code that talks to Moodle: host and path rules,    │
│                 pinned DNS, per-site queue, pacing, retries, size caps      │
│    download.ts  file → data folder (type, size, hash checks)                │
│    handler/     macos.ts · windows.ts                                       │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │ HTTPS, token in the request, connected site only
                               ▼
                    The institution's Moodle
        lib/ajax/service-nologin.php · login/token.php
        webservice/rest/server.php · webservice/pluginfile.php
```

### 4.1 New package: `packages/moodle` (`@tutorai/moodle`)

Pure TypeScript with `zod` only: no Node APIs, no DOM. Used by the server (calls) and the web app (types, planning, registry for the picker). It does not depend on `@tutorai/core`, and `@tutorai/core` does not depend on it; `apps/web` connects the two.

| File | Contents |
|---|---|
| `institutions.ts` | The registry (§5.1) and `candidateSites(institution, date)`. |
| `public-config.ts` | `PublicConfig` schema, `validateSite(candidate, config)` (§5.2), `classify(config, { inRegistry })` (§5.3), `isSafeLaunchUrl(url, testMode)` (§6.2). |
| `link.ts` | `findLaunchLink(text)`, `describePaste(text)`, `expectedSiteIds(wwwroots, passport, md5)` (§6.4). `md5` is injected, so the package has no crypto dependency. |
| `client.ts` | `MoodleClient` over an injected `fetch`: `siteInfo()`, `courses(userId)`, `contents(courseId)`. Maps Moodle errors, in both shapes of F16, to `MoodleError` kinds (§9). |
| `schemas.ts` | Zod schemas for the fields we read from Moodle (lenient: unknown fields ignored, optional fields optional), and the shared shapes `RemoteCourse`, `RemoteFile` and `MoodleErrorKind`. `@tutorai/local-api` imports these three rather than defining its own. |
| `flatten.ts` | Course contents → `RemoteFile[]` plus counts of what is not importable (§7.2). |
| `plan.ts` | `planSync(remoteFiles, knownFiles)` → inserts and updates (§7.3). Pure, fully unit-tested. |
| `names.ts` | `safeName()` (the same rule as core's `safeFileName`), `cleanCourseName()`, `looksLikeExam()`. |

### 4.2 Server: `apps/local/src/moodle/`

Holds all secrets and makes every request to Moodle. Described in §5 to §9.

### 4.3 Web app

- `platform/moodle.ts`: typed client for `/api/moodle/*`, using the helpers in `platform/local-server.ts`.
- `moodle/sync.ts`: orchestration against the `Store`: refresh, import, link and unlink.
- UI: `ui/MoodleConnect.tsx`, `views/MoodleImport.tsx`, a "Moodle" strip in `Materials.tsx`, a "Moodle" card in `Settings.tsx`, an entry on `Home.tsx` (§10).
- The database stays in the page, as today. The server never opens `tutorai.db`.

### 4.4 On and off

Three switches, all enforced by the server:

- **The whole feature.** A constant in the code, `MOODLE_DEFAULT_ON`, is `false` until M3 is complete and `true` from then. `Settings.moodleEnabled` is an optional override that is stored only when someone sets it (it is not part of the default settings, so a later change of the constant reaches everyone who never touched it). `Hello.features.moodle` reports the result, and every `/api/moodle/*` route answers 403 when it is off.
- **One institution.** A registry entry with `disabled: true` cannot be resolved (reason `disabled`). This is how one release turns off one institution that objects (§15).
- **How sure we are.** Entries with `status: "verified"` are offered plainly. Entries with `status: "config-checked"` are offered with one line: "Not checked at your institution yet. It should work; tell us how it went", with a link to report. That keeps the pilot honest without blocking the other 36 institutions.

## 5. Sites and institutions

### 5.1 The registry

```ts
export interface Institution {
  id: string;                         // "runi", "technion"
  name: { he: string; en: string };
  /** Addresses to try. Placeholders: {yyyy} {yy} = the year an academic year ends,
   *  {YYYY} {YY} = the year it starts. "https://moodle.runi.ac.il/{yyyy}",
   *  "https://moodle{YY}.technion.ac.il", "https://moodle.huji.ac.il/{YYYY}-{yy}".
   *  A site without a yearly address has one entry and no placeholder. At most two entries. */
  sites: string[];
  status: "verified" | "config-checked" | "mobile-off" | "unreachable";
  verified?: { date: string; moodle: string; by: "maintainer" | "student" };
  /** Turns this institution off in the next release (§4.4). */
  disabled?: true;
  /** Minimum pause between requests, when the site needs more than the default (ms). */
  paceMs?: number;
  notes?: string;                     // English, for maintainers
}
```

- `status` is documentation and a hint for the picker. **The live probe decides** what is offered.
- `verified` is set only after someone ran the check script (§12.3) against a real account.
- A test asserts that every template is `https`, has no port, and expands to a valid address.

**Worked example of `candidateSites` on 2026-11-27.** Academic years considered are those ending in `Y+1`, `Y`, `Y−1` where `Y` is the calendar year: 2027, 2026, 2025.

| Template | Candidates, in order |
|---|---|
| `https://moodle.runi.ac.il/{yyyy}` | `/2027`, `/2026`, `/2025` |
| `https://moodle{YY}.technion.ac.il` | `moodle26`, `moodle25`, `moodle24` |
| `https://moodle.huji.ac.il/{YYYY}-{yy}` | `/2026-27`, `/2025-26`, `/2024-25` |
| `https://mw{yy}.haifa.ac.il` | `mw27`, `mw26`, `mw25` |
| `https://lemida.biu.ac.il` | that address only |

With two templates the candidates are interleaved by year, six at most.

### 5.2 Resolving and validating a site (`sites.ts`)

`resolve(institutionId | url)`:

1. **Candidates.** For an institution: `candidateSites`. For a pasted address: the address cut before the first of `/login/`, `/my/`, `/course/`, `/admin/`, `/mod/`, `/user/`, with query and fragment removed, and also its origin alone. Both kinds must be `https:` with no user name and no port. A pasted host must be a DNS name: an IP address in any notation (dotted, bracketed IPv6, a bare number) is refused. A pasted address whose host and path match a registry template is treated as that institution from here on.
2. **Probe** every candidate in parallel: one POST to `<candidate>/lib/ajax/service-nologin.php?info=tool_mobile_get_public_config`, 10 s timeout, answer capped at 256 KB, redirects not followed.
3. **Validate** each answer (`validateSite`). All must hold, otherwise the candidate is dropped:
   - It parses as the public-configuration shape.
   - `wwwroot` is `https:`, has no port, has **the same host as the candidate**, and its path is the candidate's path or an ancestor of it.
   - If `wwwroot` differs from the candidate, the same probe at `wwwroot` itself must report the same `wwwroot`.
   - `launchurl`, when the site needs it, has the same origin as `wwwroot`, no user name, no query and no fragment, and a path that lies under the `wwwroot` path and ends with the segments `/tool/mobile/launch.php` (Moodle builds the middle part from its admin-folder setting, so it is not hard-coded). The server later adds its parameters with `URL.searchParams`, never by joining strings.
   - `sitename` is cut to 80 characters and shown as text only.
4. **Key.** The site key is the validated `wwwroot`: lower-case host, no trailing slash. Results are de-duplicated by key.
5. **Remember.** The server keeps each validated site (key, config, institution id or "pasted") in memory for 30 minutes. `connect/start` and `connect/password` accept only a key in this list; anything else is a 400 (D8). Signing in again to an existing connection therefore starts with `resolve` too (`{ institutionId }`, or `{ url: site }` for a pasted one).
6. **Answer.** `{ candidates, problem? }`: candidates newest year first. `problem` is set when there are none, by the worst thing that happened across the candidates, in this order: `refused` (an address rule or a validation of step 3 failed, or the institution is disabled), `not_moodle` (something answered, but not with a public configuration), `timeout`, `offline` (no connection could be made).

With several candidates (two academic years open at once) the student picks, with the newest that has the mobile service pre-selected. After sign-in, if that site lists no courses and another candidate exists, the app offers it.

**Pasted addresses only:** the name must resolve to public addresses. Refused: loopback, private (`10/8`, `172.16/12`, `192.168/16`), link-local, CGNAT (`100.64/10`), `0.0.0.0/8`, multicast, reserved (`240/4`), IPv6 unspecified (`::`) and loopback, unique-local (`fc00::/7`), IPv6 link-local and multicast, IPv4-mapped forms of all of these, and NAT64. The check is made on the address the connection actually uses: `http.ts` connects through `node:https` with a `lookup` function that validates every resolved address, so a name cannot pass the check and then resolve differently. (IP-literal hosts never reach `lookup`, which is why step 1 refuses them.) Registry hosts skip this rule, because an institution's network may resolve its own Moodle to an internal address.

**Showing the host.** For a pasted site every screen that names it (sign-in step, "Connected as…", Settings) shows the host next to the site's own name, in its ASCII (punycode) form, because the name is whatever the site claims.

### 5.3 What the public configuration means

| Validated public configuration | Offered |
|---|---|
| (registry entry has `disabled: true`; no probe is made) | **Unavailable** (`disabled`): "Connecting to this institution is turned off for now." |
| `enablewebservices` or `enablemobilewebservice` is 0 | **Unavailable** (`mobile_off`). The screen says the institution's Moodle doesn't allow apps, that files can still be added by hand, and offers a short ready-made message the student can send to their IT. |
| `maintenanceenabled` | **Unavailable** (`maintenance`): try later. |
| `typeoflogin` 2 or 3 | **SSO** through the launch page (§6.2). |
| `typeoflogin` 1, institution in the registry | **Password** form (§6.5). |
| `typeoflogin` 1, pasted address | **Unavailable** (`password_needs_registry`): "This site signs in inside the app. For your safety TutorAI offers that only for institutions in its list. Ask us to add yours", with a link to open an issue (D11). |

### 5.4 Where the server may connect

`apps/local/src/net.ts` wraps the global `fetch` with a fixed set of hosts; that stays exactly as it is, so no Moodle host can be reached with `fetch`. Moodle requests are made by one file, `moodle/http.ts`, which applies its own, stricter rule to every request. In the first version it uses the unwrapped `fetch` that `net.ts` hands out through `moodleTransport()`, and a test asserts that no other file uses that function. (When pasted addresses are added, this file moves to `node:https` so that the `lookup` of §5.2 can pin the address it checked.) `http.ts` allows a request when **host, path and state** all match:

| State of the site | Paths allowed (under the site's `wwwroot` path) |
|---|---|
| Being probed by `resolve` | `/lib/ajax/service-nologin.php` |
| Sign-in pending for this site | the above and `/webservice/rest/server.php` (and `/login/token.php` once the password form of §6.5 exists) |
| Connection saved | the above and `/webservice/pluginfile.php/…` |

Everything else is refused. Redirects are never followed automatically. One same-host redirect is followed for a file download, and only if the new address still passes the path rule. A redirect to another host ends the request with kind `unsupported` (a site that serves files from separate storage is not supported in v1).

## 6. Connecting

### 6.1 State

One pending sign-in at a time, in memory. A second `start` (from any tab) replaces the first and removes its handler.

```ts
interface Pending {
  id: string;                 // random, for the page
  site: string;               // site key
  wwwroots: string[];         // wwwroot and httpswwwroot, for the site-id check
  passport: string;           // 128 random bits, hex; single use
  mode: "auto" | "manual";    // whether a handler is installed
  state: "waiting" | "verifying" | "failed";
  error?: MoodleErrorKind;    // when state is "failed"
  expiresAt: number;          // 10 minutes after creation
}
```

A saved connection, `~/.tutorai/moodle/<first 16 hex of sha256(site)>.json`, written with `writePrivate` (0600 / user-only ACL):

```ts
{ site, siteName, institutionId?, userId, fullName, token, connectedAt, release,
  functions: string[],          // only the names we use, for feature checks
  downloadFiles: boolean, lastOkAt, expiredAt?: string }
```

The private token is discarded (it is only for auto-login, F9). The password is never stored. Nothing here goes to the browser except `site`, `siteName`, `institutionId`, `fullName`, `connectedAt` and whether it is expired. A corrupted file is ignored.

### 6.2 SSO sign-in (main path)

1. In the connect screen the student picks the institution and presses **Continue**. The page calls `resolve`, then `POST /api/moodle/connect/start { site }` with the chosen key.
2. Server: takes the validated config from the resolved list, creates the pending sign-in, and tries to install the temporary handler (§6.3). Answers `{ pendingId, launchUrl, mode, expiresAt }`, where the server builds `launchUrl` from the validated `launchurl` with the parameters `service=moodle_mobile_app`, `passport=<passport>`, `urlscheme=moodlemobile`, `confirmed=1`.
   `confirmed=1` is used in both modes: with a handler the page's scripted click opens TutorAI, and without one the page shows the link to copy (F5).
3. The screen now shows what will happen and a **"Sign in to Moodle"** button that is a real link: `<a href={launchUrl} target="_blank" rel="noopener noreferrer">`. Server and page apply the same function, `isSafeLaunchUrl`, before sending and before rendering: the address must be `https:` (in the tests-only mode of the build plan §3.4, also the mock's `http://127.0.0.1:<port>`; the page learns that mode from `Hello.testMode`). Because of `noopener`, the Moodle tab has no way to reach or navigate the TutorAI tab, and TutorAI cannot close it.
4. The page polls `GET /api/moodle/status` every 1.5 s.
5. The student signs in. Moodle shows its page and triggers `moodlemobile://token=…`. The browser asks whether to open TutorAI.
6. The handler runs `tutorai moodle-link`, which posts the link to `/control/moodle-link` (§6.3).
7. Server `acceptLink(text)` (§6.4): `state` becomes `verifying`, then the connection is saved and the pending sign-in is cleared, or `state` becomes `failed` with a kind.
8. The page reads `status` like this:
   - a connection for the site that was not there before → "Connected as *full name* at *site name*. You can close the Moodle tab."
   - `pending` with this id and `state: "failed"` → the reason and "Try again", which starts a new sign-in.
   - `pending` is null, or has another id, and there is no new connection → the sign-in ended (it expired, another tab started one, or TutorAI restarted): "That sign-in ended. Try again."

**Manual help.** In `manual` mode it is shown at once; in `auto` mode after 8 seconds without a result: "After signing in you see a Moodle page with one link in a box. Right-click it, choose Copy Link Address, and paste here." The paste box sends `POST /api/moodle/connect/paste { pendingId, text }`, which calls the same `acceptLink`. When the text is not a launch link the server answers with a hint code (`page_address`, `signin_address`, `other_moodle_page`, `not_a_link`), worked out without keeping the text, so the screen can say "that is the address of the page itself" or "the sign-in hasn't finished". The page clears the clipboard inside the paste gesture itself (the paste event, or the click on "Paste"), right after reading the text and before the request: `navigator.clipboard.writeText("")`, best effort, only when the text contains `://token=`.

### 6.3 The temporary handler (macOS and Windows)

Rules for both:

- Installed only while a sign-in is pending. Removed on success, failure, cancel, expiry, replacement by a new sign-in, and on every way the server stops. `lifecycle.ts` gains one `beforeExit()` step that `shutdown`, the update `relaunch` and `Running.close()` all run before they do anything else; it calls the Moodle service's `cleanup()`, and it is tested directly.
- A marker file `~/.tutorai/moodle/handler.json` records exactly what was installed. At start-up, and in `tutorai uninstall`, a leftover is removed **only if what is registered now is still what the marker describes**; a registration someone else made since is left alone.
- **Never replace someone else's handler.** If any program is registered for `moodlemobile` before we start, or ours is not the one the system reports after installing, the mode is `manual`.
- The handler does one thing: pass the link to this TutorAI. The command it runs is given to the Moodle service when it is created: by default this server's own start command with absolute paths (the binary; in a source checkout, `node`, the loader and the script, none of them relative to a working folder), and in tests whatever the test passes. It is followed by `moodle-link` and `--config <this server's config folder>`, so the link reaches the server that installed the handler and not another one.
- `moodle-link` takes the first `--config` it is given, reads `run.json` in that folder and posts the link to `POST /control/moodle-link` with the control secret. It prints nothing and always exits 0. It sends something only when, apart from `--config <dir>`, there is exactly one more argument and that argument is a link matching `^moodlemobile://token=([A-Za-z0-9+/=_-]|%[0-9A-Fa-f]{2})+[/#]?$` (at most 1024 characters). Anything else, including any extra argument, means nothing is sent.
- All system tools are run with `execFile`, absolute paths, no shell, 5 s timeouts each. Any failure, or any path that cannot be embedded safely (rules below), means `manual` mode, never an error for the student.

**macOS** (verified, F12). Creates `~/Applications/TutorAI Moodle Sign-in.app`:

```
/usr/bin/osacompile -o "<app>" <script file>
/usr/bin/plutil -replace CFBundleIdentifier -string io.github.yairbarak22.tutorai.moodle "<app>/Contents/Info.plist"
/usr/bin/plutil -replace LSUIElement -bool true "<app>/Contents/Info.plist"
/usr/bin/plutil -insert CFBundleURLTypes -json '[{"CFBundleURLName":"Moodle sign-in","CFBundleURLSchemes":["moodlemobile"]}]' "<app>/Contents/Info.plist"
/usr/bin/codesign --force --sign - "<app>"
<lsregister> -f "<app>"            # …/LaunchServices.framework/Versions/A/Support/lsregister
```

The script writes the link to a file instead of putting it on a command line, so the token never appears in the process list:

```applescript
on open location theURL
	set p to "<inbox>/link-" & (do shell script "/usr/bin/uuidgen")
	set f to open for access (POSIX file p) with write permission
	try
		set eof of f to 0
		write theURL to f as «class utf8»
		close access f
	on error
		close access f
	end try
	do shell script <command> & " moodle-link --config " & quoted form of "<config>" & " --from-file " & quoted form of p
end open location
```

- `<inbox>` is `<config>/moodle/inbox` (mode 0700). `--from-file` exists on macOS only; the path must be inside the inbox; the file is read and deleted whether or not the server is running. `cleanup()` empties the inbox.
- `<command>` is each part of the handler command as `quoted form of "<part>"`, joined with spaces. On macOS the only extra argument is `--from-file <path>` in place of the link.
- Every embedded path is written as an AppleScript string literal. If any contains `"`, `\`, a line break or a control character, the mode is `manual`. Spaces and non-ASCII letters are fine.
- The before and after checks ask the system which app opens `moodlemobile://x` (`NSWorkspace.URLForApplicationToOpenURL` through `/usr/bin/osascript -l JavaScript`).
- Removal: `lsregister -u`, then delete the app.

**Windows** (to verify, S1). Per-user registry, no administrator rights:

```
before:  reg query HKCR\moodlemobile                                              → exists: manual
         reg query HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\moodlemobile\UserChoice
                                                                                  → exists: manual
install: reg add HKCU\Software\Classes\moodlemobile /ve /d "URL:TutorAI Moodle sign-in" /f
         reg add HKCU\Software\Classes\moodlemobile /v "URL Protocol" /d "" /f
         reg add HKCU\Software\Classes\moodlemobile\shell\open\command /ve /d "<command> moodle-link --config \"<config>\" \"%1\"" /f
after:   reg query HKCR\moodlemobile\shell\open\command  → must be exactly what we wrote, else remove ours: manual
remove:  reg delete HKCU\Software\Classes\moodlemobile /f
```

- `HKCR` is the merged per-user and machine view. S1 must also establish how a Store-packaged app that claims the scheme shows up, and add that check; until S1 is done Windows ships in `manual` mode.
- `<command>` is each part of the handler command in double quotes. If any path or `<config>` contains `"` or `%`, the mode is `manual`.
- On Windows the link is the last command-line argument. The first argument after the command is fixed (`moodle-link`), so whatever a caller manages to put in the link, even extra arguments, reaches only that subcommand, which ignores anything but one well-formed link.
- S1 decides whether the brief console window needs a hidden launcher.

**Linux:** `manual` mode in v1. A `.desktop` handler would put the token in a command line that other users of the machine can read (`/proc/<pid>/cmdline`), and the quoting rules and desktop differences are not worth it for the number of students. It can be revisited (§14).

### 6.4 Accepting a link

`acceptLink(text)` is the only way a token enters the system on the SSO path. It is called from the control route (handler) and from the paste route.

1. There must be a pending sign-in in state `waiting` that has not expired. Otherwise: ignore (control route), or answer `expired` (paste route).
2. `findLaunchLink(text)`: find `<scheme>://token=<base64>` anywhere in the text, also when percent-encoded; decode; split on `:::`; require a 32-hex first part and a non-empty token. Not found: ignore, or answer `not_a_link` with a hint.
3. **Site check:** the first part must equal `md5(wwwroot + passport)` for one of the pending `wwwroots`. Otherwise the link is dropped and the sign-in **stays** `waiting` (`wrong_site` to the paste route). This is what stops a web page from firing `moodlemobile://token=<someone else's token>` at the handler: it cannot know the passport.
4. The passport is now **used**: `state` becomes `verifying`, and no further link is accepted for it.
5. Call `core_webservice_get_site_info` with the token. Require a user id and that `functions` contains the three calls of F1; note `downloadfiles`. On any failure `state` becomes `failed` with the error kind and the token is forgotten.
6. Save the connection (§6.1), clear the pending sign-in, remove the handler.

### 6.5 Password sign-in (registry institutions with `typeoflogin` 1)

*Not built in the first version: Reichman signs in through its own page. A site that needs this is reported as "not supported yet".*

The screen shows the institution's name and host, a username and password form, and: "Your details are sent only to *host* over a secure connection, exactly like in the Moodle app. TutorAI does not keep your password."

`POST /api/moodle/connect/password { site, username, password }`: the server checks that `site` is a resolved key **of a registry institution** (D11), POSTs `login/token.php` (`service=moodle_mobile_app`) with the fields in the body, then continues at step 5 of §6.4. The password exists only in that request's memory: not in settings, logs, or error text.

`invalidlogin` → "The details weren't accepted. If you normally sign in through your institution's page and have no separate Moodle password, this institution can't be connected yet." Six institutions list an identity provider next to in-app sign-in (Appendix A); whether their students' passwords work here is spike S4.

### 6.6 Expiry, reconnect, disconnect

- A call that fails with `invalidtoken`, or `accessexception` whose message says the token expired, writes `expiredAt` into the connection file. Every Moodle screen then shows "Your Moodle connection ended. Institutions limit it to about 12 weeks, and it may have started before you connected here. Sign in again" with one button. Linked courses, imported files and the file list are untouched.
- A new academic year is a new site (F14). There is no background probing: signing in again runs `resolve`, which shows the new year's site when it exists, and the "no courses here, try the other year" offer of §5.2 covers the weeks when two years are open.
- **Disconnect** deletes the connection file. It does not try to cancel the token at Moodle, because the same token serves the official app (F7). The screen says so and links to `<wwwroot>/user/managetoken.php` ("Security keys") for a student who wants to reset it.
- `tutorai uninstall` deletes `~/.tutorai` as today, after removing a leftover handler.

## 7. Reading and importing

### 7.1 Calls

All REST calls are POSTs to `<wwwroot>/webservice/rest/server.php` with `wstoken`, `wsfunction`, `moodlewsrestformat=json`, `moodlewssettingfilter=true` and `moodlewssettinglang=<lang>` (F13), all in the body. `lang` (`he` or `en`) comes from the page with each request. Answers are capped at 10 MB.

| Purpose | Function | Fields used |
|---|---|---|
| Identity, features | `core_webservice_get_site_info` | `userid`, `fullname`, `sitename`, `release`, `functions[].name`, `downloadfiles` |
| Courses | `core_enrol_get_users_courses` (`userid`, `returnusercount=0`) | `id`, `shortname`, `fullname`, `displayname`, `startdate`, `enddate`, `hidden`, `lastaccess` |
| Files | `core_course_get_contents` (`courseid`) | section `name`, `uservisible`; module `id` (cmid), `modname`, `name`, `uservisible`, `contents[]`: `type`, `filename`, `filepath`, `filesize`, `fileurl`, `timemodified` |

Supported: Moodle 3.9 and later is expected to work; 4.5 is verified. A site whose `functions` lacks one of the three calls is `unsupported`.

### 7.2 From course contents to files (`flatten.ts`)

| Activity (`modname`) | v1 | Later (§14) |
|---|---|---|
| `resource`, `folder` | Every `contents` item with `type: "file"` | |
| `page`, `book`, `label` | Counted as "text pages" | Imported as text sources |
| `url` | Counted as "links" | |
| `assign` | Counted | Instruction attachments |
| `lti`, `hvp`, `h5pactivity`, `quiz`, `forum`, `attendance`, others | Counted by kind as "not importable" | |

Rules:

- Skip sections and modules with `uservisible: false`.
- **A file is importable only if** its `fileurl` is `https:`, has the same host as the site, and its path starts with `<wwwroot path>/webservice/pluginfile.php/` (D8). Anything else is counted as "external".
- `RemoteFile`: `{ key, cmid, modname, section, activity, filename, filepath, size, modified }`. `key = "<cmid>:<filepath><filename>"` identifies the file across refreshes. A file whose key would be longer than 600 characters is counted under "not importable" instead.
- **Cache:** `contents` answers are cached for 10 minutes per site, course and language. `fresh=1` bypasses it ("Check Moodle now" and the first load of the file screen use it). Separately, the server keeps one map of `key → fileurl` per site and course, refreshed by every `contents` call in any language and never sent to the page; a download looks the address up there.
- First-sight state, computed by `planSync` (`fresh(file)`), not by `flatten`: `unsupported` (extension not one of `pdf`, `pptx`, `docx`, `txt`, `md`, `markdown`: what `detectKind` accepts), `too_large` (over 60 MB, the limit in `Engine.addFiles`), otherwise `new`.
- "Looks like an exam" (pre-selects the sample-exam type): the upload rule on the file name, widened to plural forms (`/מבח[ןנ]|בחינ|exam|מועד/i`), applied to the file, activity and section names.

### 7.3 Data model (`tutorai.db`, schema version 4)

No secrets. A data folder synced to another computer carries the links and the file list; that computer just has to sign in.

```sql
-- A TutorAI course linked to a Moodle course.
CREATE TABLE IF NOT EXISTS moodle_links (
  course_id INTEGER PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
  site TEXT NOT NULL,                      -- site key
  remote_course_id INTEGER NOT NULL,
  remote_name TEXT NOT NULL,
  last_sync TEXT,                          -- ISO time of the last successful refresh
  last_error TEXT,                         -- error kind of the last failed refresh
  UNIQUE (site, remote_course_id)
);

-- Every file Moodle listed for a linked course, and what happened to it.
CREATE TABLE IF NOT EXISTS moodle_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  remote_key TEXT NOT NULL,                -- "<cmid>:<filepath><filename>"
  cmid INTEGER NOT NULL,
  modname TEXT NOT NULL,
  section TEXT NOT NULL DEFAULT '',
  activity TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  remote_modified INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'new',       -- new | imported | skipped | unsupported | too_large | failed
  present INTEGER NOT NULL DEFAULT 1,      -- listed by Moodle at the last refresh
  changed INTEGER NOT NULL DEFAULT 0,      -- imported, and Moodle's copy changed since
  source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL,
  error TEXT,                              -- error kind, when state is failed
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (course_id, remote_key)
);
```

`planSync(remote, known)` decides for every key. "Changed" means `remote_modified` or `size` differs from the row. `fresh(file)` is the first-sight state of §7.2.

| Row before | Not listed now | Listed, unchanged | Listed, changed |
|---|---|---|---|
| (none) | | insert with `fresh(file)` | |
| `new`, `unsupported`, `too_large` | `present = 0` | `present = 1` | `present = 1`, new size and time, state `fresh(file)` |
| `failed` | `present = 0` | `present = 1` (stays `failed`, shown with "Try again") | `present = 1`, new size and time, state `fresh(file)` |
| `skipped` | `present = 0` | `present = 1` | `present = 1`, new size and time, state `fresh(file)` (offered again) |
| `imported`, source exists | `present = 0` (the source stays) | `present = 1` | `present = 1`, new size and time, `changed = 1` |
| `imported`, source deleted by the student (`source_id` NULL) | `present = 0`, state `skipped` | `present = 1`, state `skipped` | `present = 1`, new size and time, state `fresh(file)` |

What the student sees is derived from that:

- **"N new files in Moodle"** counts rows with `present = 1` and (`state = new`, or `state = imported` with `changed = 1`).
- Importing a `changed` row adds the new version as a new source, points `source_id` at it and clears `changed`. The old source stays until the student deletes it.
- **"Don't show these again"** sets `new` rows to `skipped` and clears `changed` on imported ones.
- `failed` rows stay visible in the file list with the reason and "Try again".

### 7.4 Refresh and import (`moodle/sync.ts`)

- **Refresh** (`refresh(courseId, { fresh })`): one `contents` call → `planSync` → `store.applyMoodleChanges` → `last_sync`. Runs when the student opens a linked course's Materials tab and the last refresh is older than 6 hours, and from "Check Moodle now". Never downloads. A failed refresh stores the error kind in `last_error` and leaves the rows as they were.
- **Import** (`importFiles(courseId, keys, kinds)`): for each key in order, `POST /api/moodle/download` (§8), then:
  - `done` → `store.addSource({ course_id, name, kind, mime: safeMimeFor(name), path, hash, size })`, row `imported` with `source_id`, **`await persistence.flush()`** so the database on disk knows the file before the next download starts, then `engine.enqueue(sourceId)`: the existing pipeline.
  - `duplicate` → row `imported`, `source_id` of the existing source with that hash.
  - `error` → row `failed` with the kind in `error`, except `too_large`, which sets the row's state to `too_large`. `auth` and `blocked` stop the batch; other kinds continue with the next file.
  - A stream that ends without a final event, or a network failure to the local server, is `failed` with `network`.
  - `Persistence.flush()` does not throw when the write fails; it records `lastError`. After each flush `sync.ts` checks it and stops the batch with a clear message if the database could not be saved, so files do not pile up that the saved database doesn't know.
- **Linking.** "Import from Moodle" creates one TutorAI course per chosen Moodle course (name from `displayname`, cleaned) with a `moodle_links` row. An existing course can be linked from its Materials tab ("Link to a Moodle course"), and unlinked (the link and its rows are deleted; sources stay).
- **Several tabs.** Each tab has its own copy of the database, as today, and the existing lock warning applies. Imports are started by a click, never automatically, so two tabs do not import by themselves.

## 8. Server API

Added to `packages/local-api` as zod schemas (impl §3.1). All routes are `kind: "api"` (session cookie, token header, origin checks) except the control route. Non-streaming errors are HTTP 4xx/5xx with `{ error, kind }`; the page translates `kind` and never shows server text.

| Route | Request → response |
|---|---|
| `GET /api/moodle/institutions` | → `{ institutions: [{ id, name: { he, en }, status }] }`: the registry as this server has it (the picker's list; in the tests-only mode it also holds the mock) |
| `POST /api/moodle/resolve` | `{ institutionId } \| { url }` → `{ candidates: [{ site, host, siteName, institutionId?, login, reason? }], problem? }` |
| `GET /api/moodle/status` | → `{ connections: [{ site, siteName, institutionId?, fullName, connectedAt, expired }], pending: { id, site, mode, state, error?, expiresAt } \| null }` |
| `POST /api/moodle/connect/start` | `{ site }` → `{ pendingId, launchUrl, mode, expiresAt }` |
| `POST /api/moodle/connect/paste` | `{ pendingId, text }` → `{ ok: true } \| { ok: false, kind: "not_a_link" \| "wrong_site" \| "expired", hint? }` (a link that passes the site check answers `ok: true`; the result of verification arrives through `status`) |
| `POST /api/moodle/connect/password` | `{ site, username, password }` → `{ ok: true } \| { ok: false, kind }` |
| `POST /api/moodle/connect/cancel` | `{ pendingId }` → 204 |
| `POST /api/moodle/disconnect` | `{ site }` → 204. Aborts that site's running download first. |
| `GET /api/moodle/courses?site=&lang=` | → `{ courses: [{ id, shortname, fullname, displayname, startdate, enddate, hidden, lastaccess }] }` |
| `GET /api/moodle/contents?site=&course=&lang=&fresh=` | → `{ files: RemoteFile[], other: { textPages, links, external, notImportable: Record<modname, number> } }` |
| `POST /api/moodle/download` | `{ site, remoteCourseId, key, courseId, knownHashes: string[] }` → newline-delimited JSON: `{ type: "progress", received, total }`…, then exactly one of `{ type: "done", path, hash, size, name }`, `{ type: "duplicate", hash }`, `{ type: "error", kind }` |
| `POST /control/moodle-link` (`kind: "control"`) | `{ link }` → 204 always (no information to the caller) |

**Download, step by step.**

1. Look `key` up in the `key → fileurl` map for that site and course (§7.2). If the map is empty, fetch the contents once. Not found: `error` `not_listed`.
2. Check the address rule of §7.2. GET it with `token=` added, through `http.ts`.
3. If the answer is JSON (F16), map its `errorcode`: an expired or invalid token is `auth`, anything else `forbidden`.
4. Stream into the data folder through a new `DataFolder.importStream(dir, source, { maxBytes })`: it writes `courses/<courseId>/sources/incoming-<random>.part` (same confinement checks as every other path), hashing as it goes, and stops at 60 MB (`too_large`).
5. Check the first bytes: `%PDF` for `.pdf`, `PK\x03\x04` for `.pptx` and `.docx`; a text file must not start with `<!doctype` or `<html`. HTML where a file was expected is `blocked`; anything else wrong is `wrong_type`.
6. If the hash is in `knownHashes`: delete the part file, answer `duplicate`. Otherwise rename it to `courses/<courseId>/sources/<hash10>-<safeName(filename)>` and answer `done`.
7. A closed request, a disconnect, or any error deletes the part file. Before each download, part files older than an hour in that folder are deleted. `ctx.busy.inc()/dec()` keeps the server alive during a download.

The data folder is read from settings at the start of each download; changing it in the middle affects the next file, not the current one.

## 9. Pacing and errors

**Pacing (per site, in `http.ts`):** one request at a time; at least 300 ms between API calls and 500 ms between files (the institution's `paceMs` raises both); a 30 s timeout per API call and a 10 min cap per file; on HTTP 429 or 503, or `ex_unabletolock`, retry up to 3 times with 2, 5 and 15 s waits, then `blocked`; a challenge page (HTML where a file or JSON was expected) is `blocked` at once.

| Kind | When | What the student sees |
|---|---|---|
| `auth` | `invalidtoken`; `accessexception` saying the token expired; suspended or deleted user | "Sign in to Moodle again" |
| `unavailable` | mobile service off; `sitemaintenance`; REST disabled | The reason, and manual upload as the way forward |
| `policy` | `sitepolicynotagreed`, `usernotfullysetup`, `forcepasswordchangenotice`, `passwordisexpired` | "Moodle needs something from you first", with a link to open Moodle |
| `forbidden` | `nopermissions`, `requireloginerror`, a file answering 403 or 404 | That file or course is skipped with the reason |
| `blocked` | challenge page; repeated 429 or 503 | "Your institution's site is limiting automatic downloads. Try again later." |
| `network` | no connection, timeout, TLS failure | "Couldn't reach *host*", with retry |
| `unsupported` | a needed function is missing; an unexpected shape | "This Moodle version isn't supported yet", with a link to report it |
| `too_large`, `wrong_type`, `not_listed` | downloads only (§8) | The file is marked with the reason |
| `invalid_login` | password sign-in only | §6.5 |
| `other` | anything not listed above | "Something went wrong with Moodle", with retry; the server logs the Moodle error code |

**Logs** record the kind, the host and the function name: never tokens, passwords, addresses with a query, course names or file names. `redact()` in `apps/local/src/log.ts` gains patterns for `wstoken`, `token`, `privatetoken` and `password` in both the `name=value` and the JSON `"name":"value"` form, and for `moodlemobile://token=…`, because the server logs the message of a request that fails unexpectedly.

## 10. Screens

All strings bilingual, `t("עברית", "English")`; RTL and LTR. Reuses `Card`, `Button`, `Alert`, `Badge`, `Modal`, `LongTask`, `Select`.

1. **Home.** Next to "New course": **"Import from Moodle"** when `features.moodle` is on. On the website the same button opens a short explanation and the existing install section (D2), and no request is made.
2. **Connect (`MoodleConnect`, a modal).**
   - *Institution.* A searchable list from `GET /api/moodle/institutions` in the interface language. Institutions with `status: "mobile-off"` are in the list and explain themselves when picked. "My institution isn't listed" takes a pasted Moodle address. **Continue** runs `resolve`, shows a year choice if there are two, and then either the reason it is unavailable or the next step.
   - *Sign in.* The site's name, and for a pasted address its host as well (§5.2). For a `config-checked` institution, the "not checked yet" line of §4.4. What happens and what TutorAI gets: "read access to your courses and their files, with your own account; nothing is changed in Moodle". Then the **"Sign in to Moodle"** link-button (SSO), or the form (password).
   - *Waiting.* "Sign in in the tab that opened. When your browser asks to open TutorAI, allow it." The manual help and paste box (§6.2). Cancel.
   - *Done.* "Connected as *name* at *site*. You can close the Moodle tab." → courses.
3. **Courses (`MoodleImport`).** The student's courses, those in progress first (by dates and `lastaccess`), hidden ones collapsed, already linked ones marked. Check the ones to bring in → Continue.
4. **Files, per course.** Grouped by section; each file with its size and a type selector (study material / sample exam, pre-selected by the exam rule). Supported files are checked by default; unsupported and too-large ones are greyed with the reason. Above: totals ("18 files, 42 MB") and, on a plan or key, the existing notice that analysis uses it. Below: what was found but can't be imported ("4 external tools or recordings, 3 text pages, 2 links"). **"Import N files"**.
5. **Materials tab of a linked course.** A Moodle strip above the list: last check time, "Check Moodle now", and "*N* new files in Moodle" → the file list filtered to them, with "Don't show these again". Failed files show the reason and "Try again". An imported source behaves exactly like an uploaded one.
6. **Settings → Moodle.** Each connection: name, site, connected date, whether it ended; "Sign in again", "Disconnect" (with the note on the shared token, §6.6). A link to `docs/moodle.md`.

While a file downloads, the file list shows a progress bar from the `progress` events; once it is a source, the existing per-source progress takes over.

## 11. Security and privacy

A new section in `SECURITY.md` ("Moodle connection"). Rules every change must keep:

- **Token custody.** The Moodle token is kept only in `~/.tutorai/moodle/*.json` with owner-only permissions. It is never sent to the browser, never written to `tutorai.db`, the data folder or logs, and is sent only to the connected site under its `wwwroot`. On the copy-and-paste path the link passes through the page once and through the system clipboard, which the page clears after a successful paste where it can; a clipboard history or cloud clipboard may still hold it.
- **Passwords.** On SSO sites TutorAI never sees a password. On registry institutions that sign in inside the app it is forwarded once to that site's `login/token.php` over HTTPS and not kept. A pasted address never gets a password form.
- **Untrusted configuration.** A site's `wwwroot` and `launchurl` are used only after the checks of §5.2. The page opens only an `https:` launch address, as a `noopener noreferrer` link.
- **No address from the page** after `resolve`. Sites are referred to by server-issued keys and files by keys from Moodle's listing; the server refuses any file address that is not the site's own `webservice/pluginfile.php`.
- **Link acceptance.** A link is accepted only during a pending sign-in and only with the site-and-passport hash (§6.4). The control route requires the secret from `run.json` and answers nothing.
- **The handler** exists only during a sign-in, never replaces another program's registration, is tied to the server that installed it, and is removed on every exit path (§6.3).
- **Downloads** stay inside the data folder (`DataFolder`), are limited in size and checked by type; a stored file is only ever opened with an inert MIME type (`safeMimeFor`).
- **Network.** The server contacts a Moodle host only after the student chose it, only through `moodle/http.ts`, and only on the paths of §5.4. `AGENTS.md`'s "no new external network calls" gains this one, explicitly.
- **Read-only.** TutorAI calls only functions that read. It never submits, posts, marks or changes anything in Moodle.
- **Course content is data.** Names and text from Moodle are treated like uploaded material: wrapped as data in prompts, sanitized when rendered.
- **Lecturers' materials** stay on the student's computer, as with manual upload. Nothing is shared between students.

New security-sensitive paths for `CODEOWNERS`: `apps/local/src/moodle/`, `apps/local/src/net.ts`, `packages/moodle/src/link.ts`, `packages/moodle/src/public-config.ts`.

Accepted risks, stated plainly:

- The token is also the official app's token. A stolen `~/.tutorai` gives read access to the student's Moodle until the token expires or is reset.
- Any process running as the same user can read that folder, on every system, as it can read the ChatGPT tokens today.
- On Windows the link is briefly a command-line argument, readable by processes of the same user and by administrators.

## 12. Testing

### 12.1 Automated

- **`packages/moodle` (vitest):** site candidates for each template style and date (the table of §5.1); the registry check; `validateSite` against hostile configurations (another host in `wwwroot`, `javascript:` or another host in `launchurl`, a `wwwroot` that doesn't report itself, oversized JSON); `classify` for every row of §5.3; `findLaunchLink` and `describePaste`; the site-id check; `flatten` on a Reichman-shaped fixture; `planSync` for every cell of §7.3; error mapping for both shapes of F16.
- **`apps/local` (vitest) with `test/mock-moodle.ts`** (a fake Moodle: public config, launch page, `token.php`, REST, files, switchable faults):
  - connect in `manual` mode; link ignored without a pending sign-in, with a wrong passport (still waiting), after expiry, on reuse; verification failure → `failed` with the kind; a second `start` replaces the first;
  - password sign-in: registry-only; the password in no log, file or error; never in a query string;
  - the host, path and state table of §5.4; a redirect to another host not followed; a pasted IP address in each notation refused; a pasted name that resolves to each refused range refused, including when the first lookup is public and the second private; a pasted address on a registry host treated as that institution; only `moodle/http.ts` imports the request functions of `node:https` and `node:http`;
  - download: hash and final path; `duplicate` leaves no file; the 60 MB stop; wrong first bytes; an HTML challenge; a JSON error from the file endpoint in the middle of a batch → `auth`; abort and disconnect remove the part file; `courseId` cannot leave the data folder; a part file older than an hour is removed; two downloads of the same key at once both end cleanly and leave one file;
  - pacing with fake timers; expiry written to the connection file and reported after a restart; connection file mode 0600; a corrupted connection file ignored;
  - `redact()` on an error whose message contains a `pluginfile.php?token=…` address and a `wstoken=` body;
  - every `/api/moodle/*` route refuses a foreign origin, a missing cookie, a missing token header, and `moodleEnabled: false`; `/control/moodle-link` needs the secret and always answers 204.
- **Handler tests** run only when `TUTORAI_HANDLER_TESTS=1` (set in CI, never by `npm test` on a developer's computer, because they register a real handler): install → the system reports ours → open a test link (`open`, `Start-Process`) → the link reaches the **test** server through `--config` → remove → none. A foreign handler present → `manual`, untouched. A stale marker with a foreign handler now registered → left alone. Removal on cancel and expiry, and through `beforeExit()` (which is also asserted, without a real handler, to run in `shutdown`, `relaunch` and `close`). Install paths with spaces and non-ASCII letters. A path with a quote → `manual`. The tests pass their own handler command (an absolute `node`, loader and script, or the built binary), since under the test runner the default would point at the runner.
- **E2E (`e2e-local/moodle.spec.ts`, Playwright; handler off):** connect in manual mode against the mock → pick a course → import two files → they become sources and are analyzed by the fake model → add a file on the mock → "Check Moodle now" → "1 new file in Moodle" → import it; token expiry → "Sign in again"; a mobile-off site → the explanation; a hostile mock configuration → refused; the opened sign-in page has no `window.opener`.
- **CI:** `.github/workflows/local.yml` path filter gains `packages/moodle/**`; `/control/test-reset` also clears Moodle state.

### 12.2 Manual checks that need real accounts and machines

Spikes S1 to S7 in the build plan: the Windows handler; the launch page and the browser prompt in Chrome, Safari, Firefox and Edge, with and without a handler; the name filter (F13); the password path at institutions that list an identity provider; Bar-Ilan pacing with the honest User-Agent; token sharing with the official app.

### 12.3 Checking an institution

`scripts/moodle-check.mjs` lets a student verify an institution with their own login: it signs in through the launch page, runs the calls of §7.1, fetches the first bytes of a file, and prints a result with no secrets. It is how Reichman was verified. A registry entry becomes `verified` only from such a run. (A password mode and a many-files mode are to be added when the first institution that needs them is checked.)

## 13. Later: the website without TutorAI Local

Not in v1. Nothing in v1 blocks it.

- **Where it can work:** institutions whose file responses carry a single CORS value (F8). Not Reichman until its proxy stops adding a second header. The registry would gain a `webFiles` flag.
- **Sign-in:** copy-and-paste only.
- **Token:** in the browser's storage for this site through `secrets`, with the same "don't keep it" option as the API key; never in `tutorai.db`.
- **Transport:** `packages/moodle`'s client with the page's own `fetch`; files fetched by the page and written through `FileStore`. `moodle/sync.ts` would talk to a `MoodleTransport` interface with two implementations.
- **CSP:** `connect-src` gains the registry's `webFiles` hosts at build time. No pasted addresses on the website.

## 14. Out of scope for v1

- **Institutions with the mobile service off** (Appendix A.2). The honest answer there is manual upload, or the institution turning the service on. A browser extension that rides the session can reach them only by scraping HTML (F10), which this project chooses not to maintain; it can be revisited if a large institution stays closed.
- **SSO for sites with in-app sign-in.** Moodle has a path that could serve them: `launch.php` leaves a cookie, and the next fresh sign-in is sent back to it. It needs Moodle 4.4 or later, a student who is not already signed in, no MFA or policy page in between, and a cookie that survives the identity provider's post-back. Too fragile to ship unverified; S4 decides whether to build it.
- **Deadlines** (`mod_assign_get_assignments`, calendar events), **text pages** as sources, assignment attachments, automatic import of new files: phase 2 (build plan M5).
- **A Linux handler** (§6.3).
- **Sending the token in the request body to the file endpoint** instead of the address (Moodle reads it either way; whether institution proxies pass a POST there is unknown).
- Lecture recordings and external tools (Zoom, Panopto, Kaltura through LTI); writing to Moodle; grades; a lecturer dashboard; more than one account per site; syncing while TutorAI is closed.

## 15. Risks

| Risk | Mitigation |
|---|---|
| An institution dislikes a third-party client on its mobile service | Read-only, paced, honestly identified (D12, D13); one release can turn off that institution (`disabled`) or the whole feature (§4.4). The maintainer decided not to approach Reichman's IT before the pilot. |
| The automatic hand-back fails on some browser or system | Manual mode is always in the same screen (D5); handler tests in CI on macOS and Windows; S2 before M4 |
| The manual page behaves differently in some browser (F5) | S2 runs before the connect screen is built (W3); the wording follows what each browser shows |
| Another program owns `moodlemobile` | Detected before and after; manual mode; never replaced (D4) |
| Yearly site changes break the registry | Templates plus live probing (§5.2); the paste-an-address path; registry fixes are data-only PRs |
| A site's anti-bot layer blocks downloads | Pacing, stop on the first challenge, a clear message (§9); per-institution `paceMs` |
| Large courses spend a plan's limit | Explicit import with totals shown (D7); the existing pause-and-resume on plan limits |
| The connection ends sooner than expected (F7) | Expiry is a normal state with one-click reconnect and honest wording (§6.6) |
| Students with no Moodle password at in-app sign-in sites cannot connect | Said plainly in the screen (§6.5); S4; §14 |
| Moodle changes the launch flow | It is the official app's flow; the mock and the check script pin the behaviour we rely on |

## 16. Decisions (maintainer, 2026-11-27)

1. **The first version runs in TutorAI Local only** (D2), with the website explaining and pointing to the install. **Accepted.**
2. **The password form for registry institutions** (§6.5, D11). **Accepted** as the design; it is built when the first institution that needs it is added.
3. **Telling Reichman IT** before the pilot. **Not needed.**
4. Promoting `scripts/moodle-check.mjs` in `CONTRIBUTING.md`. **Not relevant** for now; the script stays in `scripts/` as the tool that verified Reichman.
5. **Scope:** the first version is Reichman University only.

## Appendix A: Institutions

Probed on 2026-11-27 without login (F2): each row's values are what the site itself reported. "Verified" means a real account ran the check script (§12.3); so far that is Reichman only. This table is the first content of `institutions.ts`; the address column is the `sites` template.

**Sign-in** column: *SSO* = `typeoflogin` 2 or 3 (§6.2). *Password* = `typeoflogin` 1 with no identity provider (§6.5). *Password (identity provider listed)* = `typeoflogin` 1 and the site also lists an identity provider, so some students there may have no Moodle password; whether the form works for them is spike S4 (§6.5, §14).

### A.1 Mobile service on (37 institutions: the feature can work)

| id | Institution | Hebrew name | Address | Sign-in | Notes |
|---|---|---|---|---|---|
| `runi` | Reichman University | אוניברסיטת רייכמן | `https://moodle.runi.ac.il/{yyyy}` | SSO | **Verified** 2026-11-27, Moodle 4.5.16. Forces `moodlemobile`. File responses carry two CORS values (F8). The root address redirects to last year's site. |
| `technion` | Technion | הטכניון | `https://moodle{YY}.technion.ac.il` | SSO | `moodle26` now. |
| `huji` | Hebrew University | האוניברסיטה העברית | `https://moodle.huji.ac.il/{YYYY}-{yy}` | SSO | |
| `biu` | Bar-Ilan University | אוניברסיטת בר-אילן | `https://lemida.biu.ac.il` | SSO | Anti-bot layer reported by another project: start with `paceMs: 2000` (S5). |
| `bgu` | Ben-Gurion University | אוניברסיטת בן-גוריון | `https://moodle.bgu.ac.il/moodle` | Password (identity provider listed) | S4. |
| `haifa` | University of Haifa | אוניברסיטת חיפה | `https://mw{yy}.haifa.ac.il` | Password (identity provider listed) | Host changes yearly (`mw27` now). |
| `weizmann` | Weizmann Institute | מכון ויצמן למדע | `https://feinberg.weizmann.ac.il` | SSO | |
| `hit` | HIT Holon | מכון טכנולוגי חולון | `https://md.hit.ac.il` | SSO | |
| `colman` | College of Management | המסלול האקדמי המכללה למינהל | `https://moodle.colman.ac.il` | SSO | |
| `jct` | Jerusalem College of Technology (Lev) | המרכז האקדמי לב | `https://moodle.jct.ac.il` | SSO | |
| `braude` | Braude College | המכללה האקדמית להנדסה בראודה | `https://moodle{yy}.braude.ac.il` | SSO | Host changes yearly (`moodle27` now). |
| `jce` | Azrieli College of Engineering | עזריאלי מכללה אקדמית להנדסה ירושלים | `https://moodle.jce.ac.il` | SSO | |
| `bezalel` | Bezalel | בצלאל | `https://moodle.bezalel.ac.il` | Password | |
| `shenkar` | Shenkar | שנקר | `https://online.shenkar.ac.il` | Password | |
| `achva` | Achva Academic College | האקדמית אחוה | `https://moodle.achva.ac.il` | Password (identity provider listed) | |
| `netanya` | Netanya Academic College | המכללה האקדמית נתניה | `https://el1.netanya.ac.il` | Password (identity provider listed) | |
| `wgalil` | Western Galilee College | האקדמית גליל מערבי | `https://moodle.wgalil.ac.il` | Password | |
| `zefat` | Zefat Academic College | המכללה האקדמית צפת | `https://moodle.zefat.ac.il` | Password (identity provider listed) | |
| `wingate` | Levinsky-Wingate (Wingate campus) | לוינסקי-וינגייט, קמפוס וינגייט | `https://moodle4.wincol.ac.il` | SSO | The Levinsky campus has its own site (A.2). |
| `smkb` | Kibbutzim College | סמינר הקיבוצים | `https://moodle{YY}.smkb.ac.il`, `https://moodle{yy}.smkb.ac.il` | SSO | `moodle26` now; the alias `moodle.smkb.ac.il` is blocked. |
| `beitberl` | Beit Berl College | המכללה האקדמית בית ברל | `https://moodle2.beitberl.ac.il` | SSO | |
| `dyellin` | David Yellin College | מכללת דוד ילין | `https://online.dyellin.ac.il` | SSO | |
| `kaye` | Kaye College | מכללת קיי | `https://online.kaye.ac.il` | SSO | |
| `talpiot` | Talpiot College | מכללת תלפיות | `https://moodle4.talpiot.ac.il` | SSO | |
| `herzog` | Herzog College | מכללת הרצוג | `https://learning4.herzog.ac.il` | Password (identity provider listed) | |
| `shaanan` | Shaanan College | מכללת שאנן | `https://moodle4.shaanan.ac.il` | SSO | |
| `qsm` | Al-Qasemi Academy | אקדמיית אלקאסמי | `https://moodle4.qsm.ac.il` | SSO | |
| `sakhnin` | Sakhnin College | מכללת סכנין | `https://moodle4.sakhnin.ac.il` | SSO | |
| `arabcol` | Arab Academic College for Education, Haifa | המכללה האקדמית הערבית לחינוך בישראל, חיפה | `https://moodle4.arabcol.ac.il` | SSO | |
| `jamd` | Jerusalem Academy of Music and Dance | האקדמיה למוסיקה ולמחול בירושלים | `https://moodle.jamd.ac.il` | Password | |
| `iac` | Ramat Gan Academic College | המכללה האקדמית רמת גן | `https://elearn.iac.ac.il` | Password | |
| `schechter` | Schechter Institute | מכון שכטר | `https://moodle4.schechter.ac.il` | SSO | |
| `orot` | Orot Israel College | מכללת אורות ישראל | `https://moodle4.orot.ac.il` | SSO | |
| `michlala` | Jerusalem College (Michlala) | מכללה ירושלים | `https://moodle4.michlala.edu` | SSO | |
| `hemdat` | Hemdat College | האקדמית חמדת | `https://moodle4.hemdat.ac.il` | SSO | |
| `washington` | Givat Washington College | גבעת וושינגטון | `https://moodle.washington.ac.il` | Password | |
| `emef` | Emunah-Efrata College | אמונה-אפרתה | `https://moodle4.emef.ac.il` | SSO | |

All rows except `runi` have `status: "config-checked"`.

### A.2 Mobile service off (`status: "mobile-off"`: listed in the picker with the explanation of §5.3)

| id | Institution | Hebrew name | Address | Notes |
|---|---|---|---|---|
| `tau` | Tel Aviv University | אוניברסיטת תל אביב | `https://moodle.tau.ac.il` | Off on the current-year site; **on** for the previous year at `/2025`. Another project reports the launch page disappearing at the yearly rollover, so this may change during the year: probe, don't assume. |
| `openu` | Open University | האוניברסיטה הפתוחה | `https://opal.openu.ac.il` | |
| `ariel` | Ariel University | אוניברסיטת אריאל | `https://moodlearn.ariel.ac.il` | |
| `ruppin` | Ruppin Academic Center | המרכז האקדמי רופין | `https://moodle.ruppin.ac.il` | |
| `sce` | Sami Shamoon College of Engineering | המכללה האקדמית להנדסה סמי שמעון | `https://moodle.sce.ac.il` | |
| `mta` | Tel Aviv-Yaffo Academic College | האקדמית תל אביב-יפו | `https://mama.mta.ac.il` | Web services off entirely. |
| `kinneret` | Kinneret Academic College | המכללה האקדמית כנרת | `https://moodle.kinneret.ac.il` | |
| `levinsky` | Levinsky-Wingate (Levinsky campus) | לוינסקי-וינגייט, קמפוס לוינסקי | `https://moodle.levinsky.ac.il` | |
| `oranim` | Oranim College | אורנים | `https://moodle{YY}.oranim.ac.il` | `moodle25` now. |

### A.3 Could not be probed (`status: "unreachable"`: the picker offers them; the live probe from the student's computer decides)

| id | Institution | Hebrew name | Address | Why |
|---|---|---|---|---|
| `afeka` | Afeka College of Engineering | אפקה | `https://moodle.afeka.ac.il` | Every path redirects to an SSO gateway before Moodle. The server cannot reach the API through it; expected result: unavailable. |
| `sapir` | Sapir Academic College | המכללה האקדמית ספיר | `https://moodle.sapir.ac.il` | Bot wall. |
| `telhai` | Tel-Hai | תל-חי | `https://moodle.telhai.ac.il` | Bot challenge. |
| `aac` | Ashkelon Academic College | המכללה האקדמית אשקלון | `https://moodle.aac.ac.il` | Access gateway. |
| `gordon` | Gordon College | מכללת גורדון | `https://moodle.gordon.ac.il` | Bot challenge. |
| `jmc` | Hadassah / Jerusalem Multidisciplinary College | המרכז האקדמי הרב-תחומי ירושלים | `https://moodle.jmc.ac.il` | Timed out. |
| `yvc` | Max Stern Yezreel Valley College | האקדמית עמק יזרעאל | `https://moodle.yvc.ac.il` | Timed out. |

### A.4 No Moodle found

Ono Academic College, Peres Academic Center, College of Law and Business, Sha'arei Mishpat, Shalem College and MLA Or Yehuda appear to use another system (course sites inside the Yedion portal, or HighLearn). They are not in the registry. A student there who does have a Moodle address can still paste it.

### A.5 What the table says about the design

- **Yearly addresses are common** (Reichman, Technion, HUJI, Haifa, Braude, Kibbutzim, Oranim, and archives at TAU, Afeka and Kinneret), and the "stable" alias is sometimes wrong or blocked. Hence templates plus probing (§5.2), never a stored address alone.
- **A third of the working sites use `typeoflogin` 1** (12 of 37), six of them with an identity provider listed, including the University of Haifa and BGU. The password form (§6.5) is therefore part of v1, and S4 is the most valuable spike after the pilot's own.
- **Nine institutions have the mobile service off**, including Tel Aviv University's current year and the Open University. The picker must say so up front.
- **A bot wall or gateway in front of Moodle** exists at seven. The probe from the student's own computer and network may fare better than this survey's; the result is shown either way.
