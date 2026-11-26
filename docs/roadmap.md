# Roadmap

Every step ends with something a real student uses through the link.

## Next: student pilot

- Choose one course and get the lecturer's permission to use its materials
- Recruit 10–20 students and run a short onboarding session
- Measure: return rate to today's session without reminders, mastery change per concept, cost per active student (Claude vs. local model), and qualitative feedback
- Decide how students get model access for the pilot: personal keys, local models, or a university-funded key
- Agree on an academic-integrity policy with the university

## Then

- **Lecture recordings:** transcription with timestamps, and citations by lecture minute
- **University access without personal keys:** a thin proxy (for example a Cloudflare Worker) with university login and quotas
- **More discipline packs** (computer science, economics, psychology), each with an owner from its faculty
- **A tool gallery** in the app, filtered by course
- **Pedagogy evals:** LLM-judge checks such as "does not give away the answer" and "fits the course level"
- **Moodle integration** for importing course materials

## Only if the pilot shows a need

- A desktop app (Electron, same code) for long background work and fully local transcription
