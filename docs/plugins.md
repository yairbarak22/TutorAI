# Writing a tool (plugin): the complete guide

Every tool in RuecAI Teacher is **one folder** under `plugins/<pack>/<tool-id>/`. The core discovers it automatically and adds it to the "Tools" tab. There is no registration code.

There are two kinds:

| | Declarative tool (`declarative`) | Code tool (`code`) |
|---|---|---|
| What you write | `plugin.yaml` + `prompt.md` | `plugin.yaml` + `index.ts` |
| Good for | Most tools: summaries, questions, case analysis, exercises | Multi-step logic, calculations, conversation |
| Need to code? | **No** | Basic TypeScript |
| Examples | `core/summary`, `law/case-brief`, `math/worked-example` | `core/tutor`, `core/exam-from-samples`, `core/study-plan`, `core/explainer` |

---

## A declarative tool in 30 minutes: a full example

Let's build a law tool: **"Compare rulings"**.

### 1. `plugins/law/compare-rulings/plugin.yaml`

The base fields (`name`, `description`, input `label`s) are in English. Hebrew translations go in the `i18n.he` block, and the UI shows whichever language the student picked.

```yaml
id: compare-rulings            # must match the folder name
name: Compare rulings
description: A comparison table of two rulings — facts, holding, reasoning, and how they differ.
icon: "⚖️"
pack: law
kind: declarative
output: markdown_doc           # the artifact type (list below)
tier: smart                    # smart = the smart model, fast = fast and cheap
disciplines: [law]
inputs:                        # the fields the student fills in
  - { name: first, label: "First ruling", type: text, required: true }
  - { name: second, label: "Second ruling", type: text, required: true }
retrieval:
  mode: search                 # scope | search | samples | none
  query: "{{params.first}} {{params.second}}"
i18n:
  he:
    name: השוואת פסקי דין
    description: טבלת השוואה בין שני פסקי דין — עובדות, הלכה, נימוקים ומה ההבדל ביניהם.
    inputs:
      first: { label: "פסק דין ראשון" }
      second: { label: "פסק דין שני" }
authors: [Your Name]
```

For `select` inputs, `i18n.he.inputs.<name>.options` maps each option value to its Hebrew display label.

### 2. `plugins/law/compare-rulings/prompt.md`

Prompts are written in English. You don't need to say which language to answer in: the base system prompt tells the model to answer in the student's chosen language.

```markdown
Compare the ruling "{{params.first}}" with "{{params.second}}" as they appear in the material for the course "{{course.name}}".

Sections:
1. "Comparison table" — a Markdown table: facts | legal question | holding | key reasoning.
2. "The essential difference" — 3–5 points.
3. "How to use this in the exam" — when to cite each of them.

Every section must have citations. If one of the rulings doesn't appear in the material, say so explicitly.
```

**Variables available in the template:**
- `{{course.name}}`, `{{course.examDate}}`
- `{{params.<name>}}`, the values the student filled in
- `{{concepts}}`, the list of course concepts (so the model uses the right names)
- `{{today}}`
- `{{#if params.x}}…{{/if}}`, text that appears only when the field isn't empty

A variable that doesn't exist fails the tests, so a typo is caught immediately.

You don't need to write the citation, language, or pedagogy rules in the prompt. The core adds them to every tool (`BASE_SYSTEM_PROMPT` in `packages/core/src/llm/prompts.ts`). The course material is also sent automatically, according to `retrieval`.

> The loader still accepts the older file name `prompt.he.md`, but new tools should use `prompt.md`.

### 3. Quality checks: `evals/eval.yaml`

```yaml
fixture: law                 # a sample course from plugins/_fixtures/ (probability | law)
params: { first: "Kal Binyan", second: "..." }
checks:
  min_items: 3               # at least 3 sections
  min_citation_coverage: 0.8 # 80% of sections with a valid citation
  min_hebrew_ratio: 0.7
  must_mention: [הלכה]
  judge: "Is the comparison accurate and grounded in the material?"   # for the live check against a real model
```

### 4. Example output: `evals/golden.json`

One good output, in the format of the artifact type. The key is the tool's id. Citations are written as `S1`, `S2`…, and the eval harness maps them to real sections.

```json
{ "compare-rulings": { "title": "...", "sections": [ { "heading": "...", "markdown": "...", "citations": ["S1"] } ] } }
```

The golden output is used for three things: CI (at no cost), **demo mode** in the app, and the browser tests.

### 5. Testing

```bash
npm test          # checks that the tool loads, the prompt renders, and the output passes every check
npm run dev       # the tool appears in the "Tools" tab
ANTHROPIC_API_KEY=sk-ant-... npm run eval:live   # (optional) against the real model
```

PRs run only the recorded evals (using `golden.json`). Live evals against real Claude run on pushes to `main`, using the cheap model `claude-haiku-5-5` (override with `RUECAI_EVAL_MODEL`).

---

## Artifact types (`output`)

The UI already knows how to display all of them. The full schemas are in `packages/sdk/src/artifacts.ts`.

| `output` | What it is | Shown as |
|---|---|---|
| `markdown_doc` | `title` + `sections[]` (heading, markdown, citations) | A document with formulas and citations |
| `quiz` | `mcq` / `open` questions with an explanation, concept, and citations | An interactive quiz that updates mastery |
| `flashcards` | `cards[]` (front/back/concept) | Added automatically to spaced repetition |
| `diagram` | Mermaid + explanation | A diagram |
| `exam_simulation` | Questions with `points`, `rubric`, `model_answer` | An exam with a timer and rubric-based grading |
| `study_plan` | Days and tasks | A study plan |
| `interactive_widget` | A self-contained HTML document | A sandboxed iframe (no network, no data access) with the bundled Viz Kit: three.js 3D scenes, 2D plots, controls, KaTeX formulas |
| `concept_map` | Concepts and prerequisites | (Reserved for future use) |
| `chat` | Reserved for the tutor | A chat screen |

## Input fields (`inputs[].type`)

`text` · `textarea` · `number` · `select` (with `options`) · `concept` (pick from the course concepts) · `source` (pick a file, or "all materials")

## `retrieval.mode`

| mode | What is sent to the model |
|---|---|
| `scope` | All study material (or the file selected in the `source` field) |
| `search` | Like `scope`. If the course is bigger than the budget, the sections most relevant to `query` and `concept` are selected |
| `samples` | Only files marked "sample exam" |
| `none` | Nothing (for example, a study plan computed without a model) |

---

## Code tools (TypeScript)

A `plugin.yaml` with `kind: code`, and an `index.ts` file:

```ts
import { defineTool, Quiz } from "@ruecai/sdk";

export default defineTool<"quiz">({
  async run(ctx) {
    ctx.progress(0.1, "Gathering material…");
    const material = await ctx.retrieve({ concept: String(ctx.params.concept) });
    const quiz = await ctx.llm.object(Quiz, {
      system: ctx.baseSystemPrompt,
      context: material.text,          // sent as a cached system block
      prompt: "Write 5 tricky questions about…",
      tier: "smart",
      tag: "my-tool",                  // key in golden.json
    });
    return { type: "quiz", title: quiz.title, data: quiz };
  },
});
```

### What's in `ctx`

| | |
|---|---|
| `ctx.course` | `{ id, name, examDate }` |
| `ctx.params` | The field values |
| `ctx.retrieve(opts)` | `{ text, sections, truncated }`: formatted material with section ids |
| `ctx.concepts()` | Concepts with `mastery` (0–1), `attempts`, `prerequisites` |
| `ctx.llm.object(schema, opts)` | Structured output from a Zod schema |
| `ctx.llm.text(opts)` / `ctx.llm.stream(opts, onDelta)` | Free text / streaming |
| `ctx.progress(pct, msg)` | Updates the progress bar |
| `ctx.baseSystemPrompt` | The shared rules (answer language, citations, pedagogy, academic integrity) |
| `ctx.today` | The date (injectable in tests) |
| `ctx.chat` | Only for `output: chat` tools: `{ history, message, onDelta }` |

After `run`, the core validates the output against the schema, removes citations that don't exist in the context, saves the artifact to `ruecai.db`, and creates flashcards if needed.

**`repair(ctx, artifact, error)`** (optional): called when an artifact fails to render, for example a widget with a JavaScript error. See `core/explainer`.

## Rules

- `id` is unique and matches the folder name (lowercase letters, digits, and hyphens).
- A code tool imports only from `@ruecai/sdk`, `zod`, and files inside its own folder.
- No `fetch` to external services. If you need one, open an RFC.
- A new discipline pack (`plugins/economics/`, for example) = a new folder, and you add yourself to CODEOWNERS.

## SDK versions

The SDK uses semantic versioning. `sdk: "^0.1"` in plugin.yaml declares compatibility. A breaking SDK change bumps the version and updates every tool in the same PR.
