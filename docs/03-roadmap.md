# 03 — Implementation order (Roadmap)

> Version 2: adapted to the decision on a local-first web app in TypeScript ([04-distribution.md](04-distribution.md)).

## Status (November 2026)

| Phase | Status |
|---|---|
| 0: Foundations | ✅ Done |
| 1: MVP | ✅ Done |
| 2: The learning loop | ✅ Done |
| 3: Rich explanations | ✅ Partly: widgets with the Viz Kit (three.js 3D scenes, 2D plots, controls, KaTeX), Mermaid, self-repair. Not yet: Pyodide |
| 4: Recordings and desktop | ⏳ Open: issues on GitHub |
| **Student pilot** | ⏳ **Next step**: 10–20 students in probability and law |

Also shipped beyond the original plan: the UI is available in Hebrew (RTL) and English (LTR), and AI-generated content follows the student's chosen language.

**The principle:** every phase ends with something a real student uses **through a link**. The pilot runs on **one probability course and one law course**. Two fields this different will prove the system is truly generic.

---

## Phase 0: Foundations (1–2 weeks)
Goal: an empty but live site, and an outside contributor can start working.

- [ ] GitHub Organization, repo, Apache-2.0 license
- [ ] Monorepo: pnpm + Turborepo + Vite + React + TS, with RTL and Hebrew from day one *(shipped with npm workspaces)*
- [ ] `packages/core`, `sdk`, `platform`, `platform-web` (skeletons)
- [ ] SQLite-WASM + Drizzle, saving to a local folder the student chooses (File System Access) with an OPFS fallback. Atomic writes, a `.lock` file, testing inside a Google Drive folder. *(shipped with sql.js and an IndexedDB fallback)*
- [ ] LLM Gateway (AI SDK) and a settings screen: API key and fast/smart mapping *(shipped with the official Anthropic SDK)*
- [ ] CI: lint, typecheck, Vitest. Automatic deploy. *(Originally planned as Cloudflare Pages with a preview per PR; shipped as GitHub Pages for production, and PRs are checked by CI only — no per-PR previews.)*
- [ ] `README`, `CONTRIBUTING`, Issue/PR templates, CODEOWNERS

## Phase 1: MVP, "upload, understand, practice" (4–5 weeks)
Goal: a probability student opens a link, drags in 10 slide decks, and gets a summary, a grounded tutor, and a quiz.

- [ ] Ingestion: PDF (pdf.js, plus vision for pages with formulas) and PPTX, all in a Web Worker with checkpoints
- [ ] Sections, summaries, a BM25 index, and `retrieve()` with long context and caching
- [ ] Citations: clicking opens the page or slide in the viewer
- [ ] **Tool Runtime and SDK v0**, with the first three tools built on it *as plugins*:
  - `summary` (declarative plugin)
  - `quiz` (declarative plugin, with a built-in renderer)
  - `tutor-chat` (code plugin, tool calling)
- [ ] A "choose folder" screen in onboarding. In Safari/Firefox: a warning, `storage.persist()`, and backup to a `.ruecai` file.
- [ ] PWA: manifest, service worker, "Install" button
- [ ] Eval infrastructure and a golden set for the three tools
- [ ] **Pilot with 10–20 students** and feedback collection

## Phase 2: The learning loop (4–6 weeks)
Goal: know what I know and what I don't, ahead of the exam.

- [ ] Concept extraction and a concept graph
- [ ] Attempts, Mastery (BKT), and a "strengths and weaknesses" dashboard
- [ ] `flashcards` and a daily review screen (ts-fsrs)
- [ ] `exam-from-samples` (**the law use case**): upload sample exams, analyze their structure, generate a new exam in the same style, grade by rubric with feedback
- [ ] `study-plan`: exam date and a daily plan
- [ ] DOCX and free-form notes
- [ ] **Opening up to the community:** 15–20 issues labelled `good first plugin`, mostly declarative, and a "My first plugin in 30 minutes" guide

## Phase 3: Rich explanations (6–8 weeks, lots of parallel work)
Goal: the "wow" effect that makes students tell their friends.

- [ ] iframe sandbox (CSP, allowed libraries) and the `interactive_widget` artifact type
- [ ] `interactive-explainer`: a simulation with sliders for every concept
- [ ] `diagram` (Mermaid) and `scene_3d` (three.js)
- [ ] Pyodide and SymPy: an exercise generator with verified solutions
- [ ] Self-repair for code that fails to render
- [ ] First discipline packs: `math`, `cs`, `law`

## Phase 4: Recordings, and a desktop app if needed (4–6 weeks)
- [ ] Lecture transcription via an API, and citations by lecture minute
- [ ] Support for local Ollama (from localhost)
- [ ] **A decision based on pilot data:** is there real demand for a desktop app? If so:
  - [ ] `apps/desktop` in Electron and `platform-desktop` (folder storage, whisper.cpp with ivrit.ai, background work)
  - [ ] Code signing for Mac and Windows (ask the university for funding), and auto-update from GitHub Releases

## Phase 5: Ecosystem (ongoing)
- [ ] An in-app plugin gallery
- [ ] More discipline packs, with an "ambassador" from each faculty
- [ ] A university proxy (Cloudflare Worker, university login, and quotas), if the university funds a key
- [ ] Optional sync to the student's Drive or OneDrive
- [ ] Moodle integration
- [ ] Research on learning impact, together with faculty

---

## Community management

| Role | Responsibility |
|---|---|
| **Core maintainers** (3–5) | core, sdk, platform, security. Approve core changes. |
| **Pack owners** | One or more students from each field. CODEOWNERS of `plugins/<domain>/`. |
| **Contributors** | Any student: a declarative plugin, a prompt, eval cases, translation, bugs |

- A change to the core or SDK starts with a short RFC.
- The SDK uses semver.
- Launch hackathon: "A plugin in 24 hours".
- **Law, psychology, and economics students can contribute declarative plugins without writing a line of code.** This is the biggest advantage of the new structure.

## What to do now

1. Open an Organization and a repo and upload the docs.
2. Build Phase 0 (I can do this: a working skeleton with deploy).
3. Recruit 2–3 core maintainers and one ambassador from law.
4. Choose a pilot course and collect 10 real material files, with the lecturer's permission.
5. Check with the university: a central API key, an academic integrity policy, and code-signing funding (only if a desktop app is decided on).
