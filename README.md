# RuecAI Teacher 🎓

**An open-source AI study companion for Reichman University students.** Open a link and start studying: no installation, no server, and your course materials stay on your computer.

**👉 [Open the app](https://yairbarak22.github.io/RuecAI_Tutor/)** · Hebrew (RTL) and English · Apache-2.0

Upload a course's materials (PDFs, slides, Word documents, sample exams). RuecAI builds a map of the course's concepts, tracks what you already know, and gives you tools that help you **learn** instead of handing you answers.

## What a student gets

**Every day**

| | |
|---|---|
| ▶️ **Today's session** | One button, about 20 minutes: flashcards that are due, a second try at past mistakes, questions on your weakest concepts, and one older concept mixed in |
| 📓 **Mistakes notebook** | Every wrong answer is diagnosed ("the misconception behind it") and comes back later as a *new* question on the same idea, until you get it right twice on different days |
| 🃏 **Review** | Spaced-repetition flashcards (FSRS), scheduled just before you would forget them |
| 📈 **Progress and concept map** | The course's concepts laid out as a learning path from foundations to advanced, colored by how well you know each one |

**Tools** (each one is a plugin; see [`plugins/`](plugins))

| Tool | What it does |
|---|---|
| 🎓 **Private tutor** | Chat with a tutor that knows your course material. Socratic by default: it asks, guides, and cites the page or slide |
| ✅ **Check my solution** | Photograph or type your own solution. You get the first mistake, why it is wrong, and graded hints, never the full answer. Algebra is verified with real symbolic math (SymPy) |
| ❓ **Quiz** | Multiple-choice and open questions with explanations; every answer updates your mastery |
| 🃏 **Flashcards** | Generated from the material, straight into your daily review |
| 📝 **Exam from sample exams** | Learns the structure and style of past exams, builds a new one with a rubric, and grades your answers |
| 📅 **Study plan** | A daily schedule up to the exam, ordered by what you know and by prerequisites |
| 📄 **Summary** | A structured summary where every claim links to its source page or slide |
| 🧪 **Interactive explainer** | Simulations, plots, and 3D scenes that run in a sandbox with no network access |
| 🔀 **Diagram** | Concept maps, flowcharts, and timelines |
| ⚖️ **Case brief** (law) | IRAC analysis of a legal problem, grounded in the course's statutes and rulings |
| ➗ **Worked example** (math) | A new exercise with a step-by-step solution and graded hints |

## Why not just study with a chatbot?

A general chatbot is a brilliant tutor with no memory of you. RuecAI is the system around the model:

| A general chatbot | RuecAI Teacher |
|---|---|
| Waits for you to know what to ask | Prepares today's session for you |
| Doesn't know which concepts you have mastered | Tracks mastery per concept (Bayesian Knowledge Tracing) across the semester |
| Forgets your mistakes when the chat ends | Brings each mistake back until it is fixed |
| Tends to give the answer | Guides with questions and graded hints by default |
| Can be confidently wrong on algebra | Checks math steps with SymPy, which overrides the model |
| Citations may be invented | Every citation must point to a real page or slide in your material; invalid ones are removed |
| You re-paste material and re-write prompts | The course is indexed once, and every tool is a tested, ready-made workflow |

## How it works

- **Local-first.** Everything runs in your browser. Your data lives in a folder you choose (`ruecai.db` plus your files) in Chrome/Edge, or in browser storage in Safari/Firefox. There is no RuecAI server and no telemetry.
- **AI.** Anthropic's Claude, called directly from the browser with **your own API key**, stored only in your browser. Defaults: `claude-haiku-5-5` for fast work and `claude-sonnet-5-5` for explanations and exams; you can change both in Settings. No key yet? Try **demo mode** with a sample course.
- **Grounded.** Material is split into sections with page/slide anchors. Tools receive the relevant sections, and every output is validated against a schema and checked for valid citations.
- **Bilingual.** The interface is in Hebrew (RTL) or English (LTR); AI-generated content follows your choice.
- **Open to contributions.** Every tool is a folder in [`plugins/`](plugins). A new tool can be written **without code** (a YAML file and a prompt), and none is merged without passing automated quality checks (evals).

More detail: [Architecture](docs/02-architecture.md).

## Contributing 🙌

Students from every faculty can contribute, including non-programmers: tool ideas, prompts for your field, quality checks, and translations.

- [Contributing guide](CONTRIBUTING.md)
- [Write a new tool in 30 minutes](docs/plugins.md)
- [Suggest a tool](https://github.com/yairbarak22/RuecAI_Tutor/issues/new?template=tool-idea.yml) · [Good first issues](https://github.com/yairbarak22/RuecAI_Tutor/issues?q=is%3Aopen+label%3A%22good+first+issue%22)

```bash
git clone https://github.com/yairbarak22/RuecAI_Tutor.git && cd RuecAI_Tutor
npm install
npm run dev        # http://localhost:5173
npm run check      # typecheck + unit tests + plugin evals + browser E2E
```

## Status

Working today: everything listed above. Next: a **student pilot** with 10–20 students in a probability course and a law course. See the [roadmap](docs/03-roadmap.md).

## Docs

[Architecture](docs/02-architecture.md) · [Roadmap](docs/03-roadmap.md) · [Writing tools](docs/plugins.md) · [Distribution and installation](docs/04-distribution.md) · [Landscape research](docs/01-landscape-research.md) · [For maintainers](docs/maintainers.md) · [Security](SECURITY.md) · [Code of conduct](CODE_OF_CONDUCT.md)

Licensed under [Apache-2.0](LICENSE). Course materials belong to their lecturers; RuecAI never shares them between students.
