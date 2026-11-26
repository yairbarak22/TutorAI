# Implementation plan: TutorAI Local

## Status

**Implemented on the `local-server` branch.** All tasks below are built, with these deviations:

- **G3:** calls the Responses API with plain `fetch` + SSE parsing instead of the `openai` SDK (fewer dependencies, full control of unsupported fields).
- **Install command:** `… | sh` (the script is POSIX sh).
- **UI:** a plan becomes the active provider only from its card's "Use my plan" button, once connected.

Verified here (macOS arm64):
- **Unit tests:** core 49, server 56 (security, files, fake Claude CLI, mock OpenAI, updater).
- **E2E:** `e2e-local` in Chromium and WebKit, against both the source and the built binary.
- **Binary and installer:** built and smoke-tested; the installer handled install, tamper rejection and uninstall.

**Still needs a person with real accounts and machines (S1):**
1. A real Claude Pro account. Check `claude -p` with `--json-schema` and `--tools ""`: where `structured_output` lands, startup latency, the exact usage-limit text, and whether `claude auth login` works without a TTY.
2. A ChatGPT Plus account. Run the real SIWC flow, `/v1/models`, a `json_schema` request, and an `input_image` request.
3. Clean macOS and Windows machines. Confirm the install line shows no Gatekeeper, SmartScreen or Defender prompt.
4. Windows: Claude Code with and without Git for Windows.
5. Firefox E2E (Firefox doesn't launch on this macOS version; CI runs it on Linux).

**Maintainer setup before the first release:** create the release signing key with `node apps/local/scripts/release-key.mjs <file>`. Add the private key as the GitHub secret `TUTORAI_RELEASE_SIGNING_KEY`, and paste the public key into `apps/local/src/update/signing.ts`. Then tag `v0.1.0`.

**Security review fixes (after the build):**
- **ChatGPT:** refresh race; sign-out now allows switching accounts; scope checked before saving; expiry fallback.
- **API and launcher:** a per-install API token in addition to the cookie; the launcher verifies the server's proof of its secret; a single-server lock; quit and restart end open streams and kill CLI children.
- **Updates:** signed updates; Windows update rollback.
- **Installers:** robust checksum parsing; the PowerShell installer no longer closes the window and swaps a running exe safely.
- **Smaller fixes:** `--flag=value` arguments to the CLI; clear local-model proxy errors; `uninstall` revokes the ChatGPT session.

This is the build plan for [rfc-local-server.md](rfc-local-server.md). The RFC says **what and why**; this file says **exactly what to build, in what order, and how to know each step is done**. Each task is sized for one focused PR.

## 0. Ground rules

- **Language and stack:** TypeScript only, Node 22 at runtime (the same Node our tests run on). Server dependencies: `zod` (already in the repo), `jose`, `openai`. No native modules and no web framework: `node:http` is enough for about 20 routes.
- **Repo rules still apply** (AGENTS.md): English in code and docs, every UI string as `t("עברית", "English")`, no telemetry, and no new external calls beyond the allowlist in RFC §4.2.
- **Security-sensitive files** (core-maintainer review, add to CODEOWNERS): `apps/local/src/http/security.ts`, `apps/local/src/fs/**`, `apps/local/src/providers/chatgpt/tokens.ts`, `apps/local/src/providers/claude-code/env.ts`, `apps/local/src/update/**`, `apps/web/public/install.*`.
- **Each task is done when:** `npm run check` passes, the task's tests exist and pass, and its acceptance line below is true.

## 1. Facts verified while writing this plan

| Fact | Source |
|---|---|
| Claude Code CLI **2.1.332** (npm `@anthropic-ai/claude-code`) documents `-p`, `--input-format stream-json`, `--output-format stream-json`, `--include-partial-messages`, `--model`, `--system-prompt <text>`, `--tools ""`, `--strict-mcp-config`, `--setting-sources`, `--permission-mode`, `--disable-slash-commands`, `--effort`, `--no-session-persistence`, and **`--json-schema <schema>`** (inline JSON, print mode only). | `claude --help` |
| `--max-turns` and `--system-prompt-file` work but are **not** in `--help`. Rakazo uses them. **We use only documented flags:** `--system-prompt` inline, and no `--max-turns` (with no tools there is nothing to loop on). | `claude --help` |
| `claude auth login` has `--claudeai` (the default, subscription) and `--console`. `claude auth status --json` returns `{ loggedIn, authMethod, apiProvider, loginExpiresAt, … }`. | `claude auth --help`, `claude auth status --json` |
| `zod` 4.6.7 in the repo has `z.toJSONSchema`. | `node -e` |
| Ingestion is already **sequential**: one source at a time, and one batch at a time in `packages/core/src/ingest/pipeline.ts:127`. **No core change is needed for plan limits**; a server-side semaphore is enough. | code |
| `FileStore` (`packages/core/src/files.ts`) is only `write / read / exists / remove / label / kind`. The server's file API needs nothing more. | code |
| `LLMApi` has no abort signal. Cancellation is "client disconnects → server kills the child process". | code |
| The PWA service worker (`vite-plugin-pwa`, `navigateFallback` → `index.html`) **would swallow navigations to `/open` and `/auth/callback`**. They must be denylisted (task L1). | code |
| Node 22 has Single Executable Applications with embedded `assets` (`node:sea` `getAsset`, `isSea`). We use **Node SEA**, not Bun, so the runtime matches the tests. | Node docs |
| `ingestSource` turns **every** error into status `"error"` (`pipeline.ts:97-101`) and `Engine.start` re-queues only `pending/parsing/analyzing` (`engine.ts:108`). A retry re-parses and reruns every batch from 0. The OCR loop swallows errors (`pipeline.ts:69`). **So plan limits need a small core change (task K1).** | code |
| `App.tsx:40` starts the engine only with an API key, session key, demo or local-model config. A plan provider has none of these, so **the gate must change (W4)**. | code |
| `LLMCallOptions` has no `history`; only `stream()` takes it (`tool.ts:130`). `Engine.provider` is derived with `instanceof` and also includes `"demo"`; `writer` returns "Claude" for any non-local provider (`engine.ts:137-145`). Usage cost comes from `PRICES[u.model]` (`Settings.tsx:29`). | code |
| `Persistence` flushes on `visibilitychange` and writes the lock on `pagehide` (`storage.ts:305-319`). A normal `fetch` can be cancelled at `pagehide`, and `keepalive` bodies are limited to 64 KB. | code |
| OpenAI `/v1/models` (SIWC) returns `{ models: [{ slug, display_name, visibility }] }`, not the usual `data` list, so the SDK's `models.list()` is not used. | SIWC docs |

## 2. Package layout

```
packages/local-api/                 @tutorai/local-api: the HTTP contract, shared by server and web
  package.json                        { "name": "@tutorai/local-api", "exports": { ".": "./src/index.ts" }, deps: zod }
  src/index.ts                        zod schemas + inferred types for every request/response/event (§3)

apps/local/                         @tutorai/local: the server and CLI
  package.json                        deps: @tutorai/local-api, zod, jose, openai · devDeps: esbuild, postject
  scripts/build.mjs                   web build → esbuild bundle → SEA blob with assets → binary (task L11)
  src/
    main.ts                           argv router: (none)|open · serve · stop · doctor · uninstall · --version
    paths.ts                          ~/.tutorai layout, default data dir, binary path per OS
    config.ts                         settings.json + host-id + run.json (atomic, 0600)
    log.ts                            rotating log, redaction of tokens/prompts
    lifecycle.ts                      start detached, single instance, heartbeat watchdog, shutdown
    http/
      server.ts                       node:http server, router, NDJSON helper, static files
      security.ts                     Host / Origin / cookie / X-TutorAI checks, one-time codes, control secret
      static.ts                       serves embedded web assets (SEA) or apps/web/dist (dev); MIME table; CSP header
      routes/{hello,session,fs,llm,connections,settings,update,local-proxy}.ts
    net.ts                            fetch wrapper with the outbound allowlist
    fs/folder.ts                      data folder: resolve-inside check, atomic write, read, exists, remove, browse
    providers/
      types.ts                        Provider interface (§3.3)
      semaphore.ts                    global limit of 2 concurrent model calls
      claude-code/{find,env,install,auth,run,parse,errors}.ts
      chatgpt/{oauth,tokens,refresh,models,run,errors}.ts
      local/proxy.ts
    update/{check,download,swap}.ts
  test/
    fake-claude.mjs                   fake CLI driven by FAKE_CLAUDE_SCENARIO
    mock-openai.ts                    in-process mock of auth.openai.com + api.openai.com
    *.test.ts

apps/web/src/platform/
  local-server.ts                     detect /api/hello, typed client (uses @tutorai/local-api)
  server-llm.ts                       ServerLLM implements LLMApi
  storage.ts                          + ServerFileStore, server-first restoreStorage()
apps/web/src/ui/{ConnectionCards,InstallLocal,FolderChooser}.tsx
apps/web/public/{install.sh,install.ps1}
.github/workflows/local.yml
```

Root changes: add `apps/local/src`, `apps/local/test` and `packages/local-api/src` to `tsconfig.json` `include`; add `apps/local/**/*.test.ts` to `vitest.config.ts`. `packages/*` is already a workspace.

## 3. Contracts

### 3.1 HTTP API (`@tutorai/local-api`)

Every `/api/*` route needs the session cookie and passes the request-origin check (RFC §4.2: a foreign `Origin` is rejected; with no `Origin`, `Sec-Fetch-Site` must be `same-origin` or `none`). Every non-GET also needs `X-TutorAI: 1`. **No GET or HEAD changes state.** Responses carry `X-Content-Type-Options: nosniff` and `Cross-Origin-Resource-Policy: same-origin`. Streams are NDJSON (`application/x-ndjson`, one JSON object per line, flushed per event).

| Method & path | Request | Response |
|---|---|---|
| `GET /open?code=` | one-time code | `302 /` + `Set-Cookie: tutorai_session=…; HttpOnly; SameSite=Strict; Path=/` · bad or used code → `403` page "Open TutorAI from its icon" |
| `POST /control/code` | `Authorization: Bearer <controlSecret>` (no cookie or Origin; Host check only) | `{ code }` |
| `POST /control/quit` | `Authorization: Bearer <controlSecret>` | `204`, then exit (used by `tutorai stop` and `uninstall`) |
| `GET /api/hello` | – | `{ app: "tutorai-local", version, platform, arch, dataDir, features: { claudeCode: boolean, chatgpt: boolean } }` |
| `POST /api/heartbeat` | – | `204` |
| `POST /api/quit` | – | `204`, then the process exits after the response flushes |
| `HEAD /api/fs/file?path=` | relative path | `200` / `404` |
| `GET /api/fs/file?path=` | | bytes (`application/octet-stream`) / `404` |
| `PUT /api/fs/file?path=` | bytes | `204` |
| `DELETE /api/fs/file?path=` | | `204` (also when missing) |
| `GET /api/fs/folder` | | `{ path, label }` |
| `PUT /api/fs/folder` | `{ path }` | `{ path, label }`; must be inside the home dir, created if missing, write-tested |
| `GET /api/fs/browse?path=` | absolute dir inside home | `{ path, parent, dirs: string[] }` (directories only, no dotfiles) |
| `POST /api/llm` | `LLMRequest` | NDJSON `LLMEvent`s |
| `GET /api/connections` | | `Connections` |
| `POST /api/connections/claude-code/install` | `{ consent: true }` | NDJSON `{type:"log",line}` … `{type:"done",ok,error?}` |
| `POST /api/connections/claude-code/login` | | `{ started: boolean, manualCommand: "claude auth login" }` |
| `POST /api/connections/claude-code/logout` | | `204` |
| `POST /api/connections/chatgpt/start` | | `{ authorizeUrl }` (the page opens it in a new tab from the click) |
| `GET /auth/callback` | OAuth params | HTML: "Connected, you can close this tab" or a readable error. No cookie needed; `state` is the check |
| `POST /api/connections/chatgpt/logout` | | `{ revoked: boolean }` |
| `GET /api/settings` / `PUT /api/settings` | `Partial<Settings>` | `Settings` |
| `GET /api/update` | | `{ current, latest: string \| null, staged: boolean, auto: boolean }` |
| `POST /api/update/restart` | | `204`; the server re-execs itself and the page reloads after `/api/hello` answers |
| `POST /api/local-proxy` | `{ path, method, headers, body }`; forwarded only to the **configured** local model server (`settings.localModelBase`, which must be `http://localhost:<port>` or `http://127.0.0.1:<port>` and not our own port), only for paths under `/api/` or `/v1/`; `Cookie`, `Authorization` and `Origin` are stripped | the upstream response streamed through |

### 3.2 Core types

```ts
type LocalProvider = "claude-code" | "chatgpt";
type Effort = "low" | "medium";

interface LLMRequest {
  provider: LocalProvider;
  tier: "fast" | "smart";
  system?: string;
  context?: string;                       // course material, sent as data
  prompt: string;
  images?: { mediaType: "image/png" | "image/jpeg"; base64: string }[];
  history?: { role: "user" | "assistant"; content: string }[];   // only from stream(); LLMCallOptions has none
  jsonSchema?: Record<string, unknown>;    // from z.toJSONSchema on the web side
  maxTokens?: number;                      // advisory; ChatGPT ignores it (unsupported field)
  tag?: string;
}

type LLMEvent =
  | { type: "delta"; text: string }
  | { type: "result"; text: string; json?: unknown; model: string; usage: { input: number; output: number; cacheRead: number } }
  | { type: "error"; kind: "auth" | "rate_limit" | "refusal" | "invalid_output" | "network" | "not_installed" | "not_eligible" | "other";
      message: string; resetAt?: string };

interface Connections {
  claudeCode: { installed: boolean; path?: string; version?: string; versionOk: boolean;
                loggedIn: boolean; authMethod?: string; needsGitBash?: boolean };
  chatgpt:    { signedIn: boolean; email?: string; models?: { slug: string; name: string }[] };
}

interface Settings {
  provider?: "claude" | "local" | "hybrid" | LocalProvider;   // mirrored from the web app (survives a port change)
  models: { "claude-code": { fast: string; smart: string }; chatgpt: { fast: string; smart: string } };
  dataDir: string;
  autoUpdate: boolean;
  claudeCodeEnabled: boolean;   // default true (RFC §9); a kill switch for one release if ever needed
  localModelBase?: string;      // the Ollama / LM Studio address the proxy may reach
  chatgptWelcomeShown: boolean;
}
```

Defaults: `models["claude-code"] = { fast: "claude-haiku-5-5", smart: "claude-sonnet-5-5" }`. `models.chatgpt` is filled after sign-in from `/v1/models` (`models[]` with `visibility === "list"`, `display_name` → `name`): the first listed model is smart; the cheapest-sounding one (`mini`/`nano` in the slug, else the last listed) is fast.

### 3.3 Provider interface (server)

```ts
interface Provider {
  call(req: LLMRequest, emit: (e: LLMEvent) => void, signal: AbortSignal): Promise<void>; // must emit exactly one result or error
}
```

`routes/llm.ts` validates with zod, picks the provider, takes a `semaphore` slot, wires `req.on("close")` to an `AbortController`, and writes events as NDJSON.

## 4. Milestones and tasks

Dependencies: **S1 → L0 → (L1 ∥ L2 ∥ K1) → (L3 ∥ L4) → L5 → W1…W4 (+T1 demo slice) → (C1…C5 ∥ G1…G4) → U1…U4 → R1…R3**. R1 can start right after L5 so the binary is exercised early. Tasks marked ∥ can go to different people.

### M0. Spike (2–3 days, throwaway branch)

**S1. The open questions in RFC §14.** Write the results into the RFC.
1. On a Pro account: `echo '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}' | claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --model claude-haiku-5-5 --system-prompt "Answer briefly" --tools "" --strict-mcp-config --setting-sources "" --permission-mode dontAsk --disable-slash-commands --no-session-persistence`. Record the event shapes and the startup latency.
2. Same call plus `--json-schema '<flashcards schema from z.toJSONSchema>'`. Confirm it succeeds with `--tools ""`, find where the parsed object lands in the `result` event (expected `structured_output`), and capture a fixture.
3. Same call with an image block. Then a usage-limit message (exhaust a test account or capture from support logs) to fixture its text.
4. Run `claude auth login` spawned with `stdio: "ignore"` and no TTY. Does it open the browser and complete? Repeat on Windows.
5. Windows: does `claude.exe` from the native installer run without Git for Windows in `-p` mode? Is an npm-installed `claude.cmd` common? (We support only the native `claude.exe`, task C1, because `cmd.exe` can't pass a multi-line system prompt or long JSON schema.)
6. ChatGPT Plus account from Israel: full SIWC flow by hand (RFC §6), `/v1/models`, a Responses call with `text.format: {type: "json_schema", strict: false}`, and one with an `input_image`. The SIWC docs don't list either as supported or unsupported, so both need a recorded answer.
7. Build a hello-world Node SEA with one asset on macOS arm64 and Windows. Install via a draft `install.sh` / `install.ps1` on clean VMs. Confirm there is no Gatekeeper or SmartScreen prompt and Defender doesn't flag it.

**Done when:** every item has a recorded answer and fixture files exist under `apps/local/test/fixtures/`.

### M1. Server skeleton

**L0. Workspace scaffolding.** Create `packages/local-api` (schemas from §3) and `apps/local` (empty `main.ts`). Update `tsconfig.json` include and `vitest.config.ts` include, add CODEOWNERS entries, add `tsx` as a root devDependency, and add `"local:dev": "npm run build && tsx apps/local/src/main.ts serve --dev"` to the root `package.json`. **`apps/local` imports only `@tutorai/local-api`, `zod`, `jose` and `openai`, never `@tutorai/core` or the web app**, so the bundle stays small and needs no browser APIs.
*Accept:* `npm run typecheck` passes with the new packages.

**L1. Web app changes for being served locally.**
- New `apps/web/src/platform/sw-denylist.ts` exporting `SW_DENYLIST = [/^\/(api|open|auth|control)(\/|\?|$)/]`. `vite.config.ts` imports it into `workbox.navigateFallbackDenylist`.
- `NETWORK_POLICY` already allows `'self'`; no change.

*Accept:* `sw-denylist.test.ts` asserts `/open?code=x`, `/auth/callback?…`, `/api/hello` and `/control/code` match and `/`, `/#/course/1` don't; the existing e2e still passes.

**L2. Config, paths, logging** (`paths.ts`, `config.ts`, `log.ts`).
- `~/.tutorai/` holds `settings.json`, `host-id`, `session.key` (32 random bytes, 0600, created once), `run.json` (`{ pid, port, controlSecret, version }`), `chatgpt/`, `logs/`.
- Writes go to `*.tmp` then rename, with mode 0600 (`fs.chmod` no-op on Windows; set an ACL with `icacls <file> /inheritance:r /grant:r %USERNAME%:F` there).
- The default data dir is `~/Documents/TutorAI`, falling back to `~/TutorAI` when Documents is missing.
- The log redacts anything matching `Bearer \S+`, `eyJ[\w-]+\.[\w-]+\.[\w-]+`, `refresh_token`, and request bodies.

*Accept:* tests for the atomic write, 0600 mode (POSIX), and redaction.

**K1. Core: resumable ingestion on plan limits** (`packages/core`; this RFC is its RFC).
- `LLMError` (`llm/anthropic.ts:24`) gains an optional third constructor argument `resetAt?: string` (ISO time), and `toLLMError` keeps it.
- `ingest/pipeline.ts`:
  - The OCR `catch` (line 69) rethrows when `e instanceof LLMError && e.kind === "rate_limit"`.
  - The outer `catch` (line 97) sets status **`"waiting"`** (new value in the `status` union at `db/store.ts:22`) instead of `"error"` for `rate_limit`, keeps the progress value, and rethrows.
  - **Skip work already done:** `sources` gains `analyzed_batches INTEGER DEFAULT 0` and `batch_chars INTEGER` (added in `Store.migrate()`, `db/store.ts:126`, the same way as `t_start`). `analyzeSource` saves the batch index after each batch. On resume, if the source already has sections and `batch_chars` equals the current batch size, parsing and `replaceSections` are skipped and analysis starts at `analyzed_batches`; otherwise it starts over as today.
- `apps/web`: `Engine.start` (line 108) also re-queues `waiting`. `Materials.tsx` shows `waiting` like `analyzing`, with the reset message.

*Accept:* `core.test.ts` — a fake LLM that throws `rate_limit` at batch 3 of 5 leaves status `waiting` with `analyzed_batches = 2`; a second `ingestSource` call makes only 3 more batch calls and no OCR or parse calls; a non-rate-limit error still gives `"error"`.

**L3. HTTP server, static files, security** (`http/server.ts`, `static.ts`, `security.ts`).
- Bind `127.0.0.1`. Try port 4317, then 4318–4327. With `--port N --strict-port` (used by restarts), retry N for 10 s instead of falling back.
- A request whose `Host` is `localhost:<port>` gets `308` to the same URL on `127.0.0.1:<port>`, so there is exactly one origin for cookies and browser storage.
- Static files: in SEA mode `sea.getAsset("web/<path>")`, otherwise `apps/web/dist`. MIME types include `.wasm` → `application/wasm` and `.mjs` → `text/javascript`. Unknown paths fall back to `index.html`. Send `Cache-Control: no-cache` for `index.html` and `sw.js`, and `immutable` for hashed assets. Send the CSP as a header too.
- Security middleware as in RFC §4.2. One-time codes: 32 random bytes, single-use, 60 s TTL, at most 20 outstanding.
- **Session cookie survives restarts:** value = `<issuedAt>.<HMAC-SHA256(session.key, issuedAt)>`, valid for 30 days, `Max-Age` 30 days. An update restart or idle exit therefore doesn't lock out an open tab.
- `controlSecret` is 32 random bytes per run and lives in `run.json`.
- **Origin check:** a present `Origin` must equal `http://127.0.0.1:<port>`. With no `Origin` (browsers omit it on same-origin GET/HEAD), `Sec-Fetch-Site` must be `same-origin` or `none`, because `same-site` would include any page on another `127.0.0.1` port, and cookies ignore ports.

*Accept:* `security.test.ts` covers every case in RFC §12 ("Security middleware"), plus: same-origin GET without `Origin` → 200; `Sec-Fetch-Site: same-site` → 403; a cookie signed with another key → 401; an expired cookie → 401; `localhost` → 308; static MIME and fallback.

**L4. Data folder API** (`fs/folder.ts`, `routes/fs.ts`).
- `resolveInside(root, rel)`: reject absolute paths, `..`, NUL and drive letters; `realpath` the parent and require the result to start with `realpath(root) + sep`.
- Writes: `mkdir -p`, then `*.tmp-<rand>`, then `rename`. On Windows, retry `rename` 5× with 50 ms back-off on `EPERM`/`EBUSY`, because sync clients hold handles.
- `browse` lists directories only, inside `os.homedir()`.

*Accept:* tests for traversal, symlink escape, atomic replace, and browse confinement.

**L5. Lifecycle and CLI** (`main.ts`, `lifecycle.ts`).
- `tutorai` / `tutorai open`: if `run.json` points at a live process whose `/api/hello` answers, get a code from `POST /control/code`. Otherwise spawn `process.execPath serve` detached (`stdio: "ignore"`, `windowsHide: true`), wait up to 10 s for `run.json` and `/api/hello`, and get the code. Then open `http://127.0.0.1:<port>/open?code=…` with `open` / `start ""` / `xdg-open`.
- `serve`: single instance (`run.json` + pid check), write `run.json`, start the watchdog. Exit after 60 min with no `/api/*` request at all (heartbeats count, and so does any other API call) and no active LLM call or install. On exit remove `run.json`.
- `stop`: `POST /control/quit` with the control secret.
- `doctor`: prints version, OS, port, data dir, the claude path and version, and whether ChatGPT is signed in (no tokens), for support.
- `uninstall`: see U3.

*Accept:* a test that spawns `serve` on a temp HOME, opens twice (one process), and stops.

### M2. Web app integration

**W1. Detection and client** (`apps/web/src/platform/local-server.ts`).
- `detectLocalServer()`: `fetch("/api/hello", { credentials: "same-origin" })` with a 1.5 s timeout, only when `location.hostname` is `127.0.0.1` or `localhost` and the port isn't Vite's 5173 or 4173. Otherwise it's `null` without any request, so the GitHub Pages build never calls it.
- A typed `api` object with one function per route, parsing responses with `@tutorai/local-api`. NDJSON reader: `response.body.pipeThrough(new TextDecoderStream())`, split on `\n`.
- 30 s heartbeat whenever the tab is open, visible or not; browsers throttle background timers to about 1/min, which is enough for the 60 min watchdog.

*Accept:* unit tests with a mocked `fetch`.

**W2. `ServerFileStore` and storage** (`storage.ts`).
- `ServerFileStore implements FileStore` (`kind: "folder"`, `label` = dataDir with `~` substituted).
- `restoreStorage()`: when the local server is present, return `{ status: "ready", root: { mode: "folder", files: new ServerFileStore() } }` first. The `Persistence` lock and heartbeat logic is unchanged and works on top.
- `Onboarding.tsx`: in local mode `choose()` uses the server root and skips step 2 (where to save). U1 later redesigns this step; W2 only makes it work.
- **Tab close:** `ServerFileStore.write` uses `fetch(..., { keepalive: true })` when the body is ≤ 60 KB (the lock file on `pagehide`). The DB itself is flushed on `visibilitychange`, which fires before `pagehide` while the page is still alive. This is the same window the web version has today; the 700 ms debounce is unchanged.

*Accept:* the T1 demo slice creates a course, restarts the server, reloads, and the course is still there in Chromium, WebKit and Firefox.

**W3. `ServerLLM`** (`server-llm.ts`).
- Builds an `LLMRequest` from `LLMCallOptions`; `history` only in `stream()`, where the signature has it.
- `object()`: `jsonSchema: z.toJSONSchema(schema, { target: "draft-7" })`, then `schema.safeParse(result.json ?? JSON.parse(stripFences(result.text)))`. On failure, retry once with `prompt + "\n\nYour previous reply did not match the schema: " + issues`, then throw `LLMError("invalid_output")`.
- `onOutput` gets the running length of the delta text.
- Map `kind` to `LLMError`: `not_installed`/`not_eligible` → `auth` with a specific message, `resetAt` → message "Your plan's limit resets at HH:MM".
- Pass `usage` to `UsageEvent` with `model` prefixed `plan:` so the Usage view shows "included in your plan".

*Accept:* unit tests: valid object, fenced JSON, invalid → repair → ok, invalid twice → error, each error kind.

**W4. Engine and settings wiring** (`engine.ts`, `secrets.ts`).
- `secrets.Provider` gains `"claude-code" | "chatgpt"`; `Engine.provider` gains them too (it also keeps `"demo"`).
- **Boot gate (`App.tsx:40`):** `detectLocalServer()` and `GET /api/settings` run *before* the gate. Hydrate `secrets` (provider, models) from the server settings, then start the engine when the existing conditions hold **or** the provider is a plan provider. `setProvider` also does `PUT /api/settings`.
- `configureLLM()` stays synchronous; it reads the already-hydrated `secrets` and the module-level `localServer`. For a plan provider with the server present, `llm = new ServerLLM(provider)`. Hybrid: when `getHybridSmart()` (new setting, default `"claude"`) is a plan provider, `TieredLLM(loc, ServerLLM)`.
- Replace the `instanceof`-based `this.provider` derivation with an explicit variable set in each branch. `writer` returns "Claude" for `claude`/`claude-code`, "ChatGPT" for `chatgpt`, and the existing strings otherwise.
- Local models in local mode: a `proxyFetch` that posts to `/api/local-proxy` is passed to `LocalLLM` **and** to `listLocalModels` (`LocalModelSetup.tsx:27`). `LocalModelSetup.tsx` hides the CORS step and saves the base URL to `settings.localModelBase`.
- `Settings.tsx` usage: rows whose `model` starts with `plan:` show "Included in your plan" instead of a price.

*Accept:* `npm test` passes; a unit test covers the boot gate for each provider; the T1 demo slice passes.

### M3. Claude plan (∥ with M4)

**C1. Find** (`claude-code/find.ts`). Candidate paths as in RFC §5.1, then `PATH`, then `$SHELL -lic 'command -v claude'` (5 s, skipped on Windows). Run `--version` (parse `^(\d+\.\d+\.\d+)`), `versionOk = semver >= MIN`, with `MIN = 2.1.280` (what Rakazo requires for the same flags) until S1 sets a final value. Windows: only the native `claude.exe` counts as installed; an npm `claude.cmd` alone gives `installed: false` with the hint "Reinstall with the official installer". `needsGitBash` comes from S1. Cache for 30 s; `/api/connections` and install/login invalidate it.
*Accept:* tests with temp dirs holding fake executables.

**C2. Env and run** (`env.ts`, `run.ts`, `parse.ts`, `errors.ts`).
- `env.ts`: allowlist `PATH HOME USER LOGNAME SHELL LANG LANGUAGE LC_* TMPDIR TEMP TMP SystemRoot SYSTEMROOT windir ComSpec PATHEXT APPDATA LOCALAPPDATA USERPROFILE HOMEDRIVE HOMEPATH CLAUDE_CONFIG_DIR`, plus `DISABLE_AUTOUPDATER=1 DISABLE_AUTO_COMPACT=1 CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 CLAUDE_CODE_DISABLE_CLAUDE_MDS=1 DISABLE_TELEMETRY=1`. Prepend the folder of the found `claude` binary to `PATH`.
- `run.ts`: `mkdtemp` as `cwd`. Args:
  ```
  -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages
  --model <settings.models["claude-code"][tier]> --system-prompt <system>
  --tools "" --strict-mcp-config --setting-sources "" --permission-mode dontAsk
  --disable-slash-commands --no-session-persistence --effort <low for fast | medium for smart>
  [--json-schema <JSON.stringify(jsonSchema)>]
  ```
  Spawn the absolute path with `shell: false` (always an executable, never `.cmd`). stdin gets one user message: blocks `[{type:"text", text:"<course_material>\n"+context+"\n</course_material>"}?, ...history flattened as "Earlier in this conversation:" text, ...images, {type:"text", text: prompt}]`, then close.
- `parse.ts`: read stdout lines. `stream_event` with `content_block_delta`/`text_delta` → `delta`; `result` → `result` (`text: result.result`, `json: result.structured_output`, usage from `result.usage`), or an error when `is_error`.
- `errors.ts`: classify by exit code, stderr tail and result text: not logged in / `authentication` → `auth`; `usage limit|rate limit|resets` → `rate_limit` with `resetAt` parsed when present; `ENOENT` → `not_installed`; else `other`.
- Abort/timeout: SIGTERM → 3 s → SIGKILL (Windows `taskkill /pid <pid> /T /F`); 10 min timeout; `rm -rf` the temp dir in `finally`.

*Accept:* tests with `fake-claude.mjs` scenarios `ok`, `ok-json`, `deltas`, `is-error`, `usage-limit`, `not-logged-in`, `crash`, `hang`, `slow-exit`. Assert the env has no `ANTHROPIC_API_KEY` even when the parent process has it, and the temp dir is gone.

**C3. Install** (`install.ts`). Requires `{consent: true}`. Spawns the official installer command (RFC §5.2) and streams stdout/stderr lines as `log` events; 5 min timeout; re-runs Find afterwards. When Windows needs Git (from C1) it returns `done:false` with an error that tells the student to install Git for Windows, with the link.
*Accept:* a test with the command injected as a fake script.

**C4. Auth** (`auth.ts`). `login`: spawn `claude auth login --claudeai` detached (`stdio: "ignore"`), keeping the handle so a second click doesn't start a second one. If S1 found that a TTY is needed, don't spawn; just return `started: false` and the UI shows the copyable command. `status`: `claude auth status --json`, parsed with zod (`loggedIn`, `authMethod`). `logout`: `claude auth logout`.
*Accept:* fake-CLI tests for all three.

**C5. Claude connection UI** (`ConnectionCards.tsx`, Claude card).
- The notice text from RFC §10.3 with a link to `https://code.claude.com/docs/en/legal-and-compliance`.
- Checklist rows: Installed [Install → consent dialog → live log], Signed in [Sign in → "Finish signing in in your browser" + copyable `claude auth login` + poll every 2 s for up to 5 min], Ready [Use Claude].
- Hidden when `features.claudeCode` is false.

*Accept:* e2e T1 path with the fake CLI.

### M4. ChatGPT plan (∥ with M3)

**G1. OAuth** (`chatgpt/oauth.ts`).
- `start()`: create `state`, `nonce`, PKCE verifier (32 random bytes, base64url), and a pending entry with a 10 min TTL. Build the authorize URL exactly as in RFC §6.2, with `redirect_uri = http://127.0.0.1:<port>/auth/callback`.
- `callback(query)`: look up `state`; handle `error`; require `client_id` for a new registration; POST the token exchange (form-encoded); validate the ID token with `jose.createRemoteJWKSet(new URL(jwks_uri))` from `https://auth.openai.com/.well-known/openid-configuration` (cached 1 h), checking `issuer`, `audience: client_id`, and `nonce`; require the `chatgpt.tokens.use.direct` scope; save with `tokens.ts`.
- The callback HTML is a minimal bilingual page that closes itself if `window.opener` is set.

*Accept:* `mock-openai.ts` tests: new registration, returning sign-in, `access_denied`, state mismatch, nonce mismatch, wrong audience, missing scope, `invalid_grant`.

**G2. Tokens and refresh** (`tokens.ts`, `refresh.ts`). One file per issued client ID: `~/.tutorai/chatgpt/<client_id>.json` (0600, atomic) with the record from RFC §6.5, plus `active.json` → client ID. `getAccessToken()` refreshes when it expires in under 120 s, behind an in-process mutex; it saves the access token, expiry, scopes and rotated refresh token together. `invalid_grant` on refresh → mark signed out and keep the client ID. `logout()` revokes at `revocation_endpoint` (3 tries with back-off), then clears the tokens.
*Accept:* tests for the concurrent refresh (one request), rotation persisted, `invalid_grant` → signed out, revoke failure still clears locally and returns `revoked: false`.

**G3. Models and run** (`models.ts`, `run.ts`, `errors.ts`).
- Models: plain `GET /v1/models` with the bearer token (not the SDK's `models.list()`), read `models[]`, keep `visibility === "list"`, cache 1 h. Fill `settings.models.chatgpt` on first sign-in.
- Run: `new OpenAI({ apiKey: accessToken, baseURL: "https://api.openai.com/v1", maxRetries: 0, fetch: allowlistedFetch })`, then `responses.create` with:
  - `model`, `instructions: system`, `store: false`, `stream: true`
  - `input`: `[context as {role:"user", content:[{type:"input_text", text:"<course_material>…"}]}, ...history, {role:"user", content:[...images as {type:"input_image", image_url:"data:<mt>;base64,<b64>"}, {type:"input_text", text: prompt}]}]`
  - when there's a schema: `text: { format: { type: "json_schema", name: "output", schema, strict: false } }`

  `response.output_text.delta` → `delta`. `response.completed` → `result` with `json` = `JSON.parse(text)` when there's a schema; usage is `input_tokens`, `output_tokens`, `input_tokens_details.cached_tokens`. `response.failed` / `response.incomplete` / a stream ending without `completed` → error.
- Errors: map the `subscription_sharing_*` codes as in RFC §6.10. A 401 triggers one refresh-and-retry before the stream has started. `*_unavailable` is retried (3×, back-off 2/4/8 s) **only if no delta was emitted yet**; after the first delta it becomes an error, so the client never sees duplicated text.

*Accept:* mock tests for deltas, completed, failed with each code, early stream end, and 401 → refresh → retry.

**G4. ChatGPT connection UI** (ChatGPT card).
- **"Continue with ChatGPT"** button in OpenAI's branding: black, logo from the official brand assets checked into `apps/web/public/brand/`, as their UI/UX guidelines allow. Clicking it calls `start`, then `window.open(authorizeUrl, "_blank")` within the click handler.
- Poll `/api/connections` every 2 s for up to 10 min.
- First-time "You're using your ChatGPT plan" modal (flag in server settings).
- "ChatGPT plan" pill in the status area; Settings link to `https://chatgpt.com/settings/usage`; a Plus note about the shared 5-hour limit.

*Accept:* e2e T1 ChatGPT path against the mock server (the server reads `TUTORAI_OPENAI_AUTH_BASE` / `TUTORAI_OPENAI_API_BASE` env overrides, which are **only** honored when `TUTORAI_TEST=1`).

### M5. Student-facing polish

**U1. Onboarding and Settings.**
- `Onboarding.tsx`: in local mode, step 2 becomes "How do you want to connect the AI?" with cards in RFC §10 order (ChatGPT, Claude, API key, local model, demo), and the folder step is skipped (auto `~/Documents/TutorAI` with a "Change" link).
- On the web (not local), add an "Install TutorAI on my computer" card linking to the install section.
- **Moving from the web version:** Chrome/Edge folder users just pick the same folder in local mode (same format). Safari/Firefox users have data in the Pages origin's IndexedDB, so the web Settings shows "Moving to TutorAI on your computer? Export a backup first" (existing `exportBackup`), and local onboarding offers "Import a backup" (existing `importBackup`).
- `Settings.tsx`: the "Where the model runs" group gains the two plan providers. New "Connection" row (account, plan, models, usage link, switch, sign out). New "TutorAI on this computer" group (version, update status and toggle, data folder with **Change** via `FolderChooser`, Quit, uninstall command).

*Accept:* every string has `t()`; e2e checks Hebrew and English.

**U2. Plan-limit UX** (needs K1).
- `Engine.drain()`: when `ingestSource` throws `LLMError` kind `rate_limit`, the source is already in `waiting` (K1). Set `ingestStatus.message` to "Waiting for your plan to reset at HH:MM" (or "in a little while" without `resetAt`), stop draining, and schedule `drain()` at `resetAt + 60 s` (default 30 min). `Engine.start` also re-queues `waiting` sources. Resumption happens while the app is open in a tab; ingestion runs in the browser, so a closed tab resumes on the next open.
- Tools (`run()`) surface the same reset time in their error message.
- Before ingesting more than 200 pages (sum of the parsed page counts) on a plan provider, show the one-time notice from RFC §5.5.

*Accept:* a unit test with a fake LLM that throws `rate_limit` once.

**U3. Install scripts, launcher, uninstall.**
- `install.sh` (POSIX sh):
  1. Detect OS and arch.
  2. `curl -fsSL` the binary and `SHA256SUMS` from `https://github.com/yairbarak22/TutorAI/releases/latest/download/`.
  3. Verify with `shasum -a 256` / `sha256sum`.
  4. Install to `~/.local/bin/tutorai`, `chmod +x`; on macOS `codesign --force --sign -`.
  5. macOS: write `~/Applications/TutorAI.app/Contents/{Info.plist, MacOS/TutorAI (sh: exec ~/.local/bin/tutorai open), Resources/icon.icns}`. Linux: write the `.desktop` file.
  6. Add `~/.local/bin` to the shell rc if missing.
  7. Run `tutorai open`.
- `install.ps1`: same with `Invoke-WebRequest`, `Get-FileHash`, `%LOCALAPPDATA%\TutorAI\tutorai.exe`, and Start Menu + Desktop `.lnk` via `WScript.Shell`.
- `tutorai uninstall`: stop the server, remove the binary, launcher, and `~/.tutorai`; print the data folder path, which is kept.
- `InstallLocal.tsx`: OS-detected command, copy button, short steps, "How to open Terminal" GIF.

*Accept:* script tests in CI (macOS, Ubuntu, Windows runners) install from a local `file://` release folder, verify a launcher exists, run `tutorai doctor`, and uninstall.

**U4. Self-update** (`update/*`, `routes/update.ts`).
- Check on start and every 24 h when `autoUpdate`: `GET https://api.github.com/repos/yairbarak22/TutorAI/releases/latest`, compare semver, download `tutorai-<os>-<arch>[.exe]` and `SHA256SUMS`, verify, write `<bin>.new`.
- Swap: POSIX `rename(<bin>.new, <bin>)` (safe while running). Windows: `rename(<bin>, <bin>.old)` then `rename(<bin>.new, <bin>)`; delete `.old` on the next start.
- macOS: ad-hoc `codesign` after the swap.
- `staged: true` shows "Restart to update". `restart`: answer `204`, close the listener, spawn the new binary `serve --port <same> --strict-port`, and exit. The page polls `/api/hello` and reloads; the cookie still works (L3).

*Accept:* tests with a local HTTP release fixture: mismatch → no swap; success → swapped and restarted.

### M6. Build and release

**R1. Binary build** (`apps/local/scripts/build.mjs`).
1. `npm run build -w @tutorai/web`.
2. `esbuild src/main.ts --bundle --platform=node --target=node22 --format=cjs --outfile=dist/server.cjs`.
3. Write `sea-config.json`: `{ main: "dist/server.cjs", output: "dist/sea.blob", disableExperimentalSEAWarning: true, useCodeCache: false, assets: { "web/<rel>": "<abs>" for every file in apps/web/dist } }`.
4. `node --experimental-sea-config sea-config.json`.
5. Copy `process.execPath` to `out/tutorai-<os>-<arch>[.exe]`.
6. macOS: `codesign --remove-signature`.
7. `npx postject <bin> NODE_SEA_BLOB dist/sea.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 [--macho-segment-name NODE_SEA]`.
8. macOS: `codesign --sign -`.

*Accept:* the built binary serves the app and passes `tutorai doctor` on all five targets.

**R2. CI** (`.github/workflows/local.yml`).
- On PRs touching `apps/local`, `packages/local-api`, `apps/web` or `install.*`: matrix `macos-14` (arm64), `macos-15-intel` (x64), `ubuntu-latest` (x64), `ubuntu-24.04-arm` (arm64), `windows-latest` (x64). Each runs `npm ci`, `npx playwright install --with-deps chromium webkit firefox`, the unit tests, `build.mjs`, T1 against the built binary (`TUTORAI_BIN=out/tutorai-…`), and the U3 script test.
- On `v*` tags: the same build, then `sha256sum` → `SHA256SUMS`, and a GitHub Release with the five binaries and `SHA256SUMS`.
- Add the install scripts to the Pages deploy (they're already in `apps/web/public`).

*Accept:* a tag on a fork produces a release that `install.sh` installs.

**R3. Docs.**
- `README.md`: install section with both commands.
- `docs/architecture.md`: diagram branch and a "Local server" section.
- `SECURITY.md`: localhost model, token storage, update verification.
- `AGENTS.md`: `apps/local` in "Where to put changes"; "no backend" clarified as "no internet server".
- `CONTRIBUTING.md`: `npm run local:dev`.

*Accept:* a maintainer review.

### Tests across milestones

**T1. E2E** (`e2e-local/local.spec.ts` with its own `playwright.local.config.ts`, so the existing config stays unchanged; root script `"e2e:local"`).
- `webServer` runs `$TUTORAI_BIN serve --port 4399 --strict-port` when `TUTORAI_BIN` is set (CI), otherwise `tsx apps/local/src/main.ts serve …` (local dev), with `TUTORAI_TEST=1`, `HOME=<tmp>`, `PATH=<dir with fake-claude as claude>:$PATH`, and `mock-openai` started by Playwright `globalSetup`.
- **Built in slices:** the demo + restart + cross-origin journeys land with W2/W4; the Claude journey with C5; the ChatGPT journey with G4.
- The test gets a code via `/control/code` using `run.json` from the temp HOME, then navigates to `/open?code=`.
- Journeys:
  - demo
  - Claude card → fake install → fake sign-in → create course → upload `e2e/fixtures/lecture-graphs.pdf` → ingest → quiz
  - ChatGPT card → mock sign-in → tutor streams
  - restart server → data and provider persist
  - a page served from another port can't read `/api/hello` (CORS) or POST (403)
- Projects in `playwright.local.config.ts`: chromium, webkit, firefox.

## 5. Order of work for one developer

| Week | Work |
|---|---|
| 1 | S1 spike → L0–L5 |
| 2 | K1, W1–W4 with the T1 demo slice, R1 (early, so the binary is tested continuously) |
| 3 | G1–G4 (ChatGPT first, since its contract is fully documented) |
| 4 | C1–C5 |
| 5 | U1–U4, T1 complete, R2 |
| 6 | R3, manual release checklist (RFC §12), first tagged release |

With two developers: one takes M3 and the other M4 after week 2, saving about a week.

## 6. Out of scope for v1

- Signing the Windows binary: only if S1 shows Defender flags it (RFC §15).
- Multiple ChatGPT accounts in the picker. The docs allow it; v1 keeps one active account and "Use a different account" re-registers.
- Running on a VM or another machine (SIWC self-hosted VMs). Local only.
- Tools, MCP, or web search through either plan. TutorAI tools stay prompt plus schema, as today.
