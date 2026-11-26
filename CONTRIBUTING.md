# Contributing to RuecAI Teacher

Thanks for being here! 🙏 The project is built by students from every faculty. You don't need to be a programmer to contribute.

## Ways to contribute

| Who | What you can do |
|---|---|
| **Any student** | Open a [tool idea](https://github.com/yairbarak22/RuecAI_Tutor/issues/new?template=tool-idea.yml), report a bug, improve UI wording or translations (Hebrew and English) |
| **Law, economics, psychology… students** | Write a **declarative tool** (YAML + an English prompt, no code), and add examples and quality checks (evals) for your field |
| **CS students** | TypeScript code tools, new renderers, engine improvements, tests |

## Never used GitHub? Start here

Most contributors here are not programmers, and that's fine. **Use an AI assistant** (Claude Code, Cursor, ChatGPT, Copilot…): this repo includes [AGENTS.md](AGENTS.md), which tells your assistant how to guide you step by step in plain language, explain every term, and ask before posting anything public. In Claude Code, just type **`/contribute`**.

The whole path, in plain words:

1. **Pick a task.** Open issues are to-do cards. Look for the labels `good first issue` and `no-code`.
2. **Claim it.** Comment **`/claim`** with 1–3 sentences on what you plan to change. A bot assigns you. New contributors work on **one issue at a time** until their first two PRs are merged.
3. **Make the change** on your own copy of the project (a *fork*), in a separate *branch*.
4. **Check it** with `npm test`, and look at it in the app.
5. **Open a pull request (PR):** a request to add your change. Write `Closes #<issue>` and explain the change in your own words.
6. **Review:** automatic checks run, and a maintainer may suggest changes. That's normal and friendly.
7. **Merge:** your change goes live on the site within minutes. 🎉

Can't continue? Comment **`/unclaim`**. An issue with no PR after **10 days** gets a reminder, and after **14 days** it's released so someone else can take it.

AI help is welcome. What matters: you've tried the change yourself and can explain in two sentences what it does and why.

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
| `packages/core/` | The engine: SQLite store (sql.js), parsers (PDF/PPTX/DOCX), ingestion, retrieval, model clients (Claude, local models), learner model (BKT, FSRS, mistakes notebook, daily session, concept graph), tool runtime |
| `plugins/<pack>/<tool>/` | The tools, one folder per tool, auto-discovered |
| `plugins/_fixtures/` | Fixture courses (probability, law) used by evals, demo mode, and E2E |
| `e2e/` | Real-browser tests (Playwright) |
| `docs/` | [Architecture](docs/architecture.md), [writing tools](docs/plugins.md), [roadmap](docs/roadmap.md), [maintainer guide](docs/maintainers.md) |

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
- PRs are checked by CI (typecheck, unit tests, recorded plugin evals, Playwright E2E). To try a PR, check it out locally and run `npm run dev`.

## Non-negotiables

1. **Privacy:** no server, no telemetry. The API key and course materials never leave the computer, except for the call to the model the student chose.
2. **Grounding:** every claim from the course material is cited.
3. **Pedagogy:** help students learn; don't do their work for them.
4. **Security:** see [SECURITY.md](SECURITY.md).

## Labels

`good first issue` (good for newcomers) · `no-code` (no programming needed) · `plugin-idea` (tool idea) · `pack:law` / `pack:math`… (by field) · `rfc` (core change)

Questions? Open an issue or start a discussion. There are no stupid questions.
