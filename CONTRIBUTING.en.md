# Contributing to RuecAI Teacher

Thanks for helping! The project is built by students from every faculty. You don't need to be a programmer to contribute.

## Ways to contribute

- **Anyone:** suggest a tool (issue template "רעיון לכלי חדש"), report bugs, improve UI copy.
- **Law / economics / psychology… students:** write a **declarative tool** (YAML + Hebrew prompt, no code), and add examples and evals for your field.
- **CS students:** TypeScript code tools, new renderers, engine improvements, tests.

## Setup (5 minutes)

Requires Node.js 22 and git.

```bash
git clone https://github.com/<your-user>/RuecAI_Tutor.git   # after forking
cd RuecAI_Tutor
npm install
npm run dev     # http://localhost:5173 → "בתוך הדפדפן" → "נסו במצב הדגמה" → a demo course
```

## Layout

| Path | What |
|---|---|
| `apps/web/` | The static web app (React, Vite, Tailwind, RTL) |
| `packages/sdk/` | `@ruecai/sdk`: artifact schemas, tool contract, quality checks |
| `packages/core/` | Engine: SQLite store, parsers (PDF/PPTX/DOCX), retrieval, Claude client, learner model (BKT + FSRS), tool runtime |
| `plugins/<pack>/<tool>/` | One folder per tool, auto-discovered |
| `e2e/` | Playwright tests |

## Writing a tool

See [docs/plugins.md](docs/plugins.md). A tool is a folder with `plugin.yaml`, then either `prompt.he.md` (declarative) or `index.ts` (code), plus `evals/eval.yaml` and `evals/golden.json`. It shows up in the UI automatically.

## Before opening a PR

Run `npm run check` (typecheck + unit tests + evals for every tool + browser E2E).

- No tool is merged without passing evals.
- Changes to `packages/` (core/SDK) start with an issue labelled `rfc`.
- Keep the UI in Hebrew, and write code and comments in English.
- Non-negotiables: no server or telemetry, every claim from course material is cited, the tool helps students learn rather than doing their work, and [SECURITY.md](SECURITY.md) applies.
