# 01 — Landscape research: existing open-source projects

> As of November 2026. Star counts, versions, and licenses change — **check the LICENSE file in each repo before copying any code from it.**

## TL;DR

1. **No single project does what we want** — a local, multi-disciplinary, Hebrew-capable tool, built by the student community of one university, that lets any student easily add a new "study tool".
2. **There are many excellent pieces** we can learn from or use as libraries: document ingestion, RAG, spaced repetition (FSRS), Manim animations, multi-agent classrooms.
3. **Recommendation:** build our own thin, modular core with a **plugin system** at the center of the project — and borrow ideas and libraries from the projects below rather than forking one of them.

---

## 1. Academic projects (universities / research labs)

| Project | Institution | What it does | What to learn from it | Limitations for us |
|---|---|---|---|---|
| **[OpenMAIC](https://github.com/THU-MAIC/OpenMAIC)** | Tsinghua University | Takes a topic or material and generates a whole "classroom": slides, quizzes, interactive simulations, an AI teacher and AI "students" who talk and draw on a whiteboard. Next.js + LangGraph, two-stage generation (outline → content per scene). | **The two-stage outline→scenes pattern** is excellent for generating a full lesson. The idea of virtual classmates. | Aimed at generating a lesson from a topic, less at managing a whole semester of personal materials. License reported inconsistently (MIT/AGPL) — verify. |
| **[DeepTutor](https://github.com/HKUDS/DeepTutor)** | HKU (University of Hong Kong) | An "agent-native" framework for personal tutoring: three-layer memory (raw traces → facts per topic → synthesis), RAG, code execution, GeoGebra, paper search, MCP, Guided Learning. Python, Docker, PyPI. | **The learner memory model** and **tool use via MCP** — exactly the direction for an extensible architecture. | Relatively heavy, aimed at researchers/developers, not adapted to Hebrew/RTL or to non-technical students. |
| **[OATutor](https://github.com/CAHLR/OATutor)** | UC Berkeley (CAHL lab) | A classic adaptive tutoring system (ITS) with Bayesian Knowledge Tracing, A/B testing, LTI. MIT. Runs statically on GitHub Pages. | **Knowledge Tracing** — a mastery model per concept. A content structure of questions + hints. The OATutor-GenAI version adds LLM-generated hints. | Hand-authored content (algebra), not generated from the student's own materials. |
| **[UIUC.chat / Illinois Chat](https://github.com/UIUC-Chatbot)** | UIUC (NCSA) | A course chatbot platform trained on course materials, used in real courses (e.g. ECE 220). MIT backend. | **An institutional distribution model** — a whole university on one platform. A crawler for course materials. | Central server (not local), lecturer-focused rather than student-focused, mostly Q&A. |
| **[TheoremExplainAgent](https://github.com/isichan0501/TheoremExplainAgent)** | Waterloo + Vector Institute | A planner agent + a code agent that produce 5+ minute explainer videos in **Manim**. MIT. | **Exactly what "visual explanations"** in math/probability need. The TheoremExplainBench benchmark for evaluation. | QuickStart still "under construction"; video generation is slow and expensive. |
| **[Open TutorAI](https://github.com/Open-TutorAi/open-tutor-ai-CE)** ([paper](https://arxiv.org/abs/2602.07176)) | Academic research (2026) | Onboarding that learns goals and preferences, a personalized assistant, a 3D avatar, learning analytics. | **Onboarding → learner profile**. Analytics for self-regulation. | No independent evaluation; there is an Enterprise edition (open-core). |
| UBC HelpMe / LLM-Course-QA, Warwick AI-TA, UCSD tutor | UBC, Warwick, UCSD | Course teaching assistants | Models for institutional integration | Some are not fully open, lecturer-focused |
| TAU Digital Tutor, Bar-Ilan assistant | Tel Aviv University, Bar-Ilan | Chatbots grounded in course materials | Proof of demand in Israel | No open-source code found |

## 2. Community "open NotebookLM" projects / study tools

| Project | License | What it does | Relevance |
|---|---|---|---|
| **[OpenTutor](https://github.com/zijinz456/OpenTutor)** | To verify | **Closest to our vision.** Self-hosted, local-first: upload PDF/DOCX/PPTX and within ~30 seconds get summaries, flashcards, quizzes, and a tutor with citations. FSRS 4.5, BKT, knowledge graph (experimental), Canvas on the roadmap. Docker. | Study its UX and pipeline flow in detail. A single-developer project — maintenance risk. |
| **[PageLM](https://github.com/CaviraOSS/PageLM)** | ⚠️ CaviraOSS Community License (**not** OSI; no commercial use) | SmartNotes (Cornell), flashcards, quizzes, AI podcast, transcription, homework planner, **ExamLab** (exam simulation), Debate. Node.js. | **A great feature list for inspiration** (ExamLab = the law use case). **Don't copy code** because of the license. |
| **[Open Notebook](https://github.com/lfnovo/open-notebook)** | MIT | A NotebookLM alternative, Python + Next.js, local or cloud models, podcasts. | A good architecture for a "source notebook". A candidate for code reuse thanks to MIT. |
| **[SurfSense](https://github.com/MODSetter/SurfSense)** | Apache-2.0 | A desktop research app with many connectors (Notion, Slack, GitHub). | **The connector model** — relevant for Moodle/Drive. |
| **[Khoj](https://github.com/khoj-ai/khoj)** | ⚠️ AGPL-3.0 | A "second brain": semantic search, agents, automations, Obsidian/WhatsApp. | Ideas for integrations; AGPL requires care with reuse. |
| NoteBotLM, AI Study Mentor, TutorAI, NeuroPilot and others | Various | Small RAG + quiz projects | Demos, not a foundation. |

## 3. Conclusions and the decision

**What everyone does (= commodity, we won't compete here):** upload a PDF → chat with citations → summary → quiz → flashcards.

**What all the projects lack — and this is our unique value:**

1. **Student-focused rather than lecturer-focused, across a whole semester** — a course, an exam on date X, accumulating material, mastery tracking per concept.
2. **Truly multi-disciplinary** — "discipline packs" (CS, math, law, economics, psychology...) with dedicated tools, not just "ask the PDF".
3. **Hebrew from day one** — RTL, Hebrew lecture transcription, multilingual semantic search, mixed Hebrew/English terminology.
4. **A structure that invites contribution** — any student can write one "tool" (plugin) without understanding the whole system. No existing project was built for this.
5. **Pedagogy before answers** — Socratic mode, retrieval practice, spaced repetition — learning, not copying. Also important for academic integrity with the university.
6. **Rich output** — interactive widgets, 3D, Manim — as a built-in part, not an add-on.

**Why not fork?** OpenTutor is the closest, but: (a) it's a single-developer project, (b) it wasn't designed for plugins, (c) it wasn't designed for Hebrew, (d) a fork hands us technical debt we didn't choose. We'll use **libraries** (Docling, LiteLLM, py-fsrs, Manim, faster-whisper) and learn **patterns** (outline→scenes from OpenMAIC, learner memory from DeepTutor, BKT from OATutor, ExamLab from PageLM).

## Sources

- [THU-MAIC/OpenMAIC](https://github.com/THU-MAIC/OpenMAIC) · [HelloGitHub review](https://hellogithub.com/en/repository/THU-MAIC/OpenMAIC) · [DEV review](https://dev.to/brooks_wilson_36fbefbbae4/tsinghua-open-sources-openmaic-one-click-generation-of-multi-agent-ai-classrooms-20fe)
- [HKUDS/DeepTutor](https://github.com/HKUDS/DeepTutor) · [Technical report arXiv 2604.26962](https://arxiv.org/pdf/2604.26962)
- [CAHLR/OATutor](https://github.com/CAHLR/OATutor) · [Berkeley](https://bse.berkeley.edu/leveraging-ai-improve-adaptive-tutoring-systems)
- [UIUC-Chatbot](https://github.com/UIUC-Chatbot) · [NCSA](https://ai.ncsa.illinois.edu/?p=2295)
- [TheoremExplainAgent](https://github.com/isichan0501/TheoremExplainAgent) · [arXiv 2502.19400](https://arxiv.org/abs/2502.19400)
- [Open TutorAI](https://github.com/Open-TutorAi/open-tutor-ai-CE) · [arXiv 2602.07176](https://arxiv.org/abs/2602.07176)
- [OpenTutor](https://github.com/zijinz456/OpenTutor) · [PageLM README](https://raw.githubusercontent.com/CaviraOSS/PageLM/main/README.md) · [PageLM review (Wavect)](https://wavect.io/blog/pagelm-self-hosted-ai-study-platform/)
- [Open Notebook vs Khoj vs SurfSense](https://dev.to/rohit_raj_8c7902b7d37cf21/open-notebook-vs-khoj-vs-surfsense-best-self-hosted-notebooklm-alternative-2026-3g57) · [SurfSense](https://github.com/MODSetter/SurfSense) · [Khoj](https://github.com/khoj-ai/khoj)
- [UBC HelpMe](https://coursehelp.ubc.ca/about) · [Warwick AI-TA](https://warwick.ac.uk/fac/cross_fac/eduport/edufund/projects/yang/projects/ai-ta-towards-an-intelligent-question-answer-teaching-assistant-using-open-source-llms/) · [UCSD](https://today.ucsd.edu/story/this-bespoke-ai-tutor-helps-students-learning)
- [TAU Digital Tutor (MDPI)](https://mdpi.com/2078-2489/16/4/264) · [Bar-Ilan (JPost)](https://jpost.com/brandblend/opening-the-academic-year-bar-ilan-university-launches-ai-based-teaching-assistant-825140)
