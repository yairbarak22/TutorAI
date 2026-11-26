# RFC: TutorAI Local — run on your computer and use your Claude or ChatGPT plan

Status: **implemented** (v0.1; the S1 checks that need real accounts are listed in [impl-local-server.md](impl-local-server.md#status)) · Owner: core maintainers · Scope: new `apps/local`, small changes in `apps/web` and docs

## 1. Summary

Add an optional **local server**: one small program the student installs with a single copy-paste command. It serves the same web app at `http://127.0.0.1:4317` in the student's usual browser, and it does what a web page can't: run local processes and keep secrets out of the browser. That lets a student use the AI plan they already pay for instead of an API key:

| Connection | How | Who it's for |
|---|---|---|
| **Claude plan** (Pro / Max) | The local server runs the official, unmodified **Claude Code** CLI. The student signs in through Claude Code's own sign-in, and TutorAI never sees the credentials. | Students with a Claude subscription |
| **ChatGPT plan** (Plus / Pro) | OpenAI's official **Sign in with ChatGPT → ChatGPT plan usage for open-source apps** flow, then the public Responses API. | Students with a ChatGPT subscription |
| API key, local model (Ollama / LM Studio), demo | Unchanged from the web app | Everyone else |

The web app at the GitHub Pages URL keeps working exactly as today. The local version is the same UI with more connection options, folder storage in every browser, and self-update.

**Still true after this change:** no TutorAI server on the internet, no telemetry, data in the student's folder, TypeScript only. The only server is the one on the student's own computer, and only that computer can reach it.

## 2. Why a local process is required

- **Claude plan.** Anthropic forbids third-party apps from running their own claude.ai OAuth or holding Claude.ai tokens (§9). The allowed path is the student's own sign-in to the unmodified Claude Code binary, and only a local process can run it.
- **ChatGPT plan.** OpenAI's open-source flow requires a loopback callback on `http://127.0.0.1:<port>/auth/callback`, and its tokens must stay *out of browser storage*.

## 3. Why a local server and not a desktop app (Electron)

| | Local server (chosen) | Electron app |
|---|---|---|
| Install | One command pasted into Terminal or PowerShell | Download an installer |
| macOS Gatekeeper / Windows SmartScreen | **No warnings.** Files downloaded by `curl` / `Invoke-WebRequest` aren't quarantined, the same way Claude Code itself installs | Blocked unless signed and notarized (Apple Developer Program, $99/yr, plus Windows signing) |
| Browser | The student's own browser, any of them | Bundled Chromium |
| Folder storage | Every browser, because the server writes the files | Chromium only |
| Size | About 90 MB single binary (Node runtime + app) | About 100 MB+ |
| Extra work | Localhost security (§4.2), a launcher icon, self-update | Signing pipeline, app shell |

The one-line terminal install is also what students who want the Claude plan already do for Claude Code, so the two steps feel the same.

## 4. Architecture

```
┌──────────── The student's browser (any) ─────────────┐
│  http://127.0.0.1:4317  — the existing apps/web build │
│   engine.ts ─► LLMApi ─┬─ AnthropicLLM / LocalLLM / MockLLM  (unchanged)
│                        └─ ServerLLM ──────────┐       │
│   storage.ts ─► DataRoot ─ ServerFileStore ───┤       │
└───────────────────────────────────────────────┼──────┘
                         fetch, same origin,     │ session cookie + checks (§4.2)
                         streamed responses      ▼
┌──────────── tutorai (single binary, on the student's computer) ──────────┐
│  http/      static app · /api/* · /auth/callback · security middleware   │
│  providers/                                                              │
│    claude-code/  find · version · install · sign-in status · `claude -p` │
│    chatgpt/      SIWC sign-in · token file · refresh · Responses API     │
│    local/        proxy to Ollama / LM Studio (no OLLAMA_ORIGINS needed)  │
│  fs/        data folder (default ~/Documents/TutorAI), atomic writes     │
│  config/    ~/.tutorai/ (settings, host id, tokens 0600, logs)           │
│  update/    checks GitHub Releases, verifies checksum, swaps binary      │
└──────┬──────────────────────────────┬───────────────────────────────────┘
       │ spawn                         │ HTTPS
       ▼                               ▼
 `claude` (official binary,      auth.openai.com + api.openai.com/v1/responses
 student's own sign-in)
```

### 4.1 The binary

- **Source:** `apps/local/` in TypeScript. Its dependencies are minimal: `openai` (Responses streaming), `jose` (ID-token validation), and `zod`. There are **no native modules**, so it compiles to one file.
- **Build:** a Node 22 **Single Executable Application** (SEA). esbuild bundles the server into one CommonJS file, and the built `apps/web/dist` is embedded as SEA assets, so one file holds everything. It's built natively per target in CI: `darwin-arm64`, `darwin-x64`, `windows-x64`, `linux-x64`, `linux-arm64`. We chose Node SEA over Bun so the runtime is the same Node our tests run on.
- **Apple Silicon** requires every binary to carry at least an ad-hoc signature. The install script runs `codesign --force --sign - tutorai`. That needs no Apple account, and `/usr/bin/codesign` ships with macOS.

### 4.2 Localhost security

Any website the student visits can try to call `127.0.0.1:4317`, and a DNS-rebinding page can even look same-origin. The server therefore:

1. **Listens on `127.0.0.1` only**, never `0.0.0.0`.
2. **Checks `Host`.** It must be exactly `127.0.0.1:<port>` or `localhost:<port>`; anything else gets `421`. This blocks DNS rebinding.
3. **Checks the request origin** on every `/api/*` request. A present `Origin` must be our own, otherwise `403`. Browsers omit `Origin` on same-origin GET/HEAD, so then `Sec-Fetch-Site` must be `same-origin` or `none`. `same-site` is not enough: cookies ignore ports, so a page on another `127.0.0.1` port is "same-site". No GET changes state, and responses send `nosniff` and `Cross-Origin-Resource-Policy: same-origin`. `localhost:<port>` redirects to `127.0.0.1:<port>`, so there is one origin.
4. **Requires a session cookie:** `HttpOnly; SameSite=Strict; Path=/`, HMAC-signed with a key in `~/.tutorai/session.key` and valid for 30 days, so restarts (updates, idle exit) don't lock out an open tab. It is issued only by `GET /open?code=<one-time code>`, where the code is random, single-use, valid for 60 s, and passed by the launcher in the URL it opens. That request redirects to `/` immediately, so the code never stays in history as a working credential.
5. **Requires a custom header** `X-TutorAI: 1` on every mutating request. Browsers won't send it cross-origin without a CORS preflight, and we answer no preflights.
6. **Allowlists outbound requests** (a `fetch` wrapper): `auth.openai.com`, `api.openai.com`, `api.github.com` / `github.com` / `objects.githubusercontent.com` (updates), and `127.0.0.1` / `localhost` (local models). The `claude` child process does its own networking.
7. **Sends a CSP** on the HTML: `connect-src 'self' https://api.anthropic.com http://localhost:* http://127.0.0.1:*` plus the Pyodide CDN, the same as production otherwise.
8. **Confines file access.** `/api/fs/*` paths are resolved and must stay inside the data folder. `..`, absolute paths and symlinks out of the folder are rejected.

### 4.3 Server lifecycle

- **Launch.** The launcher icon (or the `tutorai` command) reads `~/.tutorai/run.json` (`pid`, `port`). If a server is alive, the launcher asks it for a fresh one-time code over a local-only control endpoint protected by a secret in `run.json` (mode 0600). It then opens the browser at `/open?code=…`. Otherwise it starts the server detached and does the same.
- **Fixed port 4317.** Browser storage is per origin, *including the port*, so a changing port would lose the UI's local settings. If 4317 is busy the server tries 4318–4327 and warns. All settings that matter are also stored server-side in `~/.tutorai/settings.json`, so nothing is lost either way.
- **Shutdown.** The page sends a heartbeat every 30 s, visible or not. The server exits after 15 min without any API request and with no running jobs, so closing the browser is enough. The sidebar's "TutorAI on this computer" (shown automatically the first time) explains how to reopen it and has "Quit TutorAI now".
- **Logs.** `~/.tutorai/logs/tutorai.log`, rotated at 5 MB. Tokens, prompts and course text are never logged.

### 4.4 Web app integration

- At startup the web app calls `GET /api/hello`. If it answers, `localServer = { version, platform, features }` and the local options turn on. There is no separate build of the UI.
- **`ServerLLM`** (`apps/web/src/platform/server-llm.ts`) implements `LLMApi`:
  - **`object(schema, opts)`:** sends `z.toJSONSchema(schema)` (zod 4) with `{provider, tier, system, context, prompt, images, history, maxTokens, tag}` to `POST /api/llm`. It reads the streamed reply (newline-delimited JSON: `delta` / `result` / `error` events) and validates with `schema.safeParse`. On failure it makes **one repair retry** with the validation errors, then throws `LLMError("invalid_output")`. It reports length through `opts.onOutput`, so `LongTask` progress keeps working.
  - **`text` / `stream`:** pass deltas through to `onDelta`. If the request closes (tab closed or reloaded), the server kills the child process. `LLMApi` has no cancel today, so none is added.
  - **`limitsFor`:** `undefined`, since both plans are large-context and vision-capable.
  - Errors map to the existing `LLMError` kinds with bilingual `t()` messages.
  - Usage events are passed through. The Usage view labels them "included in your plan" with no cost.
- `engine.ts`: `Provider = "claude" | "local" | "hybrid" | "claude-code" | "chatgpt"`. Hybrid still works (local fast tier + plan smart tier via `TieredLLM`).

## 5. Claude plan via Claude Code (`apps/local/src/providers/claude-code/`)

### 5.1 Find
1. Probe known install folders: `~/.local/bin/claude` (native installer), `~/.claude/local/claude`, `/opt/homebrew/bin/claude`, `/usr/local/bin/claude`, the npm global prefix; on Windows `%USERPROFILE%\.local\bin\claude.exe` and `%APPDATA%\npm\claude.cmd`.
2. Then `PATH`.
3. Then the login shell (`$SHELL -lic 'command -v claude'`, 5 s timeout). A server started from a launcher icon may have a minimal `PATH`.
4. Run `claude --version` and require at least `MIN_CLAUDE_CODE_VERSION` (2.1.280, what Rakazo needs for the same flags, until the spike sets a final value). On Windows only the native `claude.exe` is supported, because `cmd.exe` can't pass a multi-line system prompt.

### 5.2 Install (when missing)
The connection card shows **"Install Claude Code"**: the exact official command, a consent checkbox, then a run with live output streamed to the page.
- macOS/Linux: `curl -fsSL https://claude.ai/install.sh | bash`
- Windows: `powershell -NoProfile -Command "irm https://claude.ai/install.ps1 | iex"`

It also shows "Install it yourself" with a link to the official docs. After install, run Find again.

Windows notes:
- Claude Code on Windows needs **Git for Windows**. Detect it first and link the official installer if it's missing; the spike confirms the current requirement.
- An npm-installed `claude.cmd` has to be spawned through `cmd.exe`, with every argument quoted. Prefer the native `claude.exe` when both exist.

### 5.3 Sign in
- **"Sign in with your Claude account"** runs `claude auth login`. The CLI opens Anthropic's own sign-in page. TutorAI does not take part in the OAuth flow.
- Poll `claude auth status --json` every 2 s for up to 5 min, and show the plan (Pro / Max) when the CLI reports it.
- **Spike item:** if `auth login` needs a TTY, show "Run this in Terminal: `claude auth login`" with a copy button. The student used Terminal to install TutorAI, so this is familiar. We keep polling.
- **Never** read `~/.claude/.credentials.json`, the Keychain item, or `CLAUDE_CODE_OAUTH_TOKEN`. "Sign out" runs `claude auth logout`.

### 5.4 Run a call
Per call, in a fresh empty `mkdtemp` folder used as `cwd` (the prompt goes in arguments and stdin):

```
claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages
       --model <fast|smart model> --system-prompt <system text>
       --tools "" --strict-mcp-config --setting-sources "" --permission-mode dontAsk
       --disable-slash-commands --no-session-persistence --effort low|medium
       [--json-schema <inline JSON schema>]          # structured output (documented in CLI 2.1.332)
```

- **stdin:** one `user` message with content blocks: course context as a text block marked as data, prior `history` turns, images as base64 `image` blocks, then the prompt.
- **Environment:** allowlist only (`PATH, HOME, USER, LANG, LC_*, TMPDIR, SystemRoot, …`) plus `DISABLE_AUTOUPDATER=1`, `DISABLE_AUTO_COMPACT=1`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` (as in Rakazo). Explicitly **no** `ANTHROPIC_API_KEY` or `ANTHROPIC_BASE_URL`, so usage always goes to the student's plan.
- **Output:** parse `stream_event` text deltas for streaming and the final `result` event for text, `usage`, `is_error`, and `subtype`.
- Only documented flags are used (verified against `claude --help`, CLI 2.1.332). If the spike shows `--json-schema` misbehaves with `--tools ""`: append "Reply with a single JSON object matching this schema: …" and rely on `ServerLLM`'s validation and repair retry.
- **Models:** fast = `claude-haiku-5-5`, smart = `claude-sonnet-5-5` (the API defaults), changeable in Settings.
- **Concurrency:** a global semaphore of 2 processes. Ingestion is already sequential (one batch at a time), so only an ingestion and a tutor chat can overlap.
- **Kill rules:** abort or client disconnect means SIGTERM, then SIGKILL after 3 s. Also kill on a 10 min timeout or server shutdown. The temp folder is always removed.
- **Error mapping:** `ENOENT` → "not installed"; not logged in → `auth` ("Sign in again"); usage-limit text or a `rate_limit` subtype → `rate_limit` with the reset time, and jobs pause (ingestion already resumes); anything else → `other`, with the last 2 KB of stderr kept in memory only.

### 5.5 Plan limits
Ingesting a large course uses many fast-tier calls, and on Pro this can hit the 5-hour limit.
- Before ingesting more than about 200 pages, show "This uses your Claude plan. A large course may reach your plan's limit; it resumes automatically after the reset."
- After a rate-limit error, the source goes to a new `waiting` status and shows "waiting for your plan to reset at HH:MM". It resumes from the last finished batch after the reset, while the app is open; ingestion runs in the browser, so a closed tab resumes on the next open. This needs a small `packages/core` change (task K1).

## 6. ChatGPT plan via Sign in with ChatGPT (`apps/local/src/providers/chatgpt/`)

This follows OpenAI's documented open-source flow (`developers.openai.com/siwc/token-sharing-open-source`). No client secret or partner registration is needed.

1. **Host ID:** generate `urn:uuid:<v4>` once per install and store it in `~/.tutorai/host-id`. It is not a credential.
2. **Sign in:** the same server handles the callback, at `http://127.0.0.1:<port>/auth/callback`. Generate fresh `state`, `nonce`, and a PKCE S256 verifier. Open `https://auth.openai.com/api/accounts/authorize` in a **new tab** with:
   - `client_id=dynamic_agent_client` on first registration (the saved issued `oaiapp_…` ID later)
   - `agent_name_hint=TutorAI` (first registration only)
   - `ext_agent_host_id`
   - `scope=openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`
   - `resource=https://api.openai.com/v1`
   - `id_token_hint` / `login_hint` on reauthorization
3. **Callback:** validate `state` and handle `error=access_denied`. Keep the issued `client_id`. Exchange the code at `https://auth.openai.com/api/accounts/oauth/token` (form-encoded, same `redirect_uri` and `resource`). The callback page says "Connected — you can close this tab", and the app tab updates through its status poll.
4. **Validate:** check the ID token with `jose` against OpenAI's JWKS (`iss`, `aud` = issued client ID, `exp`, `nonce`). Require `chatgpt.tokens.use.direct` in the granted scopes, otherwise show "ChatGPT plan use wasn't enabled".
5. **Store:** OpenAI's documented credential record (email, sub, client_id, host id, id/access/refresh tokens, scopes, expiry) as `~/.tutorai/chatgpt/<client_id>.json`, written atomically with mode **0600** (Windows: an ACL for the current user only). This is the storage OpenAI's docs prescribe for local open-source tools. Tokens never reach the browser.
6. **Refresh:** refresh near expiry (`grant_type=refresh_token`, issued `client_id`, `resource`), serialized behind one lock. Save the rotated refresh token atomically.
7. **Sign out:** revoke the refresh token at `revocation_endpoint` from `/.well-known/openid-configuration`, then clear tokens. Keep the client ID and host ID.
8. **Models:** `GET https://api.openai.com/v1/models` → items with `visibility: "list"`. Default fast = the smallest listed model, smart = the first listed. Changeable in Settings.
9. **Inference:** `POST /v1/responses` with `store: false`, `stream: true`, `instructions` = system, and `input` = context as a user text item, history, then the user message (images as `input_image`). For `object()` add `text.format = { type: "json_schema", name, schema, strict: false }`. **Omit** `max_output_tokens`, `temperature`, `previous_response_id`, `metadata`, `user`. Success only on `response.completed`.
10. **Errors** (from OpenAI's error table):
    - `subscription_sharing_usage_limit_exceeded` → `rate_limit`, with a link to chatgpt.com/settings/usage
    - `subscription_sharing_user_not_eligible` → "Your plan doesn't include this (Plus or Pro needed)"
    - `*_unavailable` → retry with backoff
    - `subscription_sharing_unsupported_capability` → log `error.param` and fail clearly
11. **UX required by OpenAI's guidelines:**
    - The button reads **"Continue with ChatGPT"**.
    - A one-time "You're using your ChatGPT plan" modal after first sign-in.
    - A "ChatGPT plan" indicator while it's the active connection.
    - A link to ChatGPT Settings → Usage.
    - Plus users share a 5-hour limit across all apps; tell them.

**Model quality:** the plugin prompts and goldens were tuned on Claude. Before ChatGPT is marked "supported" (not "beta"), run `npm run eval:live` against GPT too (add `TUTORAI_EVAL_PROVIDER=openai`). Fix any schema incompatibilities, and watch the Hebrew ratio and citation checks.

## 7. Storage

- Add `ServerFileStore implements FileStore` in `apps/web/src/platform/storage.ts`. It calls `HEAD/GET/PUT/DELETE /api/fs/file?path=<rel>` (see the contract in impl-local-server.md §3.1). The server writes atomically (write to `*.tmp`, then rename).
- The default folder is `~/Documents/TutorAI`, created on first run. There is no picker and no permission re-prompt, and it works in Safari and Firefox too, which today fall back to IndexedDB. "Change folder" in Settings uses a server-side folder browser, because a web page can't hand a real path to the server.
- The folder format is identical to the web app's (`tutorai.db`, `courses/…`, `.tutorai-lock`). Chrome/Edge users of the web version can open the same folder in the local version, and Drive/OneDrive backup works the same. Safari/Firefox users of the web version keep data in that site's browser storage, so they move with the existing backup export → import.
- `restoreStorage()` tries the server first when `localServer` is set.

## 8. Install, launch, update, uninstall

### 8.1 Install (the student's only technical step)
The website shows the command for the detected OS with a **Copy** button and a 20-second video or GIF of opening Terminal (Mac: ⌘+Space → "Terminal") or PowerShell (Windows: Start → "PowerShell"):

```bash
curl -fsSL https://<site>/install.sh | bash
```
```powershell
irm https://<site>/install.ps1 | iex
```

The scripts, served from GitHub Pages next to the app:
1. Detect OS and CPU, and download `tutorai-<os>-<arch>` plus `SHA256SUMS` from the latest GitHub Release.
2. **Verify the checksum** and abort on mismatch.
3. Install to `~/.local/bin/tutorai` (Windows: `%LOCALAPPDATA%\TutorAI\tutorai.exe`), and run `codesign --sign -` on macOS.
4. Add a **launcher**:
   - macOS: `/Applications/TutorAI.app` (or `~/Applications` when `/Applications` isn't writable), a minimal bundle whose executable is a shell script that runs `tutorai open`. It's created locally, so it isn't quarantined. Icon from the release.
   - Windows: a Start Menu and Desktop shortcut (`.lnk` via `WScript.Shell`).
   - Linux: `~/.local/share/applications/tutorai.desktop`.
5. Start TutorAI and open the browser. Done.

### 8.2 Launch
Click the TutorAI icon (or run `tutorai`). See §4.3 for what happens.

### 8.3 Update
- At startup, and at most once a day, the server checks `api.github.com/repos/<repo>/releases/latest`.
- If there's a newer version, it downloads the binary, verifies `SHA256SUMS`, and swaps it in atomically (Windows: rename the running exe to `.old`, then delete it next start).
- The page shows "Updated to vX — restart TutorAI to finish" with a **Restart** button. Settings → "Check for updates automatically" turns the check off (on by default).

### 8.4 Uninstall
`tutorai uninstall` removes the binary, the launcher, and `~/.tutorai`. It **never deletes the data folder**, and it says where that folder is. Settings shows the same command.

## 9. Terms of use: what keeps this compliant

**Anthropic** (code.claude.com/docs/en/legal-and-compliance, "Authentication and credential use" and "Can customers offer Claude Code in their products?"):
- ✅ The Claude Code binary is unmodified and installed with Anthropic's own installer. None of its sign-in methods are disabled.
- ✅ Each student signs in with their own plan through Claude Code's own flow, and the usage is billed to them. TutorAI never collects, stores, or forwards Claude.ai credentials or tokens, and never pays for or resells usage.
- ✅ We don't use the Agent SDK with claude.ai login, which its docs forbid for third-party products.
- ✅ Naming: plain text "uses Claude Code" only. No Claude or Anthropic logo in our UI.
- **Decision (maintainers): on by default, like Rakazo.** Each student signs in with their own plan, and their use of Claude Code is their own responsibility under Anthropic's terms. Before connecting, the card states this in plain words (§10) and links Anthropic's legal and compliance page, the same disclosure Rakazo gives. Anthropic's text does not spell out this exact case (a free, open-source, single-user tool running the CLI on the student's own machine), and it says Pro/Max limits assume "ordinary, individual usage", so asking Anthropic for confirmation is still worthwhile but does not block release.

**OpenAI** (developers.openai.com/siwc):
- ✅ "ChatGPT plan usage is available to all open-source partners" for open-source, locally hosted apps. Paid or remotely hosted apps need OpenAI's interest form; TutorAI is neither.
- ✅ We follow their contract: loopback redirect, dynamic client registration, `store:false` + `stream:true`, tokens in a 0600 local file out of browser storage, revocation on sign-out, and their UX guidelines.

## 10. Student experience (the target)

1. The website's top button reads **"Install TutorAI on my computer"**, which opens the install section. The web version stays one click away: "Use in the browser".
2. The student copies one line into Terminal or PowerShell. About 20 seconds later TutorAI opens in their browser, and an icon is added to Applications or the Start Menu.
3. First run: "How do you want to connect the AI?" Cards appear in this order:
   - **I have ChatGPT Plus/Pro** → "Continue with ChatGPT" → sign in in a new tab → back in the app, connected. *(about 30 s)*
   - **I have Claude Pro/Max** → a notice ("Uses your Claude plan and its limits. Your use of Claude Code is subject to Anthropic's terms." with a link), then a 3-step checklist: ✅/⬜ Claude Code installed [Install], ✅/⬜ Signed in [Sign in], ✅ Ready. *(about 2 min)*
   - **I have an API key** → the existing flow.
   - **Free, on my computer** → the existing Ollama setup without the CORS step.
   - **Just try it** → demo.
4. The data folder is created automatically in Documents/TutorAI, with "Change" available.
5. Settings → **Connection** shows the active connection, account and plan, models, a usage link, "Switch", and "Sign out". Settings → **TutorAI on this computer** shows the version, update status, data folder, "Quit", and the uninstall command.
6. When a plan limit is reached, the app explains in plain Hebrew or English, shows when it resets, offers "Switch connection", and resumes waiting work after the reset.
7. Next day: click the TutorAI icon, and the app opens where they left off.

## 11. What we learned from Rakazo (and what we do differently)

- **Copied:** the `claude -p` invocation and flags, the empty temp `cwd`, the allowlisted environment without `ANTHROPIC_API_KEY`, and probing known install folders because GUI-launched processes get a minimal `PATH` (`packages/adapters/src/providers/cli-model/claude-code/`, `apps/desktop/src/main/this-computer/`).
- **Not copied:**
  - Their in-app "Sign in with Claude" and "Sign in with ChatGPT" reuse the Claude Code and Codex CLI OAuth client IDs (`pi-anthropic-oauth.ts`, `pi-chatgpt-device-code.ts`), and the ChatGPT path calls ChatGPT's internal `backend-api`. We use Claude Code's own sign-in and OpenAI's official open-source flow instead.
  - Their Electron desktop app, which runs their full server stack. We need neither a full stack nor Electron, so we skip it to avoid code-signing costs.

## 12. Testing

- **Unit (vitest)**, in `apps/local`:
  - **Security middleware:** wrong `Host` → 421; foreign or missing `Origin` → 403; missing cookie → 401; missing `X-TutorAI` on POST → 403; one-time code reuse or expiry rejected; fs path traversal and symlink escape rejected.
  - **`claude-code` provider** against a fake `claude` script (as in Rakazo's `fake-cli.test-support.mjs`) emitting stream-json fixtures: success, deltas, `is_error`, usage-limit text, not-logged-in, crash, hang (timeout), abort and client disconnect. Asserts that the env never contains `ANTHROPIC_API_KEY` and the temp folder is removed.
  - **`chatgpt` provider** against mocked `auth.openai.com` / `api.openai.com`: registration callback, `access_denied`, state and nonce mismatch, missing scope, refresh rotation and race (one request for two concurrent refreshes), revocation, each `subscription_sharing_*` error, and token file mode 0600.
  - **Updater:** checksum mismatch → no swap.
- **Unit**, in `apps/web`: `ServerLLM` (validation, repair retry, abort, error mapping) and `ServerFileStore`.
- **E2E (Playwright):** start the compiled binary with a fake `claude` on `PATH` and a mock OpenAI server, then demo → Claude connection → create course → ingest fixture PDF → quiz; ChatGPT connection → tutor stream; restart keeps the folder and connection; a page on another origin can't call `/api/*`. Run in Chromium, WebKit and Firefox.
- **CI:** build all five binaries on every PR, and run E2E on macOS, Windows and Linux.
- **Manual release checklist:** fresh macOS and Windows machines with no Node and no Claude Code. Run the install command → icon appears → install Claude Code from the app → sign in → ingest a real course. Same for ChatGPT Plus. Check update from the previous version, and check uninstall.

## 13. Changes by file

| Where | Change |
|---|---|
| `apps/local/` (new) | `src/{main,http,security,lifecycle,update,config}.ts`, `providers/{claude-code,chatgpt,local}/`, `fs/`, tests, `scripts/build.mjs` (Node SEA + embedded `apps/web/dist`) |
| `apps/web/public/install.sh`, `install.ps1` (new) | Install scripts served from the site |
| `apps/web/src/platform/{local-server,server-llm,sw-denylist}.ts` (new) | `/api/hello` detection, typed API client, `ServerLLM`, service-worker denylist |
| `apps/web/src/platform/storage.ts` | `ServerFileStore`; server-first `restoreStorage()` |
| `apps/web/src/engine.ts` | `claude-code` / `chatgpt` providers; local-model proxy `fetchFn` when served locally |
| `apps/web/src/platform/secrets.ts` | Extend `Provider` |
| `apps/web/src/views/{Onboarding,Settings}.tsx`, `ui/ConnectionCards.tsx`, `ui/InstallLocal.tsx`, `ui/FolderChooser.tsx` (new) | Connection chooser, checklists, status, usage link, first-use ChatGPT modal, install section |
| `packages/local-api/` (new) | The shared HTTP contract (zod schemas) for server and web |
| `packages/core/src/{llm/anthropic.ts,ingest/pipeline.ts,db/store.ts}` | `LLMError.resetAt`, `waiting` status, batch resume (K1) |
| `plugins/evals.test.ts` | `TUTORAI_EVAL_PROVIDER` for live GPT evals |
| `.github/workflows/local.yml` (new) | Build matrix, E2E, release with binaries + `SHA256SUMS` on `v*` tag |
| `docs/architecture.md`, `SECURITY.md`, `README.md`, `AGENTS.md` | New diagram branch; localhost security and token-storage rules (security-sensitive files: core-maintainer review); install section; `apps/local` in "where to put changes" |

`packages/core` changes only for resumable ingestion on plan limits (`LLMError.resetAt`, a `waiting` status, batch resume; task K1). `packages/sdk` doesn't change. The full task list is in [impl-local-server.md](impl-local-server.md).

## 14. Phases

| Phase | Goal | Done when |
|---|---|---|
| **0. Spike** (2–3 days) | Remove the unknowns | Confirmed: `claude auth login` without a TTY; `--json-schema` with `--tools ""` and where its output lands, and the minimum CLI version; per-call startup time and the throughput of a 100-page ingestion on Pro; SIWC sign-in and a Responses call with a Plus account from Israel; `z.toJSONSchema` accepted by both; the Node SEA binary runs on all five targets; install script → no Gatekeeper/SmartScreen prompt on clean macOS and Windows; Windows Defender doesn't flag the binary |
| **1. Server** | The UI served locally | Binary with embedded app, security middleware, `ServerFileStore`, lifecycle, launcher, install scripts; demo works; security tests green |
| **2. ChatGPT** | First plan path (lowest policy risk) | Sign in, refresh, sign out, quiz and tutor stream work; tests green; live evals run on GPT |
| **3. Claude Code** | Second path | Find, install, sign in, call, limits UX; fake-CLI tests green |
| **4. Polish** | Student-ready | Onboarding chooser, local-model proxy, self-update, uninstall, install video, docs |
| **5. Release** | Public | Release workflow, manual checklist passed |

## 15. Risks

| Risk | Mitigation |
|---|---|
| Students hesitate to use Terminal | A copy button, a short video, and one command only; afterwards everything is a click. The web version stays available. |
| Antivirus flags an unsigned exe (Windows) | Checked in the spike. If needed, free open-source signing (for example SignPath Foundation) or Azure Trusted Signing (about $10/month). Signing is optional here, not a blocker. |
| `curl \| bash` trust | The script is short and in the repo, the binary is verified against `SHA256SUMS`, and everything comes from our GitHub Release. |
| Another program uses port 4317 | Fall back to 4318–4327, with settings kept server-side. |
| Hidden or changed CLI flags | Only documented flags; a minimum CLI version check; fake-CLI tests pin the event format we parse. |
| Anthropic changes or enforces its terms | §9: clear notice to the student; the Claude card can be hidden in one release if needed; other connections are unaffected. |

## 16. Decisions needed from the maintainers

1. **Optional: Anthropic confirmation** for the Claude-plan option (recommended, not blocking).
2. **Where the install scripts live:** the GitHub Pages site (default) or a university domain.
3. Whether the local version should become the **recommended** way to use TutorAI, with the web version as the no-install alternative.
