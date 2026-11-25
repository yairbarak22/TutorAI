# RuecAI Teacher 🎓

**An open-source, AI-powered study assistant for Reichman University students.** Open a link and start working: no installation, no server, and your course materials never leave your computer.

**👉 [Open the app](https://yairbarak22.github.io/RuecAI_Tutor/)**

Upload your course materials (PDFs, slides, Word documents, sample exams) and get:

| | |
|---|---|
| 🗺️ **Concept map** | The course's concepts and the prerequisites between them, colored by how well you know each one |
| 📝 **Summaries** | Every claim comes with a citation; click it to open the original page or slide |
| 🎓 **Socratic tutor** | Asks, guides, and cites the material. You can also ask for a direct explanation or "quiz me" |
| ❓ **Quizzes** | Multiple-choice and open questions with feedback that update your mastery tracking |
| 🃏 **Flashcards** | Spaced repetition (FSRS) that schedules each card before you forget it |
| 📝 **Exam from sample exams** | Learns the style, builds a new exam with a rubric, and grades your answers |
| 📅 **Study plan** | A daily schedule up to the exam, based on what you know and what you don't yet |
| 🧪 **Interactive explainers** | 3D scenes, plots, and simulations built with a bundled Viz Kit (three.js, 2D plots, controls, KaTeX), running in a sandboxed iframe with no network access |

## How it works

- **Local-first website**: everything runs in the browser. Your data is saved in a folder you choose (`ruecai.db` plus your files) in Chrome/Edge, or in browser storage in Safari/Firefox.
- **AI**: Anthropic's Claude, with your own API key, which is stored only in your browser. Without a key you can try **demo mode**. Default models are `claude-haiku-5-5` (fast) and `claude-sonnet-5-5` (smart); you can change them in Settings.
- **Hebrew or English**: the interface is available in Hebrew (RTL) and English (LTR). You pick the language, and AI-generated content follows it.
- **Tools are plugins**: every tool is a folder in [`plugins/`](plugins). You can write a new tool **without code** (a YAML file and a prompt), or in TypeScript.

## Contributing 🙌

Any student can contribute, even without programming: tool ideas, prompts, quality checks, and translations.

- [Contributing guide](CONTRIBUTING.md)
- [Write a new tool in 30 minutes](docs/plugins.md)
- [Good first issues](https://github.com/yairbarak22/RuecAI_Tutor/issues?q=is%3Aopen+label%3A%22good+first+issue%22)

```bash
git clone https://github.com/yairbarak22/RuecAI_Tutor.git && cd RuecAI_Tutor
npm install
npm run dev        # http://localhost:5173
npm run check      # typecheck + tests + evals + E2E
```

## Docs

[Landscape research](docs/01-landscape-research.md) · [Architecture](docs/02-architecture.md) · [Roadmap](docs/03-roadmap.md) · [Distribution and installation](docs/04-distribution.md) · [For maintainers](docs/maintainers.md) · [Security](SECURITY.md) · [Code of conduct](CODE_OF_CONDUCT.md)

Licensed under [Apache-2.0](LICENSE).
