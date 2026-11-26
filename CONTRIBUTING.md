# Contributing to RuecAI Teacher

Thanks for being here! 🙏 The project is built by students from every faculty. You don't need to be a programmer to contribute.

## Ways to contribute

| Who | What you can do |
|---|---|
| **Any student** | Open a [tool idea](https://github.com/yairbarak22/RuecAI_Tutor/issues/new?template=tool-idea.yml), report a bug, improve UI wording or translations (Hebrew and English) |
| **Law, economics, psychology… students** | Write a **declarative tool** (YAML + an English prompt, no code), and add examples and quality checks (evals) for your field |
| **CS students** | TypeScript code tools, new renderers, engine improvements, tests |

## Setup (5 minutes)

You need [Node.js 22](https://nodejs.org) and git.

```bash
git clone https://github.com/<your-user>/RuecAI_Tutor.git   # after forking
cd RuecAI_Tutor
npm install
npm run dev
```

Open http://localhost:5173, choose in-browser storage, then try demo mode with the sample course. You can work without an API key: demo mode replays the recorded golden outputs.

## Repo layout

| Path | What |
|---|---|
| `apps/web/` | The static web app (React, Vite, Tailwind; Hebrew RTL and English LTR UI). `src/platform/` holds storage, the API key, and the SymPy worker |
| `packages/sdk/` | `@ruecai/sdk`: artifact schemas, the tool contract, quality checks |
| `packages/core/` | The engine: SQLite store (sql.js), parsers (PDF/PPTX/DOCX), ingestion, retrieval, Claude client, learner model (BKT, FSRS, mistakes notebook, daily session, concept graph), tool runtime |
| `plugins/<pack>/<tool>/` | The tools, one folder per tool, auto-discovered |
| `plugins/_fixtures/` | Fixture courses (probability, law) used by evals, demo mode, and E2E |
| `e2e/` | Real-browser tests (Playwright) |
| `docs/` | Architecture, roadmap, guides |

## Writing a new tool

See **[docs/plugins.md](docs/plugins.md)**. In short:

1. Create a folder `plugins/<pack>/<tool-id>/`.
2. Add `plugin.yaml` (what the tool is, its input fields, what it returns, with Hebrew translations under `i18n.he`), then either `prompt.md` (an English prompt for a declarative tool) or `index.ts` (a code tool).
3. Add `evals/eval.yaml` (quality criteria) and `evals/golden.json` (an example of good output).
4. Run `npm test`, then open a PR.

The tool shows up in the UI automatically. You don't need to register it anywhere.

## Before opening a PR

```bash
npm run check   # typecheck + unit tests + evals for every tool + browser E2E
```

- **Iron rule:** no tool is merged without passing evals.
- Changes to `packages/` (core/SDK) start with an issue labelled `rfc`, so we agree on the direction before writing code.
- A small, focused PR beats a huge one.
- UI text is available in Hebrew and English: add both when you add UI strings. Code, comments, and plugin prompts are in English.
- PRs are checked by CI only (typecheck, unit tests, recorded plugin evals, Playwright E2E). There are no per-PR preview deployments; to try a PR locally, check it out and run `npm run dev`.

## Non-negotiables

1. **Privacy:** no server, no telemetry. The API key and course materials never leave the computer (except for the call to Anthropic).
2. **Grounding:** every claim from the course material is cited.
3. **Pedagogy:** help students learn; don't do their work for them.
4. **Security:** see [SECURITY.md](SECURITY.md).

## Labels

`good first issue` (good for newcomers) · `no-code` (no programming needed) · `plugin-idea` (tool idea) · `pack:law` / `pack:math`… (by field) · `rfc` (core change)

Questions? Open an issue or start a discussion. There are no stupid questions.
