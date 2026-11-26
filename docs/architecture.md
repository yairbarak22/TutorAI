# Architecture

TutorAI is a **static web app with no backend**. Everything runs in the student's browser, data is stored on the student's device, and model calls go straight from the browser to the model the student chose. The code is TypeScript only.

## Principles

1. **Local-first.** Materials, outputs, and the learner model stay with the student. The project runs no server that holds data.
2. **Zero installation.** Open a link and work. The site can also be installed as an app (PWA). An optional one-line install, TutorAI Local, adds what a web page can't do: using the student's Claude or ChatGPT plan.
3. **One language.** TypeScript end to end, so contributors need to know one world.
4. **Small core, many plugins.** Most tools are declarative (YAML + prompt), so non-programmers can contribute.
5. **Structured output.** Every tool returns an object defined by a Zod schema. The UI knows how to render it and the tests know how to check it.
6. **Grounded.** Every claim taken from the material cites a real page, slide, or section.
7. **Pedagogy first.** The default is "help me learn", not "give me the answer": Socratic questions, graded hints, retrieval practice, spaced repetition.
8. **Verify what can be verified.** Where a deterministic check exists (schemas, citations, symbolic math), it overrides the model.

## Overview

```
┌──────────────────────────────── The student's browser ───────────────────────────────┐
│                                                                                       │
│  UI: React + Tailwind (Hebrew RTL / English LTR)                                      │
│   Per course: Today's session · Mistakes · Materials · Concepts · Tools · Tutor ·     │
│               Review · Progress · Outputs                                             │
│   Renderers: Markdown+KaTeX · Quiz · Exam · Flashcards · Mermaid · Solution check ·   │
│              Widget (sandboxed iframe + Viz Kit)                                      │
│        │                                                                              │
│  core (pure TypeScript)                                                               │
│   Ingestion ─► Course index ─► Tool runtime (plugins) ─► Outputs ─► Learner model     │
│   (concepts + prerequisite graph)   │                    (BKT · FSRS · mistakes ·     │
│                     │               │                      daily session)             │
│                 retrieve()     LLM gateway (LLMApi)                                   │
│        │                                                                              │
│  platform (apps/web/src/platform):                                                    │
│   sql.js → <chosen folder>/tutorai.db (File System Access) · IndexedDB fallback ·      │
│   pdf.js · Pyodide + SymPy worker · key and model settings                            │
└───────────────┬─────────────────────────────────────────────┬─────────────────────────┘
                │ HTTPS, with the student's own key            │ http://localhost
                ▼                                              ▼
         Anthropic (Claude)                       A local model (Ollama / LM Studio)

   The site itself: static files on GitHub Pages.
```

## Technology

| Layer | Choice | Why |
|---|---|---|
| Tooling | TypeScript, npm workspaces, Vite, Vitest, Playwright | A monorepo with nothing extra to install |
| UI | React 19, Tailwind 4, hash router, PWA | Large ecosystem, good RTL support |
| Database | SQLite via sql.js (WebAssembly) | Real SQL in a single file the student can see and back up |
| Models | `LLMApi` interface with two backends: Claude (`@anthropic-ai/sdk`, from the browser) and local open models (Ollama or any OpenAI-compatible server) | Structured output with Zod, streaming, prompt caching, vision |
| Schemas | Zod | One schema for model output, storage, UI, and evals |
| Parsing | pdf.js for PDFs (sparse pages such as scans go to vision); PPTX and DOCX unpacked as ZIP + XML | No Python and no local ML at runtime |
| Search | Structural index (course → source → section) + BM25 + long context | For a course of a few hundred thousand tokens this beats vector search and is simpler |
| Spaced repetition | ts-fsrs | |
| Mastery | Bayesian Knowledge Tracing per concept | |
| Math verification | Pyodide + SymPy in a Web Worker, loaded on first use | Real symbolic math in the browser |
| Visualization | Mermaid, KaTeX, and HTML/JS widgets in a sandboxed iframe with the bundled Viz Kit (three.js 3D, 2D plots, controls) | |
| Hosting | GitHub Pages | Free, static, instant updates |

## Where the data lives

```
<folder the student picks>/        e.g. ~/Documents/TutorAI
  tutorai.db                        SQLite: courses, concepts, outputs, progress, flashcards
  courses/<id>/sources/…           the original files, as they are
  .tutorai-lock                     marks the folder as open on another device
```

- **Chrome and Edge:** the database and files are regular files in a folder the student picks, accessed through the File System Access API. Clearing browsing data deletes nothing, a backup is a folder copy, and a folder inside Google Drive or OneDrive is backed up and available on other computers (one computer at a time; the lock file warns about concurrent use).
- **Safari and Firefox:** they don't support the API, so data is kept in IndexedDB. The app shows a reminder to back up, and Settings can export and restore a `.tutorai` file (a ZIP of the database and the source files).
- sql.js keeps the database in memory and writes the whole file after each change (debounced, atomic replace).
- The API key and the model settings are stored in the browser's local storage for this site, **never** in `tutorai.db`, so syncing the data folder never uploads the key. A student who prefers not to save the key keeps it only in session storage and pastes it once per tab.

## Models

All model calls go through one interface, `LLMApi` (`packages/sdk/src/tool.ts`): `object` (structured output against a Zod schema), `text`, and `stream`. Each call names a tier: **fast** for bulk work (reading material, concepts, flashcards) and **smart** for explanations, exams, and the tutor.

| Provider | Implementation | Notes |
|---|---|---|
| **Claude** (default) | `AnthropicLLM` (`packages/core/src/llm/anthropic.ts`) | The student's own key. Defaults: `claude-haiku-5-5` (fast), `claude-sonnet-5-5` (smart), changeable in Settings |
| **Local** (free) | `LocalLLM` (`packages/core/src/llm/local.ts`) | Ollama's native API, or any OpenAI-compatible server (LM Studio). The server must allow the site's origin (`OLLAMA_ORIGINS`); Settings shows how, and offers a ready prompt for Claude to do the setup |
| **Hybrid** | `TieredLLM` | Fast tier on the local model, smart tier on Claude |
| **Demo** | `MockLLM` | Replays the recorded golden outputs; no key needed |
| **Claude plan / ChatGPT plan** (TutorAI Local) | `ServerLLM` (`apps/web/src/platform/server-llm.ts`) | Through the local server: the official Claude Code CLI, or Sign in with ChatGPT + the Responses API. Structured output is validated with the tool's Zod schema, with one repair retry |

A backend can report its limits per tier (`limitsFor`: how much material fits, whether it reads images). Small local models get a smaller retrieval budget and smaller ingestion batches, and scanned-page OCR is skipped when the model can't read images.

## TutorAI Local (`apps/local`)

An optional single program (a Node 22 single executable with the built web app embedded) that students install with one line (`install.sh` / `install.ps1`, served from the site). It serves the same web app at `http://127.0.0.1:4317` in the student's own browser, and adds:

```
browser (same app) ──fetch, same origin──► tutorai (127.0.0.1 only)
                                             ├─ /api/llm ─┬─ Claude plan: spawns the official `claude -p` (student's own sign-in)
                                             │            └─ ChatGPT plan: Sign in with ChatGPT → Responses API
                                             ├─ /api/fs   data folder (~/Documents/TutorAI), any browser
                                             ├─ /api/local-proxy  Ollama / LM Studio without CORS setup
                                             └─ self-update from GitHub Releases (SHA-256 verified)
```

- The web app detects the server (`/api/hello`, only when served from `127.0.0.1`) and switches to `ServerFileStore` and, for the plan providers, `ServerLLM` (`apps/web/src/platform/`). The HTTP contract is `packages/local-api`.
- **Plan limits:** a plan's usage limit pauses ingestion (status `waiting`). Ingestion resumes from the last finished analysis batch after the reset, without parsing the file again.
- **Security:** see [SECURITY.md](../SECURITY.md#tutorai-local-appslocal). **Design and decisions:** [rfc-local-server.md](rfc-local-server.md). **Build plan:** [impl-local-server.md](impl-local-server.md).

## Data model

Tables in `packages/core/src/db/schema.ts`:

```
Course ─┬─< Source (pdf | pptx | docx | text; "sample exam" flag)
        │      └─< Section (title, text, anchor: page/slide, summary)
        ├─< Concept (name, English name, definition, prerequisites → Concept)   ← knowledge graph
        ├─< Artifact (tool id, type, JSON, citations, created_at)
        ├─< Chat (tutor conversations)
        └── exam date

Learner ─┬─< Attempt (question, answer, correct, concept, at)
         ├─< Mastery (concept → p_known, BKT)
         ├─< Card (FSRS state, concept)
         ├─< Mistake (question, student answer, correct answer, diagnosed misconception,
         │            concept, streak, status, due)
         └─< Session (daily sessions and their results)

Usage (tokens per call)
```

**`Concept` is the heart of the model.** Every question, flashcard, mistake, and output is tagged with a concept. That is how the system knows where the student is weak and orders work by prerequisites.

## Pipelines

### Ingestion (`packages/core/src/ingest/`)
```
file ─► hash (dedupe) ─► parse:
          pdf  → pdf.js text; sparse pages (scans, formulas) → vision
          pptx → slide XML + speaker notes
          docx → XML → paragraphs split by headings
     ─► Sections with anchors (page / slide / section)
     ─► fast tier: title + summary per Section, concept and prerequisite extraction
     ─► merge into the course concept graph
```
Progress is saved as it goes; a closed tab resumes where it stopped.

### Retrieval: `ctx.retrieve({ mode, query, concept, sourceIds, budgetChars })`
1. Filter by source (or by "sample exam" for `mode: samples`).
2. If the material fits the budget, send all of it.
3. Otherwise, rank Sections with BM25 on the query and concept and take the best ones up to the budget.
4. Sections are always sent in document order, so repeated calls on the same course hit the prompt cache.

### Generation (`packages/core/src/runtime.ts`)
```
request ─► retrieve ─► prompt (declarative template or code tool) ─► llm.object(Zod schema)
        ─► schema validation ─► citation check (invalid section ids removed) ─► Artifact
        ─► side effects: flashcards → FSRS deck, answers → BKT + mistakes notebook
```
If an output fails to render (for example a widget with a JavaScript error), the student can press "Fix", and the tool's optional `repair()` sends the error back to the model.

### Check my solution (`plugins/core/check-solution`)
```
photo or text ─► smart tier: transcribe the student's steps faithfully (mistakes included),
                 mark each step, and write every math claim in SymPy syntax
              ─► whitelist validation ─► SymPy in a worker checks each claim
              ─► SymPy overrides the model on algebra ─► first wrong step + graded hints
```
The student never receives the full solution, only the corrected first wrong step and hints.

## The learner model (`packages/core/src/learner/`)

- **Mastery (BKT)** per concept, updated from every attempt. The guess probability depends on the format (25% for multiple choice, 5% for open questions). A concept counts as "strong" only after at least three attempts.
- **Flashcards (FSRS):** each card is scheduled just before it would be forgotten.
- **Mistakes notebook:** every wrong answer is diagnosed ("the misconception behind it") and returns the next day as a *new* question on the same misconception. Two correct answers on different days resolve it; a wrong answer resets it.
- **Today's session:** one button that mixes, within about 20 minutes, due flashcards, mistake retries, questions on the weakest concepts (only those whose prerequisites are not weak), and one solid concept that hasn't been practiced for the longest time (interleaving).
- **Concept graph:** prerequisite links extracted by the model are cleaned up (cycles broken, redundant links removed) and laid out in stages from foundations to advanced, colored by mastery.
- **Study plan:** exam date + mastery + prerequisites → a daily schedule.

## Plugins

Every tool is one folder under `plugins/<pack>/<tool-id>/`, discovered automatically by `plugins/registry.ts`. Most tools are declarative (`plugin.yaml` + an English `prompt.md`); tools with multi-step logic are TypeScript (`index.ts` exporting `defineTool`). The runtime handles retrieval, the shared system prompt (answer language, citations, pedagogy, academic integrity), structured output, validation, and saving.

The full guide, including the `ctx` API, artifact types, input fields, and retrieval modes, is in **[plugins.md](plugins.md)**.

| Pack | Tools |
|---|---|
| `core` | tutor, check-solution, quiz, flashcards, summary, exam-from-samples, study-plan, explainer, diagram |
| `law` | case-brief |
| `math` | worked-example |

## Quality

- Every plugin ships `evals/eval.yaml` (fixture course, parameters, checks: minimum items, citation coverage, Hebrew ratio, required terms, and an LLM-judge question) and `evals/golden.json` (one good output).
- `npm test` runs every plugin end to end against a fixture course with its recorded golden output, at no cost, on every PR.
- On pushes to `main`, CI also runs the evals against real Claude with the cheap model (`claude-haiku-5-5`, override with `TUTORAI_EVAL_MODEL`) when the `ANTHROPIC_API_KEY` secret is set.
- Playwright E2E covers the student journeys in a real browser.
- **No plugin is merged without passing evals.**

## Safety

- The API key is stored only in this site's browser storage (or only for the current tab, if the student chooses) and sent only to `api.anthropic.com`. Local models are reached only at the address the student configured.
- The production page has a Content-Security-Policy that blocks the app's requests, images, fonts, media, and forms to any address except Anthropic, `localhost`, and the Pyodide runtime. It doesn't restrict scripts, because widgets run inline in a sandboxed `srcdoc` iframe that inherits the policy. See [SECURITY.md](../SECURITY.md).
- Model-written widgets run in `<iframe sandbox="allow-scripts">` without `allow-same-origin`, under a CSP that blocks all network access, with only the bundled Viz Kit.
- All rendered model output (Markdown, Mermaid SVG) goes through DOMPurify.
- Course material and student input are wrapped in tags and treated as data, not instructions.
- SymPy receives only whitelisted expressions, parsed against a dictionary of math names.
- Declarative plugins run no code. Code plugins are reviewed by CODEOWNERS and may not call `fetch`.
- PR builds are never deployed to the production origin, because a malicious build could read keys saved in students' browsers.

## Privacy and academic integrity

- Lecture materials belong to their lecturers. They are never shared between students, and the system can't share them: there is no server.
- No telemetry. The only external services are the model the student chose and jsDelivr (the Pyodide runtime, downloaded the first time SymPy is used; no student data is sent there).
- Tools guide rather than solve: the tutor is Socratic by default, and "Check my solution" never reveals the full solution.

## Repo structure

```
TutorAI/
  apps/web/               React PWA; src/platform = storage, secrets, SymPy worker
  packages/
    sdk/                  @tutorai/sdk: artifact schemas, tool contract, quality checks, i18n
    core/                 store (sql.js), parsers, ingestion, search, retrieval, model clients,
                          learner model, runtime
  plugins/
    registry.ts           auto-discovery
    evals.test.ts         the quality gate for every plugin
    _fixtures/            fixture courses (probability, law) and golden outputs
    core/  law/  math/    the tools
  e2e/                    Playwright student journeys + PDF/PPTX/DOCX fixtures
  docs/
  .github/                CI, deploy, CODEOWNERS, issue and PR templates
```
