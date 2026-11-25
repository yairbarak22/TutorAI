# 02 — ארכיטקטורה

> גרסה 2: עברנו ל-**TypeScript בלבד ול-local-first בדפדפן**. הנימוקים המלאים בהחלטה על ההפצה: [04-distribution.md](04-distribution.md).

## עקרונות מנחים

1. **Local-first.** החומרים, התוצרים ומודל הלומד נשמרים אצל הסטודנט. אין שרת של הפרויקט שמחזיק נתונים.
2. **אפס התקנה.** פותחים קישור ועובדים. אפליקציית דסקטופ היא תוספת, לא תנאי.
3. **שפה אחת: TypeScript.** אותו קוד רץ בדפדפן וב-Electron. תורם צריך להכיר עולם אחד.
4. **ליבה קטנה, פלאגינים גדולים.** רוב הכלים צריכים להיות **הצהרתיים** (YAML + פרומפט + סכמה), כך שגם מי שלא מתכנת יכול לתרום.
5. **פלט מובנה.** כל כלי מחזיר אובייקט שמוגדר בסכמת Zod. הממשק יודע להציג אותו, והבדיקות יודעות לבדוק אותו.
6. **כל טענה מעוגנת במקור**, עם ציטוט לעמוד, לשקף או לדקה בהרצאה.
7. **עברית ראשונה ופדגוגיה ראשונה.** RTL, מונחים מעורבים, ומצב ברירת מחדל של "עזור לי ללמוד" ולא "תן לי תשובה".

## תמונה כללית

```
┌──────────────────────────── הדפדפן של הסטודנט (או Electron) ─────────────────────────────┐
│                                                                                       │
│  UI — React + TS (RTL)                                                                │
│   Courses · Library · Tutor · Studio · Review · Exam Mode                             │
│   Renderers: Markdown+KaTeX │ Quiz │ Flashcards │ Mermaid │ Widget (sandboxed iframe)  │
│              3D (three.js) │ Study plan │ Exam                                        │
│        │                                                                              │
│  core (TS טהור, רץ ב-Web Worker)                                                      │
│   Ingestion ─► Course Index ─► Tool Runtime (plugins) ─► Artifacts ─► Learner Model    │
│                     │                 │                                               │
│                 Retrieval        LLM Gateway (Vercel AI SDK)                           │
│        │                                                                              │
│  platform-web:  SQLite-WASM → ~/Documents/RuecAI/ruecai.db · Workers · Pyodide (SymPy)  │
└───────────────────────────────────────┬───────────────────────────────────────────────┘
                                        │ HTTPS ישיר, עם המפתח של הסטודנט
                                        ▼
              Anthropic / OpenAI / Google   (או Ollama ב-localhost, או proxy אוניברסיטאי)

   האתר עצמו: קבצים סטטיים ב-Cloudflare Pages. אין backend.
```

## בחירות טכנולוגיות

| שכבה | בחירה | נימוק |
|---|---|---|
| שפה וכלי פיתוח | **TypeScript, pnpm workspaces, Turborepo, Vite** | monorepo מהיר. כל סטודנט למדמ"ח מכיר. |
| UI | **React, Tailwind, shadcn/ui** (עם RTL), TanStack Router/Query | אקוסיסטם הכי גדול, RTL נתמך היטב |
| מצב ו-DB | **SQLite-WASM** דרך **Drizzle ORM**. הקובץ `ruecai.db` נשמר **בתיקייה מקומית רגילה** שהסטודנט בוחר (File System Access API, ב-Chrome/Edge), ובשאר הדפדפנים ב-OPFS. | SQL אמיתי, קובץ שהסטודנט רואה ומגבה. אותה תיקייה תעבוד גם מ-Electron. פירוט: [04-distribution.md](04-distribution.md#איפה-הנתונים-נשמרים-תיקייה-מקומית-רגילה). |
| קבצי מקור | קבצים רגילים בתיקיית הקורס (`courses/<course>/sources/`) | נשארים מקומית, אין העלאה לשרת |
| LLM | **Vercel AI SDK** (`ai`) עם providers ל-Anthropic, OpenAI, Google ו-Ollama | `generateObject` עם סכמת Zod, streaming, tool calling, ממשק אחיד לכל הספקים |
| סכמות | **Zod** | אותה סכמה משמשת ל-LLM output, ל-DB ול-UI |
| קריאת מסמכים | **pdf.js** לטקסט ולמבנה, ושליחת ה-PDF עצמו ל-LLM כשיש נוסחאות או תמונות. **PPTX/DOCX**: קבצי ZIP+XML, מפורקים ב-JS (למשל JSZip). | בלי Python ובלי ML מקומי |
| חיפוש | **אינדקס מבני** (קורס ← הרצאה ← סעיף ← מושג), **BM25** (MiniSearch), ו**הקשר ארוך עם prompt caching** | בקורס של עד ~300K טוקנים זה עדיף על RAG וקטורי ופשוט ממנו. האמבדינגס נשארים אופציה מאחורי `retrieve()`. |
| חזרה מרווחת | **ts-fsrs** | |
| אימות מתמטי | **Pyodide + SymPy** ב-Web Worker (נטען רק כשצריך) | מאמת תשובות לתרגילים שנוצרו |
| ויזואליזציה | **Mermaid**, **three.js / react-three-fiber**, KaTeX, ווידג'טים ב-HTML/JS ב-iframe מבודד | |
| תמלול | שלב ראשון: API תמלול. בגרסת דסקטופ: whisper.cpp עם מודלי ivrit.ai. | |
| בדיקות | **Vitest**, **Playwright** (E2E) ו-evals ייעודיים | |
| הפצה | Cloudflare Pages (preview לכל PR), PWA manifest + service worker | |

## מודל הנתונים (ליבה)

```
Course ─┬─< Source (pdf | slides | doc | recording | sample_exam | link | note)
        │      └─< Section (title, text_md, anchor: page/slide/timestamp, tokens)
        ├─< Concept (name_he, name_en, definition, prereqs → Concept)        ← גרף ידע
        │      └── ConceptSection (איפה המושג מופיע)
        ├─< Artifact (tool_id, type, schema_version, json, citations[], created_at)
        ├─< Exam (date, scope: Concept[], format, sample_sources[])
        └─< StudyPlan (sessions[])

Learner ─┬─< Mastery (concept_id, p_known [BKT], last_seen)
         ├─< Card (FSRS state, artifact_id, concept_id)
         └─< Attempt (item_id, answer, correct, feedback, at)
```

**`Concept` הוא הלב של המודל.** כל שאלה, כרטיסייה ותוצר מתויגים במושג. כך המערכת יודעת במה הסטודנט חלש ובונה תוכנית לימוד לפי סדר הקדם-דרישות.

## צינורות עיבוד

### Ingestion (רץ ב-Web Worker, עם checkpoints)
```
file ─► hash (dedupe) ─► parse:
          pdf  → pdf.js text+layout; דפים "דלים" (נוסחאות/תמונות) → LLM vision
          pptx → XML של כל שקף + notes; שקפים עם תמונות → LLM vision
          docx → XML → markdown
          audio/video → transcription (API) → segments עם timestamps
     ─► normalize ל-Markdown עם anchors ─► split ל-Sections (לפי שקף/כותרת/קטע)
     ─► LLM (fast tier): כותרת + תקציר לכל Section, וחילוץ מושגים
     ─► merge לגרף המושגים של הקורס ─► BM25 index
```
כל שלב נשמר. אם הטאב נסגר, העבודה ממשיכה מאותה נקודה בפתיחה הבאה.

### Retrieval: `ctx.retrieve(query, {concepts, sources, budget})`
1. סינון לפי מושגים ומקורות, וחיפוש BM25 על Sections.
2. אם החומר הרלוונטי קטן מתקציב הטוקנים, מחזירים **את כל ה-Sections הרלוונטיים במלואם**.
3. אם הוא גדול מדי, ה-LLM בוחר Sections לפי התקצירים (שלב בחירה זול).
4. ההקשר נבנה בסדר קבוע (קורס ← הרצאה ← סעיף) כדי לנצל prompt caching.

### Generation (דרך Tool Runtime)
```
request ─► tool.plan ─► retrieve ─► generateObject(schema) ─► Zod validate
        ─► grounding check (כל טענה ↔ citation קיים) ─► Artifact
```
ליצירות ארוכות, כמו לומדה שלמה, משתמשים בדפוס **outline ← sections**: הסטודנט מאשר או עורך את המתווה, ואז נוצר כל חלק.

## מערכת הפלאגינים — לב הפרויקט

### שני סוגי פלאגינים

**1. פלאגין הצהרתי (בלי קוד). מיועד לרוב התורמים, כולל סטודנטים למשפטים.**
```
plugins/law/case-brief/
  plugin.yaml        # id, name_he, disciplines, inputs, output: case_brief, model_tier: smart
  prompt.he.md       # תבנית פרומפט (Handlebars) עם {{sources}}, {{concepts}}, {{params}}
  examples/          # דוגמאות few-shot
  evals/             # מקרי בדיקה וקריטריונים
  README.md
```
הליבה כבר יודעת להריץ פלאגין כזה: retrieve ← prompt ← generateObject לפי סוג הפלט ← רנדור.

**2. פלאגין קוד (TS). מיועד ללוגיקה מורכבת.**
```
plugins/math/exercise-generator/
  plugin.yaml
  index.ts           # export default defineTool({ schema, async run(ctx, params) { ... } })
  Renderer.tsx       # אופציונלי, רנדרר ייעודי
  evals/
```

### ה-SDK (`@ruecai/sdk`) שהליבה חושפת דרך `ctx`
- `ctx.retrieve(query, opts)` ו-`ctx.cite(section)`
- `ctx.llm.object(schema, prompt, {tier: "fast" | "smart"})`, `ctx.llm.text(...)`, `ctx.llm.stream(...)`
- `ctx.course`, `ctx.concepts`, `ctx.learner.mastery(conceptId)`
- `ctx.progress(pct, msg)`, `ctx.checkpoint(key, value)`
- `ctx.python(code)` (Pyodide), `ctx.capabilities` (למשל `transcribe-local` קיים רק בדסקטופ)

### סוגי תוצרים מובנים (בלי לכתוב UI)
`markdown_doc` · `quiz` · `flashcards` · `diagram` · `interactive_widget` · `scene_3d` · `study_plan` · `exam_simulation` · `case_brief` · `worked_solution`

### בטיחות
- ווידג'טים ותלת-ממד שה-LLM כתב רצים ב-`<iframe sandbox="allow-scripts">` (בלי `allow-same-origin`), עם CSP `connect-src 'none'`, וספריות מותרות בלבד (three.js ו-d3, מוגשות מקומית).
- אם הרנדור נכשל, השגיאה נשלחת ל-LLM לתיקון, עד 2 ניסיונות.
- פלאגיני קוד עוברים code review של CODEOWNERS. פלאגינים הצהרתיים לא מריצים קוד בכלל.

### חבילות תחום (Discipline Packs)

| חבילה | דוגמאות |
|---|---|
| **ליבה** | סיכום, טוטור סוקרטי, חידון, כרטיסיות, מפת מושגים, תוכנית לימוד למבחן |
| **מתמטיקה והסתברות** | פתרון צעד-אחר-צעד עם רמזים, סימולציות אינטראקטיביות (קוביות, התפלגויות, חוק המספרים הגדולים), מחולל תרגילים עם אימות ב-SymPy |
| **מדעי המחשב** | הדמיית אלגוריתמים, trace של קוד, שאלות סיבוכיות |
| **משפטים** | מבחן חדש ממבחנים לדוגמה (issue-spotting), תקצירי פסקי דין (FIRAC), בדיקה לפי מחוון |
| **כלכלה וניהול** | גרפי היצע וביקוש אינטראקטיביים, מקרי בוחן |
| **פסיכולוגיה ומדעי החברה** | שיטות מחקר, טבלאות השוואה בין תיאוריות |

## Tutor Agent

סוכן שיחה שהפלאגינים הם ה-tools שלו (tool calling ב-AI SDK). למשל: "תסביר לי בייס ותבחן אותי" ← retrieve ← הסבר מעוגן ← הפעלת `quiz` על המושג.
**מצבים:** סוקרטי (ברירת מחדל), הסבר ישיר, בוחן, "תסביר לי כמו לילד בן 12".

## מודל הלומד
- **שליטה לפי מושג:** BKT שמתעדכן מכל Attempt.
- **כרטיסיות:** FSRS.
- **תוכנית לימוד:** תאריך מבחן + היקף + שליטה ← לוח זמנים יומי שמעדיף מושגים חלשים ובסיסיים.

## LLM Gateway
- **Tiers:** `fast` (חילוץ, תקצירים, כרטיסיות) ו-`smart` (הסברים, מבחנים, קוד). הסטודנט ממפה כל tier למודל.
- **ספקים:** מפתח אישי, Ollama ב-localhost, או בעתיד proxy אוניברסיטאי (Cloudflare Worker עם SSO ומכסות).
- **מעקב עלויות** לכל פעולה, והערכת עלות לפני פעולות יקרות.
- **Prompt caching** על הקשר הקורס.

## איכות: Evals
- כל פלאגין מגיע עם `evals/`: חומר קלט קטן וקריטריונים (סכמה תקינה, ציטוטים נכונים, תשובה נכונה אחת, עברית תקינה).
- `pnpm eval <plugin>` רץ מקומית. ב-CI הוא רץ על מודל זול עם מפתח של הפרויקט.
- LLM-as-judge בודק עיגון.
- **פלאגין לא נכנס לפרויקט בלי evals שעוברים.**

## מבנה הריפו

```
RuecAI_Teacher/
  apps/
    web/                  # React app, ה-PWA (נפרס ל-Cloudflare Pages)
    desktop/              # Electron (שלב מאוחר)
  packages/
    core/                 # domain, ingestion, retrieval, tool runtime, learner
    sdk/                  # @ruecai/sdk: defineTool, types, ctx
    platform/             # interfaces
    platform-web/         # OPFS, sqlite-wasm, workers, pyodide
    platform-desktop/     # (שלב מאוחר)
    ui/                   # רנדררים ורכיבים משותפים
    evals/                # תשתית הערכה
  plugins/
    core/  math/  cs/  law/  ...
  docs/
  .github/                # CODEOWNERS, templates, CI
```

## פרטיות, זכויות יוצרים וטוהר אקדמי
- חומרי הרצאות שייכים למרצים. **אין שיתוף חומרים בין סטודנטים**, והמערכת גם לא יכולה לשתף, כי אין שרת.
- אין טלמטריה כברירת מחדל.
- מצב "מטלה מוגשת": הכלי מנחה ולא פותר. כדאי לתאם מדיניות עם האוניברסיטה.
- רישיון: **Apache-2.0**. לא להעתיק קוד מ-PageLM (רישיון לא פתוח) או מ-Khoj (AGPL).
