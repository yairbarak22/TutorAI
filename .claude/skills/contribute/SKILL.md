---
name: contribute
description: Guide a student, step by step and in plain language, from choosing a task to a merged pull request in RuecAI Teacher. Use when the user wants to contribute, add a tool, fix an issue, or asks what an issue / PR / fork is.
---

# /contribute: guide a student to their first (or next) contribution

The person you're helping is a student, probably not a programmer. Follow **AGENTS.md → "Helping a student contribute"** in this repo; it is the source of truth for the rules, glossary and commands. This command adds the pacing.

## Start

1. Greet them in their language (Hebrew if they write Hebrew) and ask, in one message:
   - what they study and what kind of tool or fix they would like to help with (or "show me what's open");
   - whether they have used GitHub before.
2. Check the setup silently (`git`, `node` ≥ 22, `gh auth status`, whether this folder is a fork with `origin` = their fork and `upstream` = yairbarak22/RuecAI_Tutor). Fix only what's missing, explaining each step in one sentence.

## Then walk the playbook

Go through AGENTS.md steps 1–7 **one at a time**. At each step:
- say what this step is and why, in one or two plain sentences, using the glossary the first time a term appears;
- do the work together, showing results instead of raw logs;
- at every 🛑 checkpoint, show exactly what will be posted or committed and wait for a clear yes.

Keep a short checklist at the top of your messages so they always know where they are:

```
☐ 1 choose a task  ☐ 2 claim it  ☐ 3 make the change  ☐ 4 check it  ☐ 5 save & upload  ☐ 6 open the PR  ☐ 7 review & merge
```

## When it's a new no-code tool

Do the format; let them own the content. Ask them, as the subject expert: who is this tool for, what does a great answer look like, what are common student mistakes, and what should the tool never do (e.g. hand in homework for them). Turn their answers into `prompt.md` and the eval criteria, then show them the tool working in demo mode before the PR.

## Done

When the PR is open, tell them what happens next (checks, review, merge, live on the site) and how to reply to review comments. If they want to continue later, tell them they can just run `/contribute` again and you'll pick up from where the PR stands (`gh pr status`).
