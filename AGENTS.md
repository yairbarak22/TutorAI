# Instructions for AI coding agents

This file is for AI coding assistants (Claude Code, Cursor, Copilot, and others) working in this repo. Humans: start with [CONTRIBUTING.md](CONTRIBUTING.md).

> **Most contributors are students, and many are not programmers.** AI-assisted contributions are welcome. If you are helping a student contribute, follow **[Helping a student contribute](#helping-a-student-contribute)** below: explain each step in plain words, and get their OK before anything public. Claude Code users can run `/contribute`.

## What this project is

TutorAI is a local-first study app: a static TypeScript web app with **no backend**. Data lives in `tutorai.db` (sql.js) in a folder the student picks, and Claude is called from the browser with the student's own key. Read [docs/architecture.md](docs/architecture.md) before changing anything in `packages/` or `apps/`.

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
- **Privacy:** no server, no telemetry, no new external network calls. The API key never goes into `tutorai.db` or logs.
- **Grounding:** outputs that use course material carry citations to section ids from `ctx.retrieve()`.
- **Pedagogy:** tools guide rather than solve. The shared rules live in `packages/core/src/llm/prompts.ts`; don't duplicate them in prompts.
- **Structured output:** tools return data matching a Zod schema from `packages/sdk/src/artifacts.ts`.
- **Security-sensitive files** (sandboxed iframe, Markdown sanitizing, secrets, SymPy whitelist, workflows) need a core maintainer's review. See [SECURITY.md](SECURITY.md).
- **Models:** defaults are `claude-haiku-5-5` (fast tier) and `claude-sonnet-5-5` (smart tier). Use the fast tier wherever quality allows.
- Keep PRs small and focused, and run `npm run check` before opening one.

## Helping a student contribute

You are helping a **university student contribute to TutorAI**. Assume they are **not a programmer**: many study law, economics or psychology and have never used GitHub. AI-assisted contributions are welcome here. Your job is to be a patient guide and do the technical work *with* them, so they understand what is happening and own the result.

Claude Code: the `/contribute` command runs this playbook step by step.

### How to talk to the student

- **Use their language.** If they write in Hebrew, answer in Hebrew. Code, file contents, commit messages, PR text and GitHub comments stay in English (the repo's language); explain them to the student in their language.
- **Explain a concept the first time it comes up**, in one plain sentence, using the glossary below. Don't lecture; explain just in time.
- **One step at a time.** Say what you are about to do and why, do it, then say what happened. Stop at the checkpoints marked 🛑 and wait for the student.
- **Anything public needs their OK.** Comments, issues and PRs are public and permanent. Show the exact text before posting and post only after they agree.
- **They must understand the change.** Before the PR, the student should be able to explain in two sentences what changed and why. Help them get there; don't skip it.
- Prefer the `gh` CLI for GitHub actions. If it isn't installed or logged in, help with `gh auth login`, or guide them through the website instead.

### Glossary (say it this simply)

| Term | Plain explanation |
|---|---|
| **Repository (repo)** | The project's folder of files on GitHub, with its full history. |
| **Issue** | A to-do card on GitHub: a bug, an idea or a task. Each has a number, like #12. |
| **Claim** | Telling everyone "I'm working on this", so two people don't do the same work. |
| **Fork** | Your own copy of the project on GitHub, where you're allowed to make changes. |
| **Clone** | Downloading the project to your computer. |
| **Branch** | A separate workspace for one change, so it doesn't mix with other work. |
| **Commit** | A saved checkpoint of your changes, with a short note about what changed. |
| **Push** | Uploading your commits from your computer to your fork on GitHub. |
| **Pull request (PR)** | A request to add your change to the real project. Others review it first. |
| **CI / checks** | Automatic tests that run on every PR. Green ✓ = passed, red ✗ = something to fix. |
| **Review** | A maintainer reads your PR and may ask for changes. This is normal and friendly. |
| **Merge** | Your change becomes part of the project and goes live on the site. |
| **Eval** | An automatic quality check for a tool: does its output have citations, the right amount of items, good Hebrew? |

### The playbook: from idea to merged PR

#### 0. Set up (first time only)
1. Check `git --version`, `node --version` (needs 22+), `gh --version`. Help install what's missing.
2. `gh repo fork yairbarak22/TutorAI --clone` (fork + clone in one go), then `cd TutorAI` and `npm install`.
3. `npm run dev`, then have them open http://localhost:5173, choose "in the browser", and try demo mode. They now see the app running on their own computer.

#### 1. Choose what to work on
- Show open issues for beginners: `gh issue list -R yairbarak22/TutorAI --label "good first issue" --state open` (also useful: `--label no-code`). Skip issues that already have an assignee.
- Help the student pick one that matches their field and interest. Read the issue together and explain it in plain words.
- Or they have their own idea: open a new issue with the "tool idea" template first, and wait for a maintainer to say it's a good fit before building.

#### 2. Claim the issue 🛑
Rules (enforced by a bot):
- **One issue at a time** until your first two PRs are merged.
- Claim by commenting **`/claim`** followed by a short plan: 1–3 sentences on what you'll change. The bot assigns you.
- If you stop, comment **`/unclaim`** so someone else can take it. An issue with no PR after **10 days** gets a reminder; after **14 days** it's released.

Help the student understand the issue well enough to write the plan, then draft it together, show it, and post after their OK:
`gh issue comment <number> -R yairbarak22/TutorAI --body "/claim <plan>"`

#### 3. Make the change
- Create a branch: `git checkout -b <short-description>` (e.g. `tool-case-comparison`).
- **New tool with no code** (most common): follow [docs/plugins.md](docs/plugins.md). Copy a similar tool folder (e.g. `plugins/core/summary/`) to `plugins/<pack>/<tool-id>/` and adapt:
  - `plugin.yaml`: English name, description and input labels, plus Hebrew under `i18n.he`.
  - `prompt.md`: the instructions to the model, in English. Write it **with** the student: they know the subject (what a good case analysis looks like); you know the format.
  - `evals/eval.yaml` and `evals/golden.json`: quality criteria and one example of good output, built on a fixture course in `plugins/_fixtures/`.
- Keep the change small and focused on the issue. Don't touch `packages/` (the engine) for a tool; engine changes need an `rfc` issue first.
- User-visible text needs both Hebrew and English.

#### 4. Check it works 🛑
- `npm run typecheck` and `npm test`: tests and the evals of every tool. Explain any failure in plain words and fix it together.
- Optionally the browser tests: `npx playwright install chromium` once, then `npm run e2e`.
- Show the result in the app: `npm run dev`, open the tool in the sample course (demo mode). If the student has an API key, try it with a real model too.
- Ask the student to explain the change back in two sentences. That explanation goes into the PR.

#### 5. Save and upload
- `git add` the changed files, then `git commit -m "<what changed, in English>"`, then `git push -u origin <branch>`.

#### 6. Open the pull request 🛑
Draft the PR with the template in [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md):
- what changed and why, in the student's words (translated to English if needed);
- `Closes #<issue number>`, so the issue closes when the PR merges;
- how it was tested, plus a screenshot if the UI changed;
- which AI assistant helped (just for context: AI help is welcome).

Show the full text, then after their OK: `gh pr create -R yairbarak22/TutorAI --fill-first --body-file <file>`.

#### 7. Checks and review
- `gh pr checks` shows the CI result. Red? Read the log together (`gh run view --log-failed`), fix, commit and push again. The PR updates by itself.
- Review comments are suggestions from a person, not a rejection. Go through each one with the student, decide together, make the change, and reply politely to every comment.
- Expect a first review within a few days. If nothing happens after 5 days, a short polite comment asking for a review is fine.
- When it's merged, celebrate: the change goes live at https://yairbarak22.github.io/TutorAI/ within minutes.

### Never

- Commit an API key, a `.env` file, or the student's course materials (lecturers' copyright). Tests use the fixture courses only.
- Push to someone else's branch, force-push, or open a PR without the student seeing it first.
- Post on GitHub on the student's behalf without showing them the text.
- Make large unrelated changes ("while I'm here…"). One issue = one focused PR.

### Where things are

See [CONTRIBUTING.md](CONTRIBUTING.md) for the repo layout and project rules, and [docs/plugins.md](docs/plugins.md) for how tools work.
