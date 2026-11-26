# Instructions for AI coding agents

This file is for AI coding assistants (Claude Code, Cursor, Copilot, and others) working in this repo. Humans: start with [CONTRIBUTING.md](CONTRIBUTING.md).

## What this project is

RuecAI Teacher is a local-first study app: a static TypeScript web app with **no backend**. Data lives in `ruecai.db` (sql.js) in a folder the student picks, and Claude is called from the browser with the student's own key. Read [docs/02-architecture.md](docs/02-architecture.md) before changing anything in `packages/` or `apps/`.

## Where to put changes

- **A new study tool → a new folder in `plugins/<pack>/<tool-id>/`.** Prefer a declarative tool (`plugin.yaml` + `prompt.md`); use a code tool (`index.ts`) only for multi-step logic. Guide: [docs/plugins.md](docs/plugins.md).
- Every tool needs `evals/eval.yaml` and `evals/golden.json`. No tool is merged without passing evals.
- Core or SDK changes (`packages/`) start with an RFC issue. Keep the core small.

## Commands

```bash
npm run dev         # http://localhost:5173
npm run typecheck
npm test            # unit tests + offline plugin evals (golden outputs)
npm run e2e         # Playwright
npm run check       # all of the above
```

Helper scripts for agents, if any, are listed in `scripts/agent/README.md`.

## Rules

- **Language:** everything on GitHub (code, comments, prompts, docs, issues, commit messages) is in English. The UI is bilingual: add every UI string as `t("עברית", "English")`; plugin manifests are English with Hebrew under `i18n.he`.
- **Privacy:** no server, no telemetry, no new external network calls. The API key never goes into `ruecai.db` or logs.
- **Grounding:** outputs that use course material carry citations to section ids from `ctx.retrieve()`.
- **Pedagogy:** tools guide rather than solve. The shared rules live in `packages/core/src/llm/prompts.ts`; don't duplicate them in prompts.
- **Structured output:** tools return data matching a Zod schema from `packages/sdk/src/artifacts.ts`.
- **Security-sensitive files** (sandboxed iframe, Markdown sanitizing, secrets, SymPy whitelist, workflows) need a core maintainer's review. See [SECURITY.md](SECURITY.md).
- **Models:** defaults are `claude-haiku-5-5` (fast tier) and `claude-sonnet-5-5` (smart tier). Use the fast tier wherever quality allows.
- Keep PRs small and focused, and run `npm run check` before opening one.
