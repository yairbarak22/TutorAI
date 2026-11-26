# 02 — Architecture

> Version 4 (November 2026), describing what is implemented. **TypeScript only, local-first in the browser, no backend.** The reasoning behind the distribution decision is in [04-distribution.md](04-distribution.md).

## Guiding principles

1. **Local-first.** Materials, artifacts, and the learner model are stored with the student. The project has no server that holds data.
2. **Zero installation.** Open a link and work. A desktop app is an optional add-on for later, not a requirement.
3. **One language: TypeScript.** Contributors only need to know one world.
4. **Small core, big plugins.** Most tools are **declarative** (YAML + prompt), so non-programmers can contribute.
5. **Structured output.** Every tool returns an object defined by a Zod schema. The UI knows how to display it, and the tests know how to check it.
6. **Grounded.** Every claim taken from the material carries a citation to a real page, slide, or section.
7. **Pedagogy first.** The default is "help me learn", not "give me the answer": Socratic questions, graded hints, retrieval practice, spaced repetition.
8. **Verify what can be verified.** Where a deterministic check exists (schemas, citations, symbolic math), it overrides the model.

## Overview

```
┌─────────────────────────────── The student's browser ────────────────────────────────┐
│                                                                                      │
│  UI: React + Tailwind (Hebrew RTL / English LTR)                                     │
│   Per course: Today's session · Mistakes · Materials · Concepts · Tools · Tutor ·    │
│               Review · Progress · Saved artifacts                                    │
│   Renderers: Markdown+KaTeX · Quiz · Exam · Flashcards · Mermaid · Solution check ·  │
│              Widget (sandboxed iframe + Viz Kit)                                     │
│        │                                                                             │
│  core (pure TypeScript)                                                              │
│   Ingestion ─► Course index ─► Tool runtime (plugins) ─► Artifacts ─► Learner model   │
│   (concepts + prerequisite graph)   │                      (BKT · FSRS · mistakes ·  │
│                     │               │                        daily session)          │
│                 retrieve()     LLM gateway (@anthropic-ai/sdk)                        │
│        │                                                                             │
│  platform (apps/web/src/platform):                                                   │
│   sql.js → <chosen folder>/ruecai.db (File System Access) · IndexedDB fallback ·     │
│   pdf.js · Pyodide + SymPy worker · API-key storage                                  │
└───────────────────────────────────────┬──────────────────────────────────────────────┘
                                        │ HTTPS, directly, with the student's own key
                                        ▼
                   Anthropic (Claude)   (future: university proxy, Ollama)

   The site itself: static files on GitHub Pages.
```

## Technology choices

| Layer | Choice | Why |
|---|---|---|
| Tooling | **TypeScript, npm workspaces, Vite, Vitest, Playwright** | A monorepo with nothing extra to install |
| UI | **React 19, Tailwind 4**, hash router | Large ecosystem, good RTL support |
| Database | **SQLite via sql.js** (WebAssembly). The whole `ruecai.db` is written to a folder the student picks (File System Access API, Chrome/Edge); other browsers use IndexedDB | Real SQL, and a file the student can see and back up. Details: [04-distribution.md](04-distribution.md#where-the-data-lives-a-regular-local-folder) |
| LLM | **`@anthropic-ai/sdk`** from the browser, behind an `LLMApi` interface. Tiers: fast = `claude-haiku-5-5`, smart = `claude-sonnet-5-5` (changeable in Settings) | Structured output with Zod, streaming, prompt caching, vision for photos and sparse pages |
| Schemas | **Zod** | One schema for LLM output, storage, UI, and evals |
| Parsing | **pdf.js** for PDFs (sparse pages such as scans and formulas go to vision); PPTX and DOCX are unpacked as ZIP+XML in JS | No Python and no local ML |
| Search | Structural index (course → source → section) + **BM25** + long context with prompt caching | For courses up to ~300K tokens this beats vector RAG and is simpler |
| Spaced repetition | **ts-fsrs** | |
| Mastery | **Bayesian Knowledge Tracing**, per concept | Same model as OATutor (Berkeley) |
| Math verification | **Pyodide + SymPy** in a Web Worker, loaded only when "Check my solution" first needs it | Real symbolic math in the browser |
| Visualization | **Mermaid**, **KaTeX**, and HTML/JS widgets in a sandboxed iframe with the bundled **Viz Kit** (three.js 3D, 2D plots, controls, KaTeX) | |
| Distribution | GitHub Pages, installable PWA | No per-PR preview deployments, by design (see [SECURITY.md](../SECURITY.md)) |

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

Usage (tokens and cost per action)
```

**`Concept` is the heart of the model.** Every question, flashcard, mistake, and artifact is tagged with a concept. That is how the system knows where the student is weak and orders work by prerequisites.

## Pipelines

### Ingestion (`packages/core/src/ingest/`)
```
file ─► hash (dedupe) ─► parse:
          pdf  → pdf.js text; "sparse" pages (scans, formulas) → Claude vision
          pptx → slide XML + notes
          docx → XML → Markdown
     ─► Sections with anchors (page / slide / heading)
     ─► fast tier: title + summary per Section, concept and prerequisite extraction
     ─► merge into the course concept graph ─► BM25 index
```
Progress is saved as it goes; a closed tab resumes where it stopped.

### Retrieval: `ctx.retrieve({ mode, query, concept, sourceIds, budgetChars })`
1. Filter by source (or by "sample exam" for `mode: samples`).
2. If the material fits the budget, send **all of it, in full**.
3. Otherwise, rank Sections with BM25 on the query and concept and take the best ones.
4. Context is assembled in a fixed order and sent as a cached system block, so repeated calls on the same course are cheap.

### Generation (Tool runtime, `packages/core/src/runtime.ts`)
```
request ─► retrieve ─► prompt (declarative template or code tool) ─► llm.object(Zod schema)
        ─► schema validation ─► citation check (invalid section ids removed) ─► Artifact
        ─► side effects: flashcards → FSRS deck, answers → BKT + mistakes notebook
```
If an artifact fails to render (for example a widget with a JavaScript error), the student can press "Fix", and the tool's optional `repair()` sends the error back to the model.

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
- **Flashcards (FSRS)**: each card is scheduled just before it would be forgotten.
- **Mistakes notebook**: every wrong answer is diagnosed by the fast tier ("the misconception behind it"). It returns the next day as a *new* question on the same misconception; two correct answers on different days resolve it, and a wrong answer resets it.
- **Today's session**: one button that mixes, within about 20 minutes, due flashcards, mistake retries, questions on the weakest concepts (only those whose prerequisites are not weak), and one solid concept that hasn't been practiced for the longest time (interleaving).
- **Concept graph**: the prerequisite links extracted by the model are cleaned up (cycles broken, redundant edges removed) and laid out from foundations to advanced, colored by mastery.
- **Study plan**: exam date + mastery + prerequisites → a daily schedule.

## The plugin system

Every tool is one folder under `plugins/<pack>/<tool-id>/`, discovered automatically by `plugins/registry.ts`.

**Declarative plugin (no code)**, for most contributors:
```
plugins/law/case-brief/
  plugin.yaml        # id, name, description, inputs, output type, tier, retrieval; Hebrew under i18n.he
  prompt.md          # English Handlebars template: {{course.name}}, {{params.x}}, {{concepts}}
  evals/eval.yaml    # quality criteria
  evals/golden.json  # one good output (used by CI and demo mode)
```
The runtime does everything else: retrieval, the shared system prompt (answer language, citations, pedagogy, academic integrity), structured output, validation, and saving.

**Code plugin (TypeScript)**, for multi-step logic: `plugin.yaml` with `kind: code` and an `index.ts` exporting `defineTool({ run(ctx) { … } })`.

### What `ctx` gives a code tool (`packages/sdk/src/tool.ts`)
| | |
|---|---|
| `ctx.course`, `ctx.params`, `ctx.today` | Course info, the student's input values, today's date |
| `ctx.retrieve(opts)` | Formatted material with section ids for citations |
| `ctx.concepts()` | Concepts with mastery, attempts, and prerequisites |
| `ctx.llm.object / text / stream` | Structured output, free text, streaming; `tier: "fast" \| "smart"`, optional images |
| `ctx.baseSystemPrompt` | The shared rules every tool should prepend |
| `ctx.progress(pct, msg)` | Progress bar |
| `ctx.math?.verify(claims)` | SymPy checks of `lhs == rhs` claims, when the platform provides it |
| `ctx.chat` | Only for `output: chat` tools (the tutor) |

### Artifact types (`packages/sdk/src/artifacts.ts`)
`markdown_doc` · `quiz` · `flashcards` · `exam_simulation` · `study_plan` · `interactive_widget` · `diagram` · `solution_check` · `concept_map` (reserved), plus `chat` for the tutor. The UI renders all of them; a new tool picks one and needs no UI code.

### Current tools
| Pack | Tools |
|---|---|
| `core` | tutor, check-solution, quiz, flashcards, summary, exam-from-samples, study-plan, explainer, diagram |
| `law` | case-brief |
| `math` | worked-example |

Planned packs: computer science, economics and management, psychology and social sciences. Each pack gets an owner from its faculty in CODEOWNERS.

## Quality: evals

- Every plugin ships `evals/eval.yaml` (fixture course, parameters, checks: minimum items, citation coverage, Hebrew ratio, required terms, and an LLM-judge question) and `evals/golden.json`.
- `npm test` runs the whole pipeline for every plugin against a fixture course with the recorded golden output, free, on every PR.
- On pushes to `main`, CI also runs the evals against real Claude with the cheap model (`claude-haiku-5-5`, override with `RUECAI_EVAL_MODEL`).
- **No plugin is merged without passing evals.**

## Safety

- The API key is stored only in the browser and sent only to `api.anthropic.com`.
- Model-written widgets run in `<iframe sandbox="allow-scripts">` without `allow-same-origin`, under a CSP that blocks all network access, with only the bundled Viz Kit.
- All rendered model output (Markdown, Mermaid SVG) goes through DOMPurify.
- Course material and student input are wrapped in tags and treated as data, not instructions.
- SymPy receives only whitelisted expressions, parsed against a dictionary of math names.
- Declarative plugins run no code. Code plugins are reviewed by CODEOWNERS.

## Repo structure

```
RuecAI_Tutor/
  apps/web/               # React PWA; src/platform = storage, secrets, SymPy worker
  packages/
    sdk/                  # @ruecai/sdk: artifact schemas, tool contract, quality checks, i18n
    core/                 # store (sql.js), parsers, ingestion, search, retrieval, LLM, learner model, runtime
  plugins/
    registry.ts           # auto-discovery
    evals.test.ts         # the quality gate for every plugin
    _fixtures/            # fixture courses (probability, law) and golden outputs
    core/  law/  math/    # the tools
  e2e/                    # Playwright student journeys + generated PDF/PPTX/DOCX fixtures
  docs/
  .github/                # CI, deploy, CODEOWNERS, issue and PR templates
```

## Privacy, copyright, and academic integrity

- Lecture materials belong to the lecturers. They are never shared between students, and the system can't share them: there is no server.
- No telemetry.
- Tools guide rather than solve: the tutor is Socratic by default, and "Check my solution" never reveals the full solution. A policy for graded assignments should be agreed with the university.
- The only external services the app contacts are Anthropic (model calls, with the student's key) and jsDelivr (the Pyodide runtime, downloaded when SymPy is first used; no student data is sent there).
