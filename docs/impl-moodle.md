# Implementation plan: Moodle connection

This is the build plan for [rfc-moodle.md](rfc-moodle.md). The RFC says **what and why**; this file says **exactly what to build, in what order, and how to know each step is done**. Each task is sized for one focused PR.

## Status

**The first version is implemented, for Reichman University only** (the maintainer's scope decision, 2026-11-27). The plan below is the plan for the whole design; this section says what exists.

### Built

| Area | What | Tasks |
|---|---|---|
| `packages/moodle` | Registry (Reichman), site validation, launch-link parsing, REST client and error mapping, contents → files, `planSync`, names | P1 to P6 |
| `packages/local-api`, `packages/core` | The Moodle contract; schema v4 (`moodle_links`, `moodle_files`) and store methods | §3.1, K1 |
| `apps/local` | `moodle/http.ts` (host, path and state rule, pacing, retries, caps), `sites.ts`, `tokens.ts`, `index.ts` (sign-in, link acceptance, courses, contents, download), streaming import into the data folder, redaction, `HttpError.kind`, `beforeExit()` on all three exits, routes, `doctor`, `uninstall` | V0 to V4, V6 to V8 |
| One-click sign-in | `tutorai moodle-link`, the control route, the macOS handler (temporary app, private-file hand-over, marker, removal) | H1, H2 |
| `apps/web` | `platform/moodle.ts`, `moodle/sync.ts`, the connect dialog, the course picker, the Moodle strip on Materials, Home and Settings entries, the website explanation | W1 to W6 |
| Tests | Unit tests in `packages/moodle`; server tests against `apps/local/test/mock-moodle.ts` (sign-in, overlapping calls, the address rule, downloads, the handler's bookkeeping, the HTTP routes, the `moodle-link` command); sync tests in `apps/web/src/moodle`; a gated real-handler test (macOS); three journeys in `e2e-local/moodle.spec.ts`; a website check in `e2e/smoke.spec.ts` | §12.1 of the RFC |
| Docs | `SECURITY.md`, `AGENTS.md`, `docs/architecture.md`, `docs/roadmap.md`, `docs/moodle.md` | R1, R3 |

### Differences from the plan below

- **Registry:** only `runi`. The other institutions of the RFC's Appendix A are not in `institutions.ts`.
- **No pasted addresses and no password form** (V5, and the `{ url }` form of `resolve`). A site that signs in inside the app is reported as `password_only`. So `login/token.php` is not an allowed path, and the public-address rule and pinned `lookup` are not needed yet.
- **Transport:** `moodle/http.ts` uses the unwrapped `fetch` from `net.ts`'s `moodleTransport()` instead of `node:https`; a test pins that no other file uses it. Move to `node:https` together with pasted addresses.
- **`MOODLE_DEFAULT_ON` is `true`** from the start; `TUTORAI_MOODLE=on|off` and `Settings.moodleEnabled` override it.
- **Windows and Linux** sign in by copy-and-paste (H3 waits for spike S1).
- **Phase 2** (M5) is not started.
- **Review:** an independent review of the code found no blocker and 14 smaller issues (overlapping sign-in calls, an uncapped error body, a double import after a tab switch, handler bookkeeping). All were fixed, each with a test.

### Verified here (macOS 27.2.1, arm64)

- `npm run typecheck`, `npm test`, and `npm run e2e:local` for the Moodle spec in Chromium and WebKit (Firefox does not launch on this macOS version; CI runs it on Linux).
- The gated handler test (`TUTORAI_HANDLER_TESTS=1`): the system delivered a `moodlemobile://` link to the temporary app, the server connected, and the app and its registration were gone afterwards.
- Against the live Reichman site, without login: the registry resolves `https://moodle.runi.ac.il/2027` as a single-sign-on site and validates its public configuration.
- Earlier the same day, with the maintainer's Reichman login (`scripts/moodle-check.mjs`): sign-in, courses, contents and a file download.

### Still needs a person

1. **The whole flow in the app with a real Reichman account** (the real site was exercised by the check script and by the unauthenticated probe, but the app's own sign-in → import has only run against the mock).
2. What each browser shows for the "open TutorAI?" prompt, and whether the scripted click on Moodle's page is enough or the student must click the link (spike S2). The waiting screen's wording assumes a prompt.
3. Whether `moodlewssettingfilter` gives single-language course names at Reichman (S3).
4. The Windows handler (S1), and the handler test on a CI macOS runner (it is not enabled in CI yet).

## 0. Ground rules

- **Stack:** TypeScript only. No new dependencies: `zod` (already used), and from Node 22 `fetch`, `node:https`, `node:dns`, `node:net` (`BlockList`), `node:crypto` (MD5 for Moodle's site id, SHA-256 for files).
- **Repo rules apply** (AGENTS.md): English in code and docs; every UI string as `t("עברית", "English")`; no telemetry. The one new kind of outside call (the student's own Moodle) is added to AGENTS.md and SECURITY.md in task R1, **before** any code that makes it is merged.
- **Security-sensitive** (core-maintainer review; added to `CODEOWNERS` in V0): `apps/local/src/moodle/`, `apps/local/src/net.ts`, `packages/moodle/src/link.ts`, `packages/moodle/src/public-config.ts`.
- **Never in a test, fixture, log or commit:** a real token, a real student's course list, or real course files. Fixtures are synthetic, shaped like the real answers.
- **The server sends error kinds, not sentences.** Every student-facing text is written in the page with `t()`.
- **Each task is done when** its tests exist and pass, its acceptance line is true, `npm run check` passes, and, for any task that touches `apps/local` or a Moodle screen, `npm run e2e:local` passes too (`check` does not run it).

## 1. Facts about the code this plan relies on

| Fact | Where |
|---|---|
| The database lives in the page (`Store` over sql.js) and is saved by the page (`Persistence`); the server only stores files. Sync logic that touches the database therefore runs in the page, and a file the server wrote is unknown to the database on disk until the page flushes. | `apps/web/src/engine.ts`, `platform/storage.ts`, `packages/core/src/db/store.ts` |
| Adding a source is `store.addSource({ course_id, name, kind, mime, path, hash, size })` then `engine.enqueue(id)`. Path convention: `courses/<courseId>/sources/<hash10>-<safeFileName(name)>`. Duplicates: `store.sourceByHash(courseId, hash)`. Size limit 60 MB. Supported kinds: `detectKind` (`pdf`, `pptx`, `docx`, `txt`, `md`, `markdown`). The stored MIME is `safeMimeFor(name)`. | `engine.ts` `addFiles` (L175-199), `packages/core/src/ingest/parsers.ts` |
| `safeFileName` is in `@tutorai/core`, which `apps/local` does not depend on. | `packages/core/src/files.ts` L41, `apps/local/package.json` |
| Schema changes: bump `SCHEMA_VERSION`, add `CREATE TABLE IF NOT EXISTS` to `SCHEMA_SQL`; `Store.migrate()` needs a block only for column changes to existing tables. | `packages/core/src/db/schema.ts`, `store.ts` L129-144 |
| Server routes are objects `{ method, path, kind: "api" \| "control" \| "public", handler }` built in `buildRoutes(ctx)`. `api` routes get the cookie, token and origin checks; `control` routes need `Authorization: Bearer <controlSecret>` and no `Origin`. | `apps/local/src/http/routes.ts`, `http/security.ts` |
| Streaming answers use `ndjson(res)`; long work calls `ctx.busy.inc()/dec()`; `abortOnClose(req, res)` returns an `AbortController`. | `routes.ts` (`/api/llm`, L58-66) |
| The server logs `e.message` of a request that fails unexpectedly (status 500), and `redact()` knows only Bearer values, JWTs, OAuth field names and `sk-…` keys. `HttpError` and the error body carry only a status and `error` text; `readJson` accepts bodies up to 64 MB unless given a smaller limit. | `apps/local/src/http/server.ts` L45-68, L116-120; `log.ts` L8-15 |
| `DataFolder` has `read`, `exists`, `write(rel, data: Uint8Array)` (temp file next to the target, then rename) and `remove`. There is no streaming write. | `apps/local/src/fs/folder.ts` L60-97 |
| Owner-only files: `writePrivate(file, data)`. Paths under the config folder: `paths()`; the folder itself: `configDir()` (honours `TUTORAI_CONFIG_DIR`). | `apps/local/src/config.ts`, `paths.ts` |
| Outbound `fetch` calls pass a global wrapper with a fixed host set (`ALLOWED_HOSTS`, `allowed(url)`). It wraps `globalThis.fetch` only; `node:https` requests do not pass through it. | `apps/local/src/net.ts` L29-38 |
| The launcher reaches a running server with the module-private `control(run, path)`: a POST **without a body**, authorised by the secret in `run.json`. | `apps/local/src/lifecycle.ts` L177-188 |
| The server stops in three ways: `shutdown()`, the update `relaunch()` (which exits without calling `shutdown`), and `Running.close()` (tests). | `lifecycle.ts` L107-126, L164-171 |
| `selfCommand()` is the binary alone, or `process.execPath` + `process.execArgv` + `process.argv[1]` in a source checkout. Under vitest that is the test runner, and a loader given as `--import tsx` resolves from the working folder. So the handler's command cannot be `selfCommand()` as it is: it is passed in (§3.2). | `lifecycle.ts` L39-42 |
| The CLI is a `switch` on the first argument in `main()`. | `apps/local/src/main.ts` |
| Server settings are a zod object with defaults in `defaultSettings()`; `saveSettings` writes the whole merged object, defaults included, so a default that changes later does not reach anyone who ever saved a setting. `claudeCodeEnabled` is the existing feature switch reported through `Hello.features`. | `packages/local-api/src/index.ts` L81-92, `config.ts` L50-89, `routes.ts` L141 |
| In the web app, `call` and `getJson(schema, …)` are module-level helpers in `platform/local-server.ts` that are **not exported** (`ndjson` is); `LocalApiError` carries only the status and the `error` text. | `apps/web/src/platform/local-server.ts` L81-131 |
| `Persistence.flush()` does not throw when a write fails; it records the error and resolves. | `apps/web/src/platform/storage.ts` L299-312 |
| The web build is embedded in the binary, so server and page always have the same version. | `apps/local/scripts/build.mjs` |
| Vitest picks up `packages/*/src/**/*.test.ts`, `apps/web/src/platform/**/*.test.ts` and `apps/local/test/**/*.test.ts`. | `vitest.config.ts` |
| The local E2E starts the server with a temp config and mocks through environment variables; `/control/test-reset` clears settings and ChatGPT state. The workflow that runs it is path-filtered. | `e2e-local/start.ts`, `routes.ts` L111-126, `.github/workflows/local.yml` |
| Today's macOS launcher is a shell-script bundle and cannot receive a link (RFC F12). The handler is therefore a separate, temporary app built by the server, which also works for installs that update themselves without re-running the installer. | `apps/web/public/install.sh` L73-98 |

## 2. Layout

```
packages/moodle/                    @tutorai/moodle (new): pure TypeScript + zod, no dependency on core
  package.json                        { "name": "@tutorai/moodle", "exports": { ".": "./src/index.ts" }, deps: zod }
  src/
    index.ts
    institutions.ts                   registry + candidateSites()
    public-config.ts                  PublicConfig schema, validateSite(), classify()
    link.ts                           findLaunchLink, describePaste, expectedSiteIds
    client.ts                         MoodleClient (injected fetch), MoodleError
    schemas.ts                        SiteInfo, RemoteCourse, CourseContents
    flatten.ts                        contents → RemoteFile[] + counts
    plan.ts                           planSync()
    names.ts                          safeName(), cleanCourseName(), looksLikeExam()
    *.test.ts                         unit tests next to each file
    fixtures/                         synthetic answers shaped like Moodle 4.5

packages/local-api/                 depends on @tutorai/moodle (shared shapes)
  src/index.ts                       + Moodle schemas (§3.1), Settings.moodleEnabled?, Hello.features.moodle, Hello.testMode

packages/core/src/db/
  schema.ts                          SCHEMA_VERSION 4, moodle_links, moodle_files
  store.ts                           Moodle methods and row types (§3.3)

apps/local/src/
  moodle/
    index.ts                          createMoodle(): the service used by routes (§3.2)
    http.ts                           the only code that contacts Moodle, over node:https behind a fetch-shaped
                                      adapter: state/host/path rules, pinned lookup, per-site queue, pacing,
                                      retries, size caps, User-Agent
    sites.ts                          resolve(), validation, the resolved-site list
    connect.ts                        pending sign-in, acceptLink, password sign-in
    tokens.ts                         connection files (0600)
    download.ts                       file → DataFolder.importStream → checks → rename
    handler/index.ts                  install / remove / cleanup, marker file, platform switch
    handler/macos.ts · windows.ts
  net.ts                             unchanged (a test pins that only moodle/http.ts uses node:https / node:http requests)
  fs/folder.ts                       + importStream(), commitPart(), discardPart()
  log.ts                             + Moodle patterns in redact()
  lifecycle.ts                       control() takes a JSON body and is exported; beforeExit() run by shutdown, relaunch and close
  http/server.ts                     HttpError gains an optional kind, sent as { error, kind }
  http/routes.ts                     /api/moodle/*, /control/moodle-link; test-reset clears Moodle state
  main.ts                            `moodle-link` subcommand; doctor line; uninstall cleanup
  paths.ts                           moodle dir, inbox, handler marker; macOS handler app path
apps/local/test/
  mock-moodle.ts                     fake Moodle with switchable faults
  moodle.test.ts · moodle-http.test.ts · moodle-handler.test.ts (gated)

apps/web/src/
  platform/moodle.ts                 typed client for /api/moodle/*
  moodle/sync.ts (+ sync.test.ts)    refresh, import, link, unlink
  ui/MoodleConnect.tsx               the connect modal
  views/MoodleImport.tsx             courses and files
  views/Materials.tsx, Home.tsx, Settings.tsx   entry points

e2e-local/moodle.spec.ts            the student journey against the mock
scripts/moodle-check.mjs            the check script that verified Reichman (extended in S0)
docs/moodle.md                      student-facing page
```

Also: `vitest.config.ts` gains `apps/web/src/moodle/**/*.test.ts`; `apps/local/package.json` and `apps/web/package.json` gain `@tutorai/moodle`; `.github/workflows/local.yml`'s path filter gains `packages/moodle/**`.

## 3. Contracts

### 3.1 HTTP (`@tutorai/local-api`)

`MoodleErrorKind`, `RemoteCourse` and `RemoteFile` are defined once, in `@tutorai/moodle` (`schemas.ts`), and re-exported here:

```ts
// in @tutorai/moodle
export const MoodleErrorKind = z.enum([
  "auth", "unavailable", "policy", "forbidden", "blocked", "network", "unsupported",
  "too_large", "wrong_type", "not_listed", "invalid_login", "other",
]);
export const RemoteCourse = z.object({
  id: z.number(), shortname: z.string(), fullname: z.string(), displayname: z.string(),
  startdate: z.number(), enddate: z.number(), hidden: z.boolean(), lastaccess: z.number().nullable(),
});
export const RemoteFile = z.object({
  key: z.string().max(600), cmid: z.number(), modname: z.string(), section: z.string(), activity: z.string(),
  filename: z.string(), filepath: z.string(), size: z.number(), modified: z.number(),
});
```

```ts
// in @tutorai/local-api
export const MoodleInstitutions = z.object({
  institutions: z.array(z.object({
    id: z.string(), name: z.object({ he: z.string(), en: z.string() }),
    status: z.enum(["verified", "config-checked", "mobile-off", "unreachable"]),
  })),
});

export const MoodleLogin = z.enum(["sso", "password", "unavailable"]);
export const MoodleCandidate = z.object({
  site: z.string(),                       // server-issued key (validated wwwroot)
  host: z.string(),                       // ASCII host, shown for pasted sites
  siteName: z.string().max(80),
  institutionId: z.string().optional(),   // absent for a pasted site
  login: MoodleLogin,
  reason: z.enum(["disabled", "mobile_off", "maintenance", "password_needs_registry"]).optional(),
});
export const MoodleResolveRequest = z.union([
  z.object({ institutionId: z.string().max(40) }),
  z.object({ url: z.string().max(300) }),
]);
export const MoodleResolve = z.object({
  candidates: z.array(MoodleCandidate),
  problem: z.enum(["offline", "timeout", "not_moodle", "refused"]).optional(),
});

export const MoodleConnection = z.object({
  site: z.string(), siteName: z.string(), institutionId: z.string().optional(),
  fullName: z.string(), connectedAt: z.string(), expired: z.boolean(),
});
export const MoodlePending = z.object({
  id: z.string(), site: z.string(), mode: z.enum(["auto", "manual"]),
  state: z.enum(["waiting", "verifying", "failed"]), error: MoodleErrorKind.optional(),
  expiresAt: z.string(),
});
export const MoodleStatus = z.object({ connections: z.array(MoodleConnection), pending: MoodlePending.nullable() });

export const MoodleStartRequest = z.object({ site: z.string().max(300) });
export const MoodleStart = z.object({
  pendingId: z.string(), launchUrl: z.string().max(600),   // both sides also run isSafeLaunchUrl(url, testMode)
  mode: z.enum(["auto", "manual"]), expiresAt: z.string(),
});
export const MoodlePasteRequest = z.object({ pendingId: z.string().max(64), text: z.string().max(4096) });
export const MoodlePasswordRequest = z.object({ site: z.string().max(300), username: z.string().max(200), password: z.string().max(500) });
export const MoodleCancelRequest = z.object({ pendingId: z.string().max(64) });
export const MoodleDisconnectRequest = z.object({ site: z.string().max(300) });
export const MoodleLinkRequest = z.object({ link: z.string().max(1100) });      // control route
export const MoodlePasteResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), kind: z.enum(["not_a_link", "wrong_site", "expired"]),
             hint: z.enum(["page_address", "signin_address", "other_moodle_page", "not_a_link"]).optional() }),
]);
export const MoodlePasswordResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), kind: MoodleErrorKind }),
]);

export const MoodleContents = z.object({
  files: z.array(RemoteFile),
  other: z.object({ textPages: z.number(), links: z.number(), external: z.number(), notImportable: z.record(z.string(), z.number()) }),
});
export const MoodleDownloadRequest = z.object({
  site: z.string(), remoteCourseId: z.number().int().positive(), key: z.string().max(600),
  courseId: z.number().int().positive(),
  knownHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(5000),
});
export const MoodleDownloadEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("progress"), received: z.number(), total: z.number().nullable() }),
  z.object({ type: z.literal("done"), path: z.string(), hash: z.string(), size: z.number(), name: z.string() }),
  z.object({ type: z.literal("duplicate"), hash: z.string() }),
  z.object({ type: z.literal("error"), kind: MoodleErrorKind }),
]);
```

- `Settings` gains `moodleEnabled: z.boolean().optional()`. It is **not** in `defaultSettings()`: the effective value is `settings.moodleEnabled ?? MOODLE_DEFAULT_ON`, a constant in `apps/local/src/moodle/index.ts` (RFC §4.4).
- `Hello.features` gains `moodle: z.boolean().default(false)`; `Hello` gains `testMode: z.boolean().default(false)`, true only under both switches of §3.4.
- Query parameters: `lang` is `he` or `en`; `fresh` is `1` or absent.
- Every Moodle route reads its body with a 16 KB limit (`readJson(req, 16 * 1024)`).
- Non-streaming errors: HTTP status with `{ error, kind }`. `HttpError` gains an optional `kind`; `LocalApiError` reads it.
- Routes: RFC §8.

### 3.2 Server service

```ts
export function createMoodle(opts?: {
  /** What the handler runs before `moodle-link …`. Default: this server's own command with absolute paths. */
  handlerCommand?: string[];
  /** For tests. */
  now?: () => number;
}): MoodleService;

export interface MoodleService {
  enabled(): Promise<boolean>;
  institutions(): MoodleInstitutions;
  resolve(input: { institutionId: string } | { url: string }): Promise<MoodleResolve>;
  status(): Promise<MoodleStatus>;
  start(site: string): Promise<MoodleStart>;                    // site must be a key from a resolve in the last 30 minutes
  paste(pendingId: string, text: string): Promise<MoodlePasteResult>;
  password(site: string, username: string, password: string): Promise<MoodlePasswordResult>;
  cancel(pendingId: string): Promise<void>;
  /** From the control route (the handler). Never throws, never reports. */
  link(text: string): Promise<void>;
  disconnect(site: string): Promise<void>;                      // aborts that site's download first
  courses(site: string, lang: "he" | "en"): Promise<RemoteCourse[]>;
  contents(site: string, remoteCourseId: number, lang: "he" | "en", fresh: boolean): Promise<MoodleContents>;
  download(req: MoodleDownloadRequest, emit: (e: MoodleDownloadEvent) => void, signal: AbortSignal): Promise<void>;
  /** Start-up and every exit path: remove our handler (if still ours), empty the inbox. */
  cleanup(): Promise<void>;
  /** Tests: forget everything. */
  reset(): Promise<void>;
}
```

`Services` (`providers/types.ts`) gains `moodle: MoodleService`, so tests inject a fake, or the real service pointed at the mock.

`http.ts` exposes one function, `moodleFetch(site, kind: "probe" | "token" | "rest" | "file", init)`, which builds the address from the site key and `kind` (callers never pass an address except the validated `fileurl` for `"file"`), applies RFC §5.4, pacing and caps, adds the User-Agent, and makes the request with `node:https` (`node:http` only for the mock under §3.4). `MoodleClient` receives a `fetch`-shaped wrapper around it bound to one site.

### 3.3 Store methods and types (`packages/core`)

```ts
export type MoodleFileState = "new" | "imported" | "skipped" | "unsupported" | "too_large" | "failed";
export interface MoodleLink { course_id: number; site: string; remote_course_id: number; remote_name: string; last_sync: string | null; last_error: string | null }
export interface MoodleFileRow { id: number; course_id: number; remote_key: string; cmid: number; modname: string; section: string; activity: string;
  filename: string; size: number; remote_modified: number; state: MoodleFileState; present: boolean; changed: boolean; source_id: number | null; error: string | null }
export interface MoodleFileChange { insert?: Omit<MoodleFileRow, "id" | "course_id" | "source_id" | "error">; update?: { id: number } & Partial<MoodleFileRow> }

moodleLink(courseId): MoodleLink | undefined
moodleLinks(): MoodleLink[]
moodleLinkFor(site, remoteCourseId): MoodleLink | undefined
linkMoodle(courseId, site, remoteCourseId, remoteName): void
unlinkMoodle(courseId): void                       // deletes the link and its moodle_files rows
setMoodleSync(courseId, at: string | null, errorKind: string | null): void
moodleFiles(courseId): MoodleFileRow[]
applyMoodleChanges(courseId, changes: MoodleFileChange[]): void   // one transaction
setMoodleFile(id, patch: Partial<Pick<MoodleFileRow, "state" | "changed" | "source_id" | "error">>): void
```

These types live in core. `planSync` in `@tutorai/moodle` declares its own structurally identical input and output types, so neither package imports the other; `apps/web/src/moodle/sync.ts` passes one to the other, and a type-level test there fails the build if they drift.

### 3.4 Tests-only switches

- `TUTORAI_TEST=1` **and** `TUTORAI_MOODLE_ALLOW_LOCAL=1` ("test mode", reported as `Hello.testMode`): a site may be `http://127.0.0.1:<port>` (the mock), `isSafeLaunchUrl` accepts that form, and the address rules are off for that host. Without both, none of these can be relaxed.
- In test mode, `TUTORAI_MOODLE_TEST_SITES=<json>` adds institutions to the server's registry (for example `[{ "id": "mock-sso", "site": "http://127.0.0.1:4401" }, { "id": "mock-password", "site": "http://127.0.0.1:4402" }]`), so the E2E can use the picker and the password form, which a pasted address never gets.
- `TUTORAI_MOODLE=on|off`: overrides `MOODLE_DEFAULT_ON` and the setting (the E2E sets `on`, because `/control/test-reset` rewrites the settings file).
- `TUTORAI_MOODLE_HANDLER=off`: always `manual` mode (the E2E default).
- `TUTORAI_HANDLER_TESTS=1`: enables `moodle-handler.test.ts`, which registers a real handler on the machine. Set only in CI.
- `/control/test-reset` calls `moodle.reset()`.

## 4. Milestones and tasks

Legend: **∥** can run in parallel with the previous task.

### M0. Spikes (throwaway branch; each result is written into the RFC's facts table)

| ID | Question | How | Decides |
|---|---|---|---|
| S0 | (Not a question: the tool the other spikes use.) Extend `scripts/moodle-check.mjs` (it already sends the two settings parameters): `urlscheme=moodlemobile` by default, `--password`, `--files N`, `--post-token`, and the launch address taken from the validated public configuration. Its output must still contain no secret. | A maintainer runs it at Reichman again | Everything below |
| S1 | Windows: does the per-user registry handler deliver the link from Chrome, Edge and Firefox? How does a Store-packaged app that claims `moodlemobile` show up, and can we detect it? Is a console window visible? | Clean Windows 11; the `reg` lines of RFC §6.3 by hand; a local page that redirects to `moodlemobile://token=test`; install the official Moodle app from the Store and repeat | H3; whether Windows leaves `manual` mode |
| S2 | The launch page (`confirmed=1`) in Chrome, Safari, Firefox and Edge: **without** a handler, does the page with the link stay visible and copyable, or does the browser replace it or show an alert? **With** the macOS handler, what does each prompt say, and is the scripted click enough or must the student click the link? | Reichman account; `scripts/moodle-check.mjs`; a prototype of H2 | The waiting screen's wording and the manual instructions per browser (W3); the 8 s timing (H4) |
| S3 | Do `moodlewssettingfilter=true` and `moodlewssettinglang` give single-language course names at Reichman? | Add the two parameters to the check script; one run | Whether `cleanCourseName` needs more than trimming |
| S4 | Institutions with in-app sign-in **and** an identity provider (BGU, Haifa, Achva, Netanya, Zefat, Herzog): does the student's password work in the password form? If not, is the cookie-based SSO path (RFC §14) worth building? | A student at BGU or Haifa runs the check script with `--password` | Those rows of the registry; a follow-up RFC or not |
| S5 | Bar-Ilan: do 20 files in a row pass with the honest User-Agent and 2 s pacing? | A BIU student runs the check script with `--files 20` | BIU's `paceMs`; whether D12 holds there |
| S6 | Token sharing: after connecting, does the official app stay signed in? After "Reset" in Security keys, do both stop? How long did the received token last? | Reichman account with the app on a phone | RFC §6.6 wording |
| S7 | (Optional) Does a POST to `webservice/pluginfile.php` with the token in the body work at Reichman and one more site? | The check script with `--post-token` | Whether to move the token out of file addresses (RFC §14) |

M1 and M2 need no spike. **S0 comes first; S2 must be done before W3.** S1 gates H3. S3 to S7 change only data, wording or a later improvement.

### M1. `packages/moodle`

| ID | Task | Acceptance |
|---|---|---|
| P1 | Package skeleton; `institutions.ts` with the entries of RFC Appendix A (A.1, A.2, A.3); `candidateSites(inst, date)`. | Tests reproduce the worked table of RFC §5.1 for 2026-11-27, and for 2027-03-01 the first Reichman candidate is `/2028`; two templates interleave and stop at six; a fixed-address site gives one candidate; ids are unique; every entry has both names; every template is `https`, has no port, and expands to a valid address; `matchInstitution(url)` maps an address on a registry template to its institution. |
| P2 ∥ | `public-config.ts`: schema, `validateSite(candidate, config)` (RFC §5.2 step 3), `classify(config, { inRegistry })` (RFC §5.3), `isSafeLaunchUrl(url, testMode)`. | One test per row of §5.3 from recorded configurations (Reichman, Technion, BGU, TAU-current, Open University). `validateSite` rejects: another host in `wwwroot`; `http:`; a port; a `wwwroot` path that is not the candidate or its ancestor; `launchurl` that is `javascript:`, `http:`, on another host or port, with a user name, a query or a fragment, outside `wwwroot`, or whose path does not end with the segments `/tool/mobile/launch.php`; a `sitename` longer than 80 characters is cut. It accepts TAU's case (probed at `/2026`, reports the root). `isSafeLaunchUrl` accepts `https:` only, plus `http://127.0.0.1:<port>` when `testMode` is true. |
| P3 ∥ | `link.ts`: `findLaunchLink`, `expectedSiteIds`, `describePaste` (port of the check script's logic). | Tests: plain link; percent-encoded; inside other text; with and without a private token; trailing `/` or `#`; longer than 1024; wrong shapes. `describePaste` returns only one of the four hint codes. |
| P4 | `schemas.ts` + `client.ts`: `MoodleClient` with injected `fetch`; parameter flattening (`courseids[0]=…`); the settings parameters; `returnusercount=0`; error mapping for both shapes of RFC F16. | Tests on canned answers: each error code → kind (RFC §9); an HTML answer → `blocked`; other non-JSON → `unsupported`; unknown fields ignored; a missing optional field doesn't fail. |
| P5 ∥ | `flatten.ts`. | Fixture with `resource`, `folder` (nested `filepath`), `page`, `url`, `lti`, `hvp`, a hidden module, a file on another host, an `http:` file, a file whose key would exceed 600 characters: exact `RemoteFile[]` and counts, plus the `key → fileurl` pairs for the server; keys identical across two fixtures that differ only in the revision number inside `fileurl`. |
| P6 | `plan.ts` (`planSync`, `fresh(file)`) + `names.ts`. | One test per cell of the table in RFC §7.3; `fresh` on a `.zip`, a `.markdown` and a file over 60 MB. `safeName` equals core's `safeFileName` on a shared list of names (the comparison test lives in `apps/web`, which depends on both). `looksLikeExam` on Hebrew and English names. `cleanCourseName` trims and collapses whitespace (more only if S3 says so). |

### M2. Server, manual mode complete

| ID | Task | Acceptance |
|---|---|---|
| V0 | Groundwork in existing files: `redact()` patterns for `wstoken`, `token`, `privatetoken` and `password` in `name=value` and JSON form, and for `moodlemobile://token=…`; `DataFolder.importStream(dir, source, { maxBytes })` (writes `incoming-<random>.part` in `dir` with the usual confinement checks, hashes, returns `{ part, hash, size, firstBytes }`), `commitPart(part, finalRel)`, `discardPart(part)`; `control()` exported and able to send a JSON body; `beforeExit()` in `lifecycle.ts`, run first by `shutdown`, `relaunch` and `close`; `HttpError.kind`; `Settings.moodleEnabled?`, `MOODLE_DEFAULT_ON = false`, `Hello.features.moodle`, `Hello.testMode`; `CODEOWNERS`; `.github/workflows/local.yml`: `packages/moodle/**` in the path filter and `TUTORAI_HANDLER_TESTS=1` for the test step. | Tests: `redact` on a message containing a `pluginfile.php?token=…` address, a `wstoken=…` body and a `{"token":"…","privatetoken":"…"}` answer; `importStream` stops at the limit and leaves nothing, refuses a `dir` outside the folder and a symlinked `dir`; `commitPart` refuses a target outside `dir`; `beforeExit` runs in each of the three exits (with `process.exit` stubbed for `relaunch`); a saved settings file without `moodleEnabled` follows the constant. |
| V1 | `paths.ts` (moodle dir, `inbox`, handler marker), `tokens.ts` (read, write, list, delete; 0600; `expiredAt`). `test/mock-moodle.ts`: public config (with switches for hostile values), the launch page (`confirmed=1` page with the link for a given passport), `token.php`, REST for the three calls, `pluginfile.php`, and faults: `expired`, `maintenance`, `challenge`, `429`, `redirectAway`, `mobileOff`, `fileJsonError`, `slow`. | Unit: file mode 0600 (POSIX); a corrupted file is ignored. The mock's answers match the recorded fixtures. |
| V2 | `http.ts`: `moodleFetch` over `node:https`, the state/host/path table of RFC §5.4, redirect handling, the pinned `lookup` with the address ranges of RFC §5.2 (pasted sites only), queue, pacing, retries, caps, User-Agent. | `moodle-http.test.ts`: every cell of the §5.4 table (allowed and refused); a redirect to another host ends the request with `unsupported`; a same-host redirect on a file is followed once and re-checked; a pasted name resolving to each refused range is refused, including public-then-private on a second lookup; a registry host resolving to a private address is allowed; pacing and retry timing with fake timers; 429 three times → `blocked`; the 256 KB and 10 MB caps. A source scan asserts that no file in `apps/local/src` other than `moodle/http.ts` imports `request` or `get` from `node:https` or `node:http`, and `fetch` to a Moodle host is still refused by `net.ts`. |
| V3 | `sites.ts`: `institutions()`, `resolve` (candidates, parallel probes, validation, keys, the 30-minute list, `problem` codes in the order of RFC §5.2 step 6). | Tests on the mock: registry and pasted addresses; a pasted IP address in dotted, bracketed and numeric form refused before any request; a pasted address on a registry template resolved as that institution; a `disabled` institution → `disabled` without a probe; hostile configurations refused; each `problem` code and their precedence; a pasted `typeoflogin` 1 site → `password_needs_registry`. |
| V4 | `connect.ts`: `start` (manual mode for now), `acceptLink`, `paste`, `cancel`, expiry; `status`. | Tests: happy path; `start` with a key that is not in the resolved list → 400, including a saved connection's key that was not resolved again; no pending → ignored; wrong passport → `wrong_site`, still `waiting`; expired; a second link for a used passport ignored; verification failure → `failed` with the kind, token not saved; a second `start` replaces the first; paste hints; the token appears in no response and no log line (asserted on captured output). |
| V5 ∥ | `password()`. | Tests: success; `invalid_login`; refused for a pasted site and for an SSO site; the password is in no log, file or error (asserted); sent in the body only (asserted on the mock). |
| V6 | `courses`, `contents` (cache keyed by site, course and language; `fresh`; the language-independent `key → fileurl` map), expiry handling. | Tests: cache hit and bypass; the map is filled by a call in either language; an expired token writes `expiredAt`, surfaces `auth`, and is still reported as expired by a new service instance (restart). |
| V7 | `download.ts` and its route. | Tests: `done` with the right hash and a final path under `courses/<id>/sources/`; `duplicate` leaves no file; over 60 MB → `too_large`, nothing left; an HTML answer → `blocked`; wrong first bytes → `wrong_type`; a JSON error body from the file endpoint → `auth`; a key not in the listing → `not_listed`; a listed file on another host is never fetched; a file answering with a redirect to another host → `unsupported`; abort mid-stream and `disconnect` mid-stream remove the part file; an old part file is removed before the next download; two downloads of the same key at once both end cleanly and leave one file; the stream always ends with exactly one final event. |
| V8 | Routes (RFC §8) with the request schemas of §3.1 and the 16 KB body limit, errors as `{ error, kind }`, `Services.moodle`, `cleanup()` at start and in `beforeExit()`, `reset()` in test-reset, `doctor` line ("Moodle: N connection(s)"), `uninstall` cleanup. | `server.test.ts` additions: every `/api/moodle/*` route refuses a foreign origin, a missing cookie, a missing token header, a body over the limit, and the feature being off (403); `/control/moodle-link` needs the secret and always answers 204. |

After M2 the feature works end to end from `curl`.

### M3. Web app

| ID | Task | Acceptance |
|---|---|---|
| K1 | `packages/core`: schema v4, the types and methods of §3.3. | `core.test.ts`: a v3 database opens and gains the tables; cascade on course delete; `source_id` becomes NULL when a source is deleted; `applyMoodleChanges` is atomic. |
| W1 | `platform/local-server.ts` exports `call` and `getJson`; `LocalApiError.kind`. `platform/moodle.ts`: typed client; `download` as an async generator over `ndjson`. | Unit test with a stubbed `fetch`: schemas enforced; the stream parsed; a stream that ends without a final event throws a `network` error. |
| W2 | `moodle/sync.ts`: `refresh`, `importFiles`, `link`, `unlink`, `shouldRefresh` (6 h), `newCount`. | `sync.test.ts` with an in-memory `Store` and a fake transport: refresh applies the plan and keeps rows on failure; import adds sources with the right kind and `safeMimeFor`, flushes before the next file, and enqueues; a flush that records an error stops the batch; `duplicate` points at the existing source; `auth` and `blocked` stop the batch; `too_large` sets that state and `wrong_type` sets `failed` with that kind; importing a `changed` row keeps the old source; "don't show again"; unlink keeps sources; the type-level check that core's and the package's row types match. |
| W3 | `ui/MoodleConnect.tsx` (after S2): the connect steps of RFC §10 (item 2) in manual mode: institution search, pasted address, year choice, the unavailable explanations with the copy-ready message to IT, the "not checked yet" line, the host for pasted sites, the `noopener noreferrer` link-button (rendered only when `isSafeLaunchUrl` passes), status polling with the three outcomes of RFC §6.2 step 8, the paste box with hints and clipboard clearing, the password form. | Its steps are added to `e2e-local/moodle.spec.ts` in the same PR (connect by paste; wrong paste → hint; a hostile mock configuration → refused; the opened page has no `window.opener`; sign-in ended → "Try again"). Every string has both languages; RTL and LTR. |
| W4 | `views/MoodleImport.tsx`: courses, then files per course with totals, type selectors, greyed reasons, the counts of what can't be imported, download progress, "Try again" on failed files. | Its steps are added to the same spec in the same PR (pick a course → import two files → they become sources and are analyzed by the fake model). |
| W5 | Entry points: Home button; the Materials strip ("Check Moodle now", "N new files", link and unlink); the Settings card. On the website the Home button opens the explanation with the install section. | Steps added to the spec (a file added on the mock → "1 new file" → import; disconnect in Settings). `e2e/smoke.spec.ts` gains a check that the website shows the explanation and makes no Moodle request. |
| W6 ∥ | Expiry across screens: any `auth` kind leads to "Sign in again" with the honest wording of RFC §6.6. | E2E with the mock's `expired` fault. |
| W7 | Complete `e2e-local/moodle.spec.ts` against the E2E list in RFC §12.1 (the password institution, a mobile-off site); `e2e-local/start.ts` starts two mocks with the switches of §3.4 (this part lands with W3, the first task that needs it). Then set `MOODLE_DEFAULT_ON = true`. | Passes in Chromium, WebKit and Firefox, against source and the built binary. |

After M3 the feature is usable by students in manual (copy-and-paste) mode on every system.

### M4. One-click hand-back

| ID | Task | Acceptance |
|---|---|---|
| H1 | `main.ts`: `moodle-link --config <dir> <link>` and, on macOS only, `moodle-link --config <dir> --from-file <path>` (inside that config's inbox; read, then delete, even when no server runs); the rules of RFC §6.3 (first `--config` only; exactly one more argument; the link pattern with `%XX`); `/control/moodle-link` wired to `acceptLink`. | Tests: a well-formed link, plain and percent-encoded, is sent; anything else → exit 0, no output, nothing sent, including a valid link followed by any extra argument and a second `--config`; a path outside the inbox refused; `--from-file` refused on other systems; the link reaches the server named by `--config`, not the default one. |
| H2 | `handler/index.ts` + `macos.ts` (RFC §6.3): the default handler command with absolute paths, marker file, before and after checks, removal, `cleanup()` in `beforeExit()`, start-up cleanup that leaves a foreign registration alone; `start()` returns `mode: "auto"` when installed. | `moodle-handler.test.ts` (gated) on macOS CI: the list in RFC §12.1 "Handler tests", with the test's own handler command. |
| H3 | `windows.ts` (after S1), including the detection S1 defines. | The same gated tests on Windows CI with `reg` and `Start-Process`. If S1 finds that a packaged app cannot be detected reliably, this task is dropped and Windows stays in `manual` mode. |
| H4 | The waiting screen in `auto` mode: wording from S2, manual help after 8 s. | Manual checklist (R4) on macOS and Windows; the E2E still runs in manual mode. |

### M5. Phase 2 (by demand, after the pilot starts)

| ID | Task |
|---|---|
| D1 | Deadlines: `mod_assign_get_assignments` and `core_calendar_get_action_events_by_timesort`; a `moodle_events` table; "Coming up in Moodle" on the course page; suggest the exam date when an event name looks like an exam. |
| D2 | Text pages: import `page`, `book` and `label` content as text sources (HTML to plain text on the server, stored as `.md`). |
| D3 | Assignment instruction files as importable files. |
| D4 | Optional "import new files automatically" per course (off by default). |
| D5 | The website transport (RFC §13). |
| D6 | Whatever S4 and S7 recommend. |

### M6. Docs, registry, release

| ID | Task | Acceptance |
|---|---|---|
| R1 | `SECURITY.md` ("Moodle connection", from RFC §11), `AGENTS.md` (the network rule and where Moodle code lives), `docs/architecture.md` (diagram branch, data model), `docs/roadmap.md`. **Merged before V2.** | Maintainer review. |
| R2 | `CONTRIBUTING.md`: "Check your institution's Moodle" with `scripts/moodle-check.mjs` (built in S0), and how to report the result so the registry entry can become `verified`. | A student who is not a programmer can follow it. |
| R3 | `docs/moodle.md` (student-facing): what it does, what TutorAI can and cannot see, where the token is, how to disconnect, why some institutions don't work. | Linked from the connect screen and Settings. |
| R4 | Manual release checklist on clean macOS and Windows: install → connect at Reichman → import a course → new-file notice → disconnect → `tutorai uninstall` leaves no handler and no app in `~/Applications`. Registry statuses updated from the spikes and from community checks. | Checklist attached to the release PR. |

## 5. Order of work for one developer

1. S0 (the check script) and R1 (rules first), then P1 to P6.
2. V0 → V1 → V2 → V3 → V4 → V6 → V7 → V8, with V5 alongside.
3. S2 (needs only the check script and a Reichman account), then K1 → W1 → W2 → W3 → W4 → W5 → W7, with W6 alongside.
4. **Ship manual mode** to pilot students at Reichman.
5. H1 → H2 → H4 on macOS; S1 → H3 on Windows. Ship one-click.
6. R2 to R4; then M5 by demand.

Spikes S3 to S7 can be done by students with accounts at any time; each ends in a small data or wording PR.

## 6. Out of scope for v1

Everything in RFC §14, plus: importing files TutorAI can't analyze (archives, videos, spreadsheets); automatic replacement of an updated file's old version.
