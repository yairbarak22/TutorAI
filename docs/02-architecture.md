# 02 — Architecture

> Version 3 (implementation status). **TypeScript only, local-first in the browser.** The reasoning behind the distribution decision: [04-distribution.md](04-distribution.md).
>
> Changes made during implementation compared to the original design: npm workspaces instead of pnpm (no extra install for contributors); `sql.js` instead of SQLite-WASM with Drizzle (the DB lives in memory and is written as a whole `ruecai.db` file on every change); the official Anthropic SDK instead of the Vercel AI SDK; GitHub Pages for production, with no per-PR preview deployments (Cloudflare was dropped; PRs are checked by CI only); a bilingual UI (Hebrew RTL and English LTR).

## Guiding principles

1. **Local-first.** Materials, artifacts, and the learner model are stored with the student. The project has no server that holds data.
2. **Zero installation.** Open a link and work. A desktop app is an add-on, not a requirement.
3. **One language: TypeScript.** The same code runs in the browser and in Electron. A contributor only needs to know one world.
4. **Small core, big plugins.** Most tools should be **declarative** (YAML + prompt + schema), so that non-programmers can contribute too.
5. **Structured output.** Every tool returns an object defined by a Zod schema. The UI knows how to display it, and the tests know how to check it.
6. **Every claim is grounded in a source**, with a citation to a page, slide, or minute in a lecture.
7. **Hebrew-first, bilingual, and pedagogy-first.** RTL, mixed terminology, a UI in Hebrew and English (the student picks the language, and AI-generated content follows it), and a default mode of "help me learn" rather than "give me the answer".

## Overview

```
┌──────────────────────────── The student's browser (or Electron) ─────────────────────────┐
│                                                                                       │
│  UI — React + TS (Hebrew RTL / English LTR)                                           │
│   Courses · Library · Tutor · Studio · Review · Exam Mode                             │
│   Renderers: Markdown+KaTeX │ Quiz │ Flashcards │ Mermaid │ Widget (sandboxed iframe)  │
│              Viz Kit: three.js 3D, 2D plots, controls, KaTeX │ Study plan │ Exam      │
│        │                                                                              │
│  core (pure TS, runs in a Web Worker)                                                 │
│   Ingestion ─► Course Index ─► Tool Runtime (plugins) ─► Artifacts ─► Learner Model    │
│                     │                 │                                               │
│                 Retrieval        LLM Gateway (@anthropic-ai/sdk)                       │
│        │                                                                              │
│  platform-web:  sql.js → ~/Documents/RuecAI/ruecai.db · pdf.js worker · IndexedDB fallback │
└───────────────────────────────────────┬───────────────────────────────────────────────┘
                                        │ Direct HTTPS, with the student's key
                                        ▼
              Anthropic (Claude)   (future: more providers / Ollama / university proxy)

   The site itself: static files on GitHub Pages. No backend.
```

## Technology choices

| Layer | Choice | Rationale |
|---|---|---|
| Language and tooling | **TypeScript, npm workspaces, Vite, Vitest, Playwright** | A monorepo with no extra tools to install |
| UI | **React, Tailwind, shadcn/ui** (with RTL), TanStack Router/Query | The largest ecosystem, good RTL support |
| State and DB | **SQLite** via **sql.js** (WebAssembly). The `ruecai.db` file is saved **in a regular local folder** the student chooses (File System Access API, in Chrome/Edge); in other browsers it is kept in browser storage (IndexedDB). | Real SQL, a file the student can see and back up. The same folder will also work from Electron. Details: [04-distribution.md](04-distribution.md#where-the-data-lives-a-regular-local-folder). |
| Source files | Regular files in the course folder (`courses/<course>/sources/`) | They stay local; nothing is uploaded to a server |
| LLM | **`@anthropic-ai/sdk`** (official) from the browser, behind an `LLMApi` interface. Defaults: fast = `claude-haiku-5-5`, smart = `claude-sonnet-5-5` (changeable in Settings) | Structured output with Zod (`betaZodOutputFormat`), streaming, prompt caching, automatic fallback on refusals. Other providers: implement `LLMApi`. |
| Schemas | **Zod** | The same schema is used for LLM output, the DB, and the UI |
| Document parsing | **pdf.js** for text and layout, and sending the PDF itself to the LLM when there are formulas or images. **PPTX/DOCX**: ZIP+XML files, unpacked in JS (e.g. JSZip). | No Python and no local ML |
| Search | **Structural index** (course → lecture → section → concept), **BM25** (MiniSearch), and **long context with prompt caching** | For a course of up to ~300K tokens this is better and simpler than vector RAG. Embeddings remain an option behind `retrieve()`. |
| Spaced repetition | **ts-fsrs** | |
| Math verification | **Pyodide + SymPy** in a Web Worker (loaded only when needed) | Verifies answers to generated exercises |
| Visualization | **Mermaid**, KaTeX, and HTML/JS widgets in a sandboxed iframe with the bundled **Viz Kit** (three.js 3D scenes, 2D plots, controls, KaTeX formulas) | |
| Transcription | Phase one: a transcription API. In the desktop version: whisper.cpp with ivrit.ai models. | |
| Testing | **Vitest**, **Playwright** (E2E), and dedicated evals | |
| Distribution | GitHub Pages for production, PWA. No per-PR preview deployments (Cloudflare was dropped) | |

## Data model (core)

```
Course ─┬─< Source (pdf | slides | doc | recording | sample_exam | link | note)
        │      └─< Section (title, text_md, anchor: page/slide/timestamp, tokens)
        ├─< Concept (name_he, name_en, definition, prereqs → Concept)        ← knowledge graph
        │      └── ConceptSection (where the concept appears)
        ├─< Artifact (tool_id, type, schema_version, json, citations[], created_at)
        ├─< Exam (date, scope: Concept[], format, sample_sources[])
        └─< StudyPlan (sessions[])

Learner ─┬─< Mastery (concept_id, p_known [BKT], last_seen)
         ├─< Card (FSRS state, artifact_id, concept_id)
         └─< Attempt (item_id, answer, correct, feedback, at)
```

**`Concept` is the heart of the model.** Every question, flashcard, and artifact is tagged with a concept. That's how the system knows where the student is weak and builds a study plan in prerequisite order.

## Processing pipelines

### Ingestion (runs in a Web Worker, with checkpoints)
```
file ─► hash (dedupe) ─► parse:
          pdf  → pdf.js text+layout; "sparse" pages (formulas/images) → LLM vision
          pptx → XML of each slide + notes; slides with images → LLM vision
          docx → XML → markdown
          audio/video → transcription (API) → segments with timestamps
     ─► normalize to Markdown with anchors ─► split into Sections (by slide/heading/passage)
     ─► LLM (fast tier): title + summary per Section, and concept extraction
     ─► merge into the course concept graph ─► BM25 index
```
Every step is saved. If the tab is closed, work resumes from the same point the next time it opens.

### Retrieval: `ctx.retrieve(query, {concepts, sources, budget})`
1. Filter by concepts and sources, and run a BM25 search over Sections.
2. If the relevant material fits in the token budget, return **all relevant Sections in full**.
3. If it's too large, the LLM picks Sections based on their summaries (a cheap selection step).
4. The context is built in a fixed order (course → lecture → section) to take advantage of prompt caching.

### Generation (through the Tool Runtime)
```
request ─► tool.plan ─► retrieve ─► generateObject(schema) ─► Zod validate
        ─► grounding check (every claim ↔ an existing citation) ─► Artifact
```
For long generations, such as a whole lesson, we use the **outline → sections** pattern: the student approves or edits the outline, and then each part is generated.

## The plugin system — the heart of the project

### Two kinds of plugins

**1. Declarative plugin (no code). For most contributors, including law students.**
```
plugins/law/case-brief/
  plugin.yaml        # id, name, description, inputs, output, tier; Hebrew translations under i18n.he
  prompt.md          # English prompt template (Handlebars) with {{course}}, {{concepts}}, {{params}}
  examples/          # few-shot examples
  evals/             # test cases and criteria
  README.md
```
The core already knows how to run a plugin like this: retrieve → prompt → generateObject by output type → render. The base system prompt tells the model which language to answer in, so prompts don't need to. (The loader still accepts the older `prompt.he.md` file name.)

**2. Code plugin (TS). For complex logic.**
```
plugins/math/exercise-generator/
  plugin.yaml
  index.ts           # export default defineTool({ schema, async run(ctx, params) { ... } })
  Renderer.tsx       # optional, a dedicated renderer
  evals/
```

### The SDK (`@ruecai/sdk`) that the core exposes through `ctx`
- `ctx.retrieve(query, opts)` and `ctx.cite(section)`
- `ctx.llm.object(schema, prompt, {tier: "fast" | "smart"})`, `ctx.llm.text(...)`, `ctx.llm.stream(...)`
- `ctx.course`, `ctx.concepts`, `ctx.learner.mastery(conceptId)`
- `ctx.progress(pct, msg)`, `ctx.checkpoint(key, value)`
- `ctx.python(code)` (Pyodide), `ctx.capabilities` (e.g. `transcribe-local` exists only on desktop)

### Built-in artifact types (no UI to write)
`markdown_doc` · `quiz` · `flashcards` · `diagram` · `interactive_widget` · `scene_3d` · `study_plan` · `exam_simulation` · `case_brief` · `worked_solution`

### Safety
- Widgets and 3D scenes written by the LLM run in an `<iframe sandbox="allow-scripts">` (without `allow-same-origin`), with CSP `connect-src 'none'`, and only the bundled Viz Kit libraries (three.js, 2D plots, controls, KaTeX), served locally. No network access.
- If rendering fails, the error is sent to the LLM for a fix, up to 2 attempts.
- Code plugins go through code review by CODEOWNERS. Declarative plugins don't run any code at all.

### Discipline packs

| Pack | Examples |
|---|---|
| **Core** | Summary, Socratic tutor, quiz, flashcards, concept map, exam study plan |
| **Math and probability** | Step-by-step solutions with hints, interactive simulations (dice, distributions, the law of large numbers), an exercise generator verified with SymPy |
| **Computer science** | Algorithm visualization, code tracing, complexity questions |
| **Law** | A new exam from sample exams (issue-spotting), case briefs (FIRAC), rubric-based grading |
| **Economics and management** | Interactive supply-and-demand graphs, case studies |
| **Psychology and social sciences** | Research methods, comparison tables between theories |

## Tutor Agent

A conversational agent whose tools are the plugins (tool calling). For example: "Explain Bayes to me and quiz me" → retrieve → grounded explanation → run `quiz` on the concept.
**Modes:** Socratic (default), direct explanation, quiz, "explain it like I'm 12".

## Learner model
- **Mastery per concept:** BKT, updated from every Attempt.
- **Flashcards:** FSRS.
- **Study plan:** exam date + scope + mastery → a daily schedule that prioritizes weak and foundational concepts.

## LLM Gateway
- **Tiers:** `fast` (extraction, summaries, flashcards) and `smart` (explanations, exams, code). The student maps each tier to a model; the defaults are `claude-haiku-5-5` (fast) and `claude-sonnet-5-5` (smart).
- **Providers:** a personal key, Ollama on localhost, or in the future a university proxy (a Cloudflare Worker with SSO and quotas).
- **Cost tracking** per action, and a cost estimate before expensive actions.
- **Prompt caching** on the course context.

## Quality: Evals
- Every plugin ships with `evals/`: a small input and criteria (a valid schema, correct citations, one correct answer, proper language).
- `npm test` runs the recorded evals (against `golden.json`) locally and on every PR, at no cost. `npm run eval:live` runs them against real Claude; in CI this happens on pushes to `main` with the cheap model `claude-haiku-5-5` (override with `RUECAI_EVAL_MODEL`).
- An LLM-as-judge checks grounding.
- **No plugin gets into the project without passing evals.**

## Repo structure

```
RuecAI_Tutor/
  apps/web/               # React PWA; src/platform = storage (folder / IndexedDB), secrets
  packages/
    sdk/                  # @ruecai/sdk: artifact schemas, ToolManifest, defineTool, quality checks
    core/                 # store (sql.js), parsers, ingest pipeline, search, retrieve, LLM, learner, runtime
  plugins/
    registry.ts           # auto-discovery (import.meta.glob)
    evals.test.ts         # quality gate for every plugin
    _fixtures/            # demo/eval courses (probability, law) + core golden outputs
    core/  law/  math/    # tools
  e2e/                    # Playwright journeys + generated PDF/PPTX/DOCX fixtures
  docs/
  .github/                # CI, deploy, CODEOWNERS, templates
```

## Privacy, copyright, and academic integrity
- Lecture materials belong to the lecturers. **There is no sharing of materials between students**, and the system can't share them anyway, because there is no server.
- No telemetry by default.
- "Graded assignment" mode: the tool guides rather than solves. It's worth coordinating a policy with the university.
- License: **Apache-2.0**. Don't copy code from PageLM (non-open license) or Khoj (AGPL).
