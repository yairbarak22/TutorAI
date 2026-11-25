# כתיבת כלי (Plugin) — המדריך המלא

כל כלי ב-RuecAI Teacher הוא **תיקייה אחת** תחת `plugins/<pack>/<tool-id>/`. הליבה מוצאת אותה אוטומטית ומוסיפה אותה ללשונית "כלים". אין קוד רישום.

יש שני סוגים:

| | כלי הצהרתי (`declarative`) | כלי קוד (`code`) |
|---|---|---|
| מה כותבים | `plugin.yaml` + `prompt.he.md` | `plugin.yaml` + `index.ts` |
| מתאים ל | רוב הכלים: סיכום, שאלות, ניתוח מקרה, תרגיל | לוגיקה של כמה שלבים, חישובים, שיחה |
| צריך לדעת לתכנת? | **לא** | TypeScript בסיסי |
| דוגמאות | `core/summary`, `law/case-brief`, `math/worked-example` | `core/tutor`, `core/exam-from-samples`, `core/study-plan`, `core/explainer` |

---

## כלי הצהרתי ב-30 דקות: דוגמה מלאה

נבנה כלי למשפטים: **"השוואת פסקי דין"**.

### 1. `plugins/law/compare-rulings/plugin.yaml`

```yaml
id: compare-rulings            # חייב להיות זהה לשם התיקייה
name: השוואת פסקי דין
description: טבלת השוואה בין שני פסקי דין — עובדות, הלכה, נימוקים ומה ההבדל ביניהם.
icon: "⚖️"
pack: law
kind: declarative
output: markdown_doc           # סוג התוצר (רשימה בהמשך)
tier: smart                    # smart = מודל חכם, fast = מהיר וזול
disciplines: [law]
inputs:                        # השדות שהסטודנט ממלא
  - { name: first, label: "פסק דין ראשון", type: text, required: true }
  - { name: second, label: "פסק דין שני", type: text, required: true }
retrieval:
  mode: search                 # scope | search | samples | none
  query: "{{params.first}} {{params.second}}"
authors: [השם שלכם]
```

### 2. `plugins/law/compare-rulings/prompt.he.md`

```markdown
השווה בין פסק הדין "{{params.first}}" לבין "{{params.second}}" כפי שהם מופיעים בחומר הקורס "{{course.name}}".

סעיפים:
1. "טבלת השוואה" — טבלת Markdown: עובדות | שאלה משפטית | הלכה | נימוק מרכזי.
2. "מה ההבדל המהותי" — 3–5 נקודות.
3. "איך זה ישמש אותי בבחינה" — מתי להפנות לכל אחד מהם.

כל סעיף עם citations. אם אחד מפסקי הדין לא מופיע בחומר — אמור זאת במפורש.
```

**משתנים זמינים בתבנית:**
- `{{course.name}}`, `{{course.examDate}}`
- `{{params.<name>}}`, הערכים שהסטודנט מילא
- `{{concepts}}`, רשימת מושגי הקורס (כדי שהמודל ישתמש בשמות הנכונים)
- `{{today}}`
- `{{#if params.x}}…{{/if}}`, טקסט שמופיע רק כשהשדה לא ריק

משתנה שלא קיים מפיל את הבדיקות, כך ששגיאת כתיב נתפסת מיד.

אין צורך לכתוב בפרומפט את כללי הציטוט, העברית או הפדגוגיה. הליבה מוסיפה אותם לכל כלי (`BASE_SYSTEM_PROMPT` ב-`packages/core/src/llm/prompts.ts`). גם חומר הקורס נשלח אוטומטית, לפי `retrieval`.

### 3. בדיקות איכות: `evals/eval.yaml`

```yaml
fixture: law                 # קורס לדוגמה מ-plugins/_fixtures/ (probability | law)
params: { first: "קל בנין", second: "..." }
checks:
  min_items: 3               # לפחות 3 סעיפים
  min_citation_coverage: 0.8 # 80% מהסעיפים עם ציטוט תקין
  min_hebrew_ratio: 0.7
  must_mention: [הלכה]
  judge: "האם ההשוואה מדויקת ומבוססת על החומר?"   # לבדיקה החיה עם מודל אמיתי
```

### 4. דוגמת פלט: `evals/golden.json`

פלט אחד טוב, בפורמט של סוג התוצר. המפתח הוא ה-id של הכלי. הציטוטים נכתבים כ-`S1`, `S2`…, ומערכת הבדיקות ממפה אותם לקטעים אמיתיים.

```json
{ "compare-rulings": { "title": "...", "sections": [ { "heading": "...", "markdown": "...", "citations": ["S1"] } ] } }
```

ה-golden משמש לשלושה דברים: ל-CI (בלי עלות), ל**מצב הדגמה** באפליקציה, ולבדיקות הדפדפן.

### 5. בדיקה

```bash
npm test          # בודק שהכלי נטען, שהפרומפט מתרנדר, ושהפלט עובר את כל הבדיקות
npm run dev       # הכלי מופיע בלשונית "כלים"
ANTHROPIC_API_KEY=sk-ant-... npm run eval:live   # (לא חובה) מול המודל האמיתי
```

---

## סוגי תוצרים (`output`)

הממשק כבר יודע להציג את כולם. הסכמות המלאות נמצאות ב-`packages/sdk/src/artifacts.ts`.

| `output` | מה זה | מוצג כ |
|---|---|---|
| `markdown_doc` | `title` + `sections[]` (heading, markdown, citations) | מסמך עם נוסחאות וציטוטים |
| `quiz` | שאלות `mcq` / `open` עם הסבר, מושג וציטוטים | חידון אינטראקטיבי שמעדכן שליטה |
| `flashcards` | `cards[]` (front/back/concept) | נכנס אוטומטית לחזרה המרווחת |
| `diagram` | Mermaid + הסבר | תרשים |
| `exam_simulation` | שאלות עם `points`, `rubric`, `model_answer` | מבחן עם טיימר ובדיקה לפי מחוון |
| `study_plan` | ימים ומשימות | תוכנית לימוד |
| `interactive_widget` | מסמך HTML עצמאי | iframe מבודד (בלי רשת, בלי גישה לנתונים) |
| `concept_map` | מושגים ודרישות קדם | (שמור לשימוש עתידי) |
| `chat` | שמור לטוטור | מסך שיחה |

## שדות קלט (`inputs[].type`)

`text` · `textarea` · `number` · `select` (עם `options`) · `concept` (בחירה מתוך מושגי הקורס) · `source` (בחירת קובץ, או "כל החומרים")

## `retrieval.mode`

| mode | מה נשלח למודל |
|---|---|
| `scope` | כל חומר הלימוד (או הקובץ שנבחר בשדה `source`) |
| `search` | כמו scope. אם הקורס גדול מהתקציב, נבחרים הקטעים הרלוונטיים ל-`query` ול-`concept` |
| `samples` | רק קבצים שסומנו "מבחן לדוגמה" |
| `none` | כלום (למשל תוכנית לימוד שמחושבת בלי מודל) |

---

## כלי קוד (TypeScript)

`plugin.yaml` עם `kind: code`, וקובץ `index.ts`:

```ts
import { defineTool, Quiz } from "@ruecai/sdk";

export default defineTool<"quiz">({
  async run(ctx) {
    ctx.progress(0.1, "אוסף חומר…");
    const material = await ctx.retrieve({ concept: String(ctx.params.concept) });
    const quiz = await ctx.llm.object(Quiz, {
      system: ctx.baseSystemPrompt,
      context: material.text,          // נשלח כ-system block שנשמר ב-cache
      prompt: "צור 5 שאלות טריקיות על…",
      tier: "smart",
      tag: "my-tool",                  // מפתח ב-golden.json
    });
    return { type: "quiz", title: quiz.title, data: quiz };
  },
});
```

### מה יש ב-`ctx`

| | |
|---|---|
| `ctx.course` | `{ id, name, examDate }` |
| `ctx.params` | ערכי השדות |
| `ctx.retrieve(opts)` | `{ text, sections, truncated }`: חומר מעוצב עם מזהי קטעים |
| `ctx.concepts()` | מושגים עם `mastery` (0–1), `attempts`, `prerequisites` |
| `ctx.llm.object(schema, opts)` | פלט מובנה לפי סכמת Zod |
| `ctx.llm.text(opts)` / `ctx.llm.stream(opts, onDelta)` | טקסט חופשי / סטרימינג |
| `ctx.progress(pct, msg)` | עדכון פס ההתקדמות |
| `ctx.baseSystemPrompt` | הכללים המשותפים (עברית, ציטוטים, פדגוגיה, טוהר אקדמי) |
| `ctx.today` | התאריך (ניתן להזרקה בבדיקות) |
| `ctx.chat` | רק לכלי `output: chat`: `{ history, message, onDelta }` |

אחרי `run`, הליבה מאמתת את הפלט מול הסכמה, מוחקת ציטוטים שלא קיימים בהקשר, שומרת את התוצר ב-`ruecai.db`, ויוצרת כרטיסיות אם צריך.

**`repair(ctx, artifact, error)`** (לא חובה): נקרא כשתוצר נכשל ברנדור, למשל ווידג'ט עם שגיאת JavaScript. ראו `core/explainer`.

## כללים

- `id` ייחודי וזהה לשם התיקייה (אותיות קטנות, מספרים ומקפים).
- כלי קוד מייבא רק מ-`@ruecai/sdk`, `zod` ומקבצים בתוך התיקייה שלו.
- בלי `fetch` לשירותים חיצוניים. אם צריך, פותחים RFC.
- חבילת תחום חדשה (`plugins/economics/` למשל) = תיקייה חדשה, ומוסיפים את עצמכם ל-CODEOWNERS.

## גרסאות SDK

ה-SDK מנוהל בגרסאות סמנטיות. `sdk: "^0.1"` ב-plugin.yaml מצהיר על התאימות. שינוי שובר ב-SDK מעלה את הגרסה ומעדכן את כל הכלים באותו PR.
