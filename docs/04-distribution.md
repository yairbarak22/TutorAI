# 04 — Distribution and installation (ADR-001)

> **Status:** Accepted · **Supersedes:** the original recommendation (Tauri + Python sidecar) in [02-architecture.md](02-architecture.md)
>
> **Update:** production is deployed to GitHub Pages. Per-PR preview deployments (originally planned on Cloudflare Pages) were dropped; PRs are checked by CI only (typecheck, unit tests, recorded plugin evals, Playwright E2E).

## The problem

We need three things at once:

1. **A law student** can start working within a minute, without a terminal, Docker, or Python.
2. **A contributing student** can run the project, make a change, and see the result within 5 minutes.
3. **A team of volunteer students** can maintain the system without wasting half their time on packaging, code signing, and operating-system bugs.

## Why the previous recommendation doesn't work

The previous plan was Tauri + a Python engine packaged as a sidecar. The problem isn't Tauri, it's **the Python engine with heavy ML libraries** (Docling, BGE-M3, faster-whisper):

| Problem | What it means in practice |
|---|---|
| Size | Docling and some of the embeddings pull in PyTorch. The result is a 1–2GB installer. |
| Packaging | PyInstaller with torch needs a separate build for every OS and architecture (Mac Intel/ARM, Windows, Linux). A constant source of bugs. |
| Two languages | React/TS in the UI and Python in the engine, with an API between them. A new contributor has to understand both worlds. |
| Code signing | A macOS app without signing and notarization is blocked by Gatekeeper, and the student has to approve it manually in System Settings. On Windows, a SmartScreen warning appears. Signing costs money (Apple Developer: $99/year) and needs someone responsible for it. |
| Updates | Every bug fix requires a build, a release, and a fresh download. |

## The insight that changes the picture

We **need a strong language model** anyway (Claude, Gemini, or GPT) to get good quality. Local models on a student's laptop aren't yet good enough for summaries, exams, and widget code at the quality we want. And the 2026 API models can already do most of what we planned to do with local ML libraries:

| Task | Planned locally (heavy) | Possible via the LLM, or easily in JS |
|---|---|---|
| Reading PDFs and slides with formulas and images | Docling + PyTorch | The LLM reads PDFs directly (Claude, Gemini). pdf.js for fast text extraction. |
| Searching course materials | BGE-M3 + LanceDB | A typical course (10–30 lectures) is about 100–300K tokens. **Long context + prompt caching + a structural index + BM25** are better and simpler than vector RAG at that scale. |
| Transcribing Hebrew lectures | faster-whisper | A transcription API, or later ivrit.ai models (they have ggml and ONNX versions) |
| Spaced repetition | py-fsrs | **ts-fsrs**, the official library from the same project |
| Math verification (SymPy) | Python | **Pyodide** (Python in WebAssembly) inside a Web Worker |

**Conclusion: the whole system can be written in TypeScript only.** No Python at runtime and no server. Once that's true, a much simpler option opens up.

## Options considered

| | A. Central site (SaaS) | B. Docker | C. `pip`/`uvx` + browser | D. Tauri/Electron + Python | **E. Local-first web app (PWA)** | F. Electron, TS only |
|---|---|---|---|---|---|---|
| Installation for a law student | ✅ Open a link | ❌ | ❌ Terminal | ⚠️ Download + security warnings | ✅ **Open a link, optionally "Install" to an icon** | ⚠️ Download + warnings (if unsigned) |
| Privacy (the material stays with me) | ❌ On our server | ✅ | ✅ | ✅ | ✅ In the browser, not on a server | ✅ |
| Operating cost | ❌ Servers, DB, security, GDPR | ✅ 0 | ✅ 0 | ⚠️ Signing | ✅ **0 (free static hosting)** | ⚠️ Signing |
| Updates | ✅ Instant | ❌ Manual | ⚠️ | ⚠️ Auto-update | ✅ **Instant** | ✅ Auto-update (if signed) |
| Contributor onboarding | Medium | Medium | Good | ❌ Hard | ✅ **Just `npm run dev`** | Good |
| Preview per PR | ✅ | ❌ | ❌ | ❌ | ✅ Possible (considered, but not used — see the update above) | ❌ |
| File access, long background work | ✅ | ✅ | ✅ | ✅ | ⚠️ Limited | ✅ |
| Local models (Ollama, Whisper) | ❌ | ✅ | ✅ | ✅ | ⚠️ Partial (WebGPU, or Ollama on localhost) | ✅ |

## The decision

### Layer 1 (the default): a local-first web app

- **A static site** on GitHub Pages. No server and no central database.
- **All data is stored locally, in SQLite.** In Chrome and Edge the file lives **in a regular folder the student chooses** (see "Where the data lives" below). In other browsers it is kept in browser storage (IndexedDB).
- **LLM calls go directly from the browser to the provider** with the student's key. Anthropic, OpenAI, and Gemini support this. The key never passes through us. The app currently uses Anthropic's Claude, with default models `claude-haiku-5-5` (fast) and `claude-sonnet-5-5` (smart), which the student can change in Settings.
- **Installation**: open the link. Anyone who wants can click "Install app" in Chrome or Edge, or "Add to Dock" in Safari, and get an icon and a window of its own.
- **Language**: the UI is available in Hebrew (RTL) and English (LTR); the student picks the language, and AI-generated content follows it.
- **Updates**: every merge to main is published automatically and reaches everyone on the next load.
- **Contributing**: `git clone && npm i && npm run dev`. Every PR is checked by CI (typecheck, unit tests, recorded plugin evals, Playwright E2E). To try a PR, check it out locally.

### Layer 2 (later, only when there's a real need): a desktop app from the same code

**Electron** wrapping **exactly the same code** and replacing only the "platform layer":

- Storage in a regular folder on disk (`~/RuecAI/`) instead of in the browser
- Local transcription (whisper.cpp with ivrit.ai models), working with Ollama, and plugins that need Python (Manim)
- Long processing in the background, even when the window is closed

**Why Electron and not Tauri?** If everything is TS, Electron lets us write the "native" part in TS too (Node), without Rust. It also runs the same Chromium on every OS, so the code behaves exactly like the web version. Tauri uses WebKit on Mac and WebView2 on Windows, so there are differences between systems. The size (~100MB) doesn't matter to a student. Code signing for this version is a good opportunity to ask the university for funding.

### How the two layers share code

```
packages/core           ← all the logic: courses, pipelines, tools, learner model (pure TS)
packages/platform       ← interface: Storage, FileAccess, Transcriber, JobRunner, SecretStore
  ├─ platform-web       ← folder / IndexedDB + sql.js + Web Workers + WebGPU
  └─ platform-desktop   ← fs + better-sqlite3 + whisper.cpp + Ollama   (later phase)
apps/web                ← React, deployed as a static site
apps/desktop            ← Electron, loads apps/web + platform-desktop   (later phase)
```

Plugins are written only against `core`. They don't know, and don't need to know, which platform they run on.

## Where the data lives: a regular local folder

The DB is **a regular SQLite file in a folder on disk**. The site accesses it through the browser's File System Access API. No local server and no installation.

```
~/Documents/RuecAI/                ← the student chooses the folder once
  ruecai.db                        ← SQLite: courses, concepts, artifacts, progress, flashcards
  courses/
    probability/
      sources/lecture-01.pdf ...   ← the original files, as they are
      exports/summary-week3.md     ← exported artifacts (Markdown/HTML)
```

**How it works technically:**
- SQLite (sql.js, WebAssembly) runs in memory. Every change is written to the `ruecai.db` file in the folder, with a short debounce and an atomic write (first to a temporary file, then a swap). The DB is small, a few MB, because the heavy files are stored separately.
- The original files are stored as regular files, and the student can see them in the folder.
- **The platform layer is the same as Electron's:** `platform-web` writes to the folder through the browser, and `platform-desktop` writes to the same folder through Node. **Same folder, same format.** You can switch between the site and the app without migration.

**Advantages:**
- Clearing browsing data doesn't delete anything.
- Backup = copy a folder.
- **Free sync and backup:** if the folder is inside Google Drive, OneDrive, or Dropbox, the data is backed up and moves between computers (as long as you work on one computer at a time; there's a simple lock file).
- Transparency: the student sees exactly what is stored.

**Limitations:**
- **Supported only in Chrome, Edge, and other Chromium-based browsers.** Safari and Firefox have said they won't implement the API. In those browsers the system works with browser storage, automatic backup to a `.ruecai` file, and a warning. The official recommendation for students will be Chrome or Edge.
- The browser asks for permission to access the folder. Recent versions of Chrome offer a permanent grant; otherwise it's one click on opening.

**An alternative considered and rejected: "a small local DB server"** (a small program that runs SQLite and HTTP on localhost, which the site connects to). This brings back all the installation problems: download, code signing, updates, antivirus, and a busy port. In addition, browsers add permissions and blocks for site-to-localhost access. It has no advantage over direct folder access, and if a local process is needed after all, Electron in Phase 4 does it better.

## The risks of local-first in the browser, and how we handle them

| Risk | Response |
|---|---|
| The student clears browsing data and loses everything | In Chrome/Edge **this doesn't happen**: the data is in a regular folder. In Safari/Firefox: `navigator.storage.persist()` and automatic backup to a `.ruecai` file (ZIP). |
| Safari deletes storage of sites not used for 7 days | The rule applies to a site opened in Safari; an app added to the Dock or home screen gets its own counter. So: recommend Chrome or Edge on Mac, or "Add to Dock". Show a warning in Safari. **The actual behavior of browser storage on current Safari needs testing** (not clearly documented). |
| Long work (transcription, a whole lesson) stops when the tab is closed | Work in saved steps (checkpoints) that resume on the next open. A "don't close" notice. This is also the main reason for Layer 2. |
| The API key is stored in the browser | It's the student's key, and it stays with them. Stored encrypted in IndexedDB, with a warning not to use a shared computer. In Electron: the OS keychain. |
| Code generated by the LLM (widgets) runs in the browser | An iframe with `sandbox` without `allow-same-origin`, and a CSP that blocks the network. Widgets get only the bundled Viz Kit (three.js, 2D plots, controls, KaTeX). The code can't access data or the key. |
| No vector RAG | For a normal-sized course, long context works better. If it turns out to be needed, we add embeddings in the browser (transformers.js) or via an API, behind the same `retrieve()` interface. |
| The university wants to provide a central key | A thin Cloudflare Worker (proxy) with university login and quotas. This is the only server-side addition, and it's optional. |

## What the student actually experiences

1. Goes to `ruecai.app` (for example) → "Install" (optional)
2. Pastes an API key (or signs in with a university account, if there's a proxy)
3. "New course: Probability" → drags in 12 PDF files
4. Within a minute or two gets a topic map, and from there: a summary, a tutor, a quiz, widgets

**Zero installs. Zero manual updates. Zero operating cost for the project.**

## Sources

- [WebKit — Updates to Storage Policy](https://webkit.org/?p=14403) · [MDN — Storage quotas and eviction](https://developer.mozilla.org/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) · [The Register on the 7-day rule](https://www.theregister.com/2020/03/26/apple_relax_were_not_totally/) · [WebKit bug 276998 (OPFS)](https://bugs.webkit.org/show_bug.cgi?id=276998)
- [ivrit.ai models](https://huggingface.co/ivrit-ai/models) · [whisper-v2-d4-ggml](https://huggingface.co/ivrit-ai/whisper-v2-d4-ggml/tree/main) · [whisper.cpp](https://github.com/ggml-org/whisper.cpp) · [Ozen-v1 (transformers.js)](https://huggingface.co/itayinbar/Ozen-v1)
