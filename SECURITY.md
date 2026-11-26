# Security

TutorAI has no server: course files, the database (`tutorai.db`) and the API key stay on the student's device, and model calls go directly from the browser to the model the student chose (Anthropic's API, or a local model on the student's own computer).

Design rules that every change must keep:
- The API key is stored only in the browser's local storage for this site, or, if the student unticks "Remember the key", only in session storage until the tab closes. It is never in `tutorai.db`, never in logs, and never sent anywhere except `api.anthropic.com`. A local model is contacted only at the address the student configured.
- The production page carries a Content-Security-Policy (`apps/web/vite.config.ts`, `NETWORK_POLICY`) that blocks the app's data requests (fetch, XHR, beacon, WebSocket), images, fonts, media, and form posts to any address except this site, `api.anthropic.com`, `localhost`, and the Pyodide runtime. It is defense in depth, not a guarantee: it does not restrict scripts (model-written widgets run inline in a sandboxed `srcdoc` iframe, which inherits the policy), and no CSP can stop injected code from navigating the whole page away. `e2e/smoke.spec.ts` checks that outside addresses are blocked.
- Students are advised to use a separate key in an Anthropic workspace with a low monthly spend limit, so a leaked key has a capped cost and can be revoked.
- Model-generated code (interactive widgets) runs only in `<iframe sandbox="allow-scripts">` without `allow-same-origin`, under a CSP that blocks all network access.
- All rendered model output (Markdown, Mermaid SVG) goes through DOMPurify.
- Course material and student input inside prompts are wrapped in tags and treated as data, not instructions.
- Expressions sent to SymPy ("Check my solution") are validated against a whitelist first, then parsed by SymPy against a dictionary that contains only math names. The Pyodide runtime is downloaded from jsDelivr on first use; no student data is sent there.
- No external services besides the chosen model and the Pyodide CDN. Tools may not call `fetch` on their own.
- PR builds are never deployed to the production origin; PRs are checked by CI only.

### TutorAI Local (`apps/local`)

The optional program students install to use their Claude or ChatGPT plan runs a server on the student's own computer only. Design: [docs/rfc-local-server.md](docs/rfc-local-server.md).

- **Reachable only from this computer, and only from TutorAI's own page.** It listens on `127.0.0.1` and requires the exact `Host` (blocks DNS rebinding; `localhost` redirects to `127.0.0.1`). A foreign `Origin` is refused, and so is `Sec-Fetch-Site` other than `same-origin`/`none`. Every `/api` request needs both:
  - an `HttpOnly; SameSite=Strict` session cookie, issued only for a single-use, 60-second code that the launcher opens;
  - the per-install API token in `X-TutorAI`. The token reaches the page only in the `/open` redirect's URL fragment and is kept in this origin's storage. Cookies ignore ports, so another server on `127.0.0.1` could receive our cookie, but without the token it still can't use the API.

  The launcher accepts a one-time code only from a server that proves it knows `run.json`'s secret, and a lock file allows one server per user. Tests: `apps/local/test/server.test.ts`, `e2e-local/local.spec.ts`.
- **Claude plan:** TutorAI runs the official, unmodified `claude` binary. The student signs in with Claude Code's own `claude auth login`. TutorAI never reads, stores or forwards Claude credentials. The CLI gets an allowlisted environment, with no `ANTHROPIC_API_KEY` or other secrets, in an empty temporary folder, with its tools, MCP and settings turned off.
- **ChatGPT plan:** OpenAI's documented open-source flow (PKCE, loopback callback on `127.0.0.1`, dynamic client registration, ID token verified against OpenAI's JWKS with nonce and audience). Tokens are kept in `~/.tutorai/chatgpt/*.json` with owner-only permissions and are never sent to the browser or written to logs. Sign-out revokes the refresh token.
- **Files:** every data-folder path is checked to stay inside the folder (no `..`, absolute paths or symlink escapes). Writes are atomic.
- **Network:** the server itself may contact only OpenAI's auth/API hosts, GitHub (updates) and local model servers on this computer. The local-model proxy forwards only to the configured local address, and strips cookies and authorization headers.
- **Install and updates:** the installers and the self-updater accept a binary only if it matches the release's `SHA256SUMS`. Once a maintainer sets up the release key (`apps/local/scripts/release-key.mjs`, GitHub secret `TUTORAI_RELEASE_SIGNING_KEY`, public key in `apps/local/src/update/signing.ts`), the self-updater also requires a valid Ed25519 signature on `SHA256SUMS`, so a release published with a stolen GitHub token alone can't reach students' computers. Logs redact tokens and never include prompts or course text.

Found a vulnerability? Please **don't** open a public issue. Use GitHub's private "Report a vulnerability" (Security tab) instead.
