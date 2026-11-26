# 03 — Roadmap

> Version 3 (November 2026). **The principle:** every phase ends with something a real student uses **through a link**.

## Status

| Phase | Status |
|---|---|
| 0: Foundations | ✅ Done |
| 1: MVP — upload, understand, practice | ✅ Done |
| 2: The learning loop | ✅ Done |
| 3: Rich explanations and verification | ✅ Done |
| **Student pilot** | ⏳ **Next**: 10–20 students in one probability course and one law course |
| 4: Recordings and desktop | ⏳ Open |
| 5: Ecosystem | ⏳ Ongoing |

The pilot runs on two fields as different as probability and law, to prove that the system is truly generic.

---

## Phase 0: Foundations ✅
- [x] Public repo, Apache-2.0, README, CONTRIBUTING, issue and PR templates, CODEOWNERS
- [x] Monorepo with npm workspaces, Vite, React, TypeScript; Hebrew RTL and English LTR from day one
- [x] `packages/core`, `packages/sdk`, and a platform layer in `apps/web/src/platform`
- [x] SQLite (sql.js) saved to a folder the student chooses (File System Access), with an IndexedDB fallback and a lock file
- [x] LLM gateway on the official Anthropic SDK; Settings for the API key and the fast/smart models
- [x] CI (typecheck, tests, evals, E2E) and automatic deploy to GitHub Pages

## Phase 1: MVP — upload, understand, practice ✅
- [x] Ingestion of PDF (with vision for sparse pages), PPTX, DOCX, and text
- [x] Sections, summaries, BM25, and `retrieve()` with long context and prompt caching
- [x] Citations that open the original page or slide
- [x] Tool runtime and SDK, with the first tools as plugins: `summary`, `quiz`, `tutor`
- [x] Onboarding with a folder choice; persistent storage and `.ruecai` backups in Safari/Firefox
- [x] Installable PWA
- [x] Eval infrastructure and golden outputs; demo mode with a sample course

## Phase 2: The learning loop ✅
- [x] Concept extraction and a prerequisite graph, shown as a learning path
- [x] Attempts, mastery per concept (BKT), and a progress dashboard
- [x] `flashcards` and a daily review screen (FSRS)
- [x] `exam-from-samples` (the law use case): learn the style of sample exams, build a new exam, grade by rubric
- [x] `study-plan`: a daily plan up to the exam date
- [x] **Today's session**: one button that mixes due cards, mistake retries, weak concepts, and interleaving
- [x] **Mistakes notebook**: diagnosed misconceptions that come back as new questions until fixed

## Phase 3: Rich explanations and verification ✅
- [x] Sandboxed widgets (CSP, no network) with the bundled Viz Kit: three.js 3D, 2D plots, controls, KaTeX
- [x] `explainer` (simulations) and `diagram` (Mermaid), with a "Fix" button that sends render errors back to the model
- [x] Pyodide + SymPy in a Web Worker
- [x] `check-solution`: photograph or type a solution, get the first mistake and graded hints; SymPy overrides the model on algebra
- [x] First discipline packs: `law` (case brief) and `math` (worked example)

## Student pilot ⏳ (next)
- [ ] Choose one probability course and one law course, and get the lecturers' permission to use their materials
- [ ] Recruit 10–20 students; a short onboarding session
- [ ] Measure: return rate to today's session without reminders, mastery change per concept, cost per active student, and qualitative feedback
- [ ] Decide on API keys for the pilot (personal keys vs. a university-funded key)
- [ ] Agree on an academic-integrity policy with the university

## Phase 4: Recordings, and a desktop app if needed
- [ ] Lecture recordings: transcription with timestamps, and citations by lecture minute
- [ ] Local models (Ollama on localhost)
- [ ] **Decision based on pilot data:** is a desktop app (Electron, same code) really needed? If so: local whisper with ivrit.ai models, background work, code signing

## Phase 5: Ecosystem (ongoing)
- [ ] An in-app tool gallery, filtered by course
- [ ] More discipline packs (computer science, economics, psychology), each with an owner from its faculty
- [ ] A university proxy (Cloudflare Worker, university login, quotas), so students don't need their own key
- [ ] Optional sync to the student's Drive or OneDrive
- [ ] Moodle integration
- [ ] LLM-as-judge evals for pedagogy ("does not give away the answer", "fits the course level")
- [ ] Research on learning impact, together with faculty

---

## Community

| Role | Responsibility |
|---|---|
| **Core maintainers** (3–5) | `packages/`, `apps/`, security, CI. Approve core changes. |
| **Pack owners** | One or more students or TAs per field; CODEOWNERS of `plugins/<pack>/`. |
| **Contributors** | Any student: a declarative tool, a prompt, eval cases, translations, bug reports. |

- A change to the core or SDK starts with a short RFC issue.
- The SDK uses semantic versioning.
- Law, psychology, and economics students can contribute declarative tools without writing a line of code. This is the project's biggest structural advantage.
- Launch idea: a "tool in 24 hours" hackathon with each faculty.
