# 01 — סקירת שוק: פרויקטים קיימים בקוד פתוח

> נכון לנובמבר 2026. מספרי כוכבים, גרסאות ורישיונות משתנים — **יש לאמת את קובץ ה-LICENSE בכל ריפו לפני שמעתיקים ממנו קוד.**

## TL;DR

1. **אין פרויקט אחד שעושה את מה שאנחנו רוצים** — כלי מקומי, רב-תחומי, בעברית, שנבנה ע"י קהילת סטודנטים של אוניברסיטה אחת ומאפשר לכל סטודנט להוסיף "כלי למידה" חדש בקלות.
2. **יש הרבה חלקים מצוינים** שאפשר ללמוד מהם או להשתמש בהם כספריות: ייבוא מסמכים, RAG, חזרה מרווחת (FSRS), יצירת אנימציות Manim, כיתות מרובות-סוכנים.
3. **ההמלצה:** לבנות ליבה משלנו, דקה ומודולרית, עם **מערכת פלאגינים** כמרכז הפרויקט — ולשאול רעיונות/ספריות מהפרויקטים שלהלן, לא לעשות fork לאחד מהם.

---

## 1. פרויקטים אקדמיים (של אוניברסיטאות / מעבדות מחקר)

| פרויקט | מוסד | מה הוא עושה | מה ללמוד ממנו | מגבלות מבחינתנו |
|---|---|---|---|---|
| **[OpenMAIC](https://github.com/THU-MAIC/OpenMAIC)** | אוניברסיטת צינגחואה | מקבל נושא/חומר ומייצר "כיתה" שלמה: מצגות, חידונים, סימולציות אינטראקטיביות, מורה AI ו"תלמידים" AI שמדברים ומציירים על לוח. Next.js + LangGraph, יצירה דו-שלבית (מתווה → תוכן לכל סצנה). | **התבנית הדו-שלבית outline→scenes** מצוינת ליצירת "לומדה". רעיון של חברי כיתה וירטואליים. | מכוון ליצירת שיעור מנושא, פחות לניהול סמסטר שלם של חומרים אישיים. רישיון מדווח באופן סותר (MIT/AGPL) — לבדוק. |
| **[DeepTutor](https://github.com/HKUDS/DeepTutor)** | HKU (אוניברסיטת הונג קונג) | מסגרת "agent-native" לחונכות אישית: זיכרון תלת-שכבתי (עקבות גולמיות → עובדות לפי נושא → סינתזה), RAG, הרצת קוד, GeoGebra, חיפוש מאמרים, MCP, Guided Learning. Python, Docker, PyPI. | **מודל הזיכרון של הלומד** ו-**שימוש בכלים (tools) דרך MCP** — בדיוק הכיוון לארכיטקטורה הניתנת להרחבה. | כבד יחסית, מכוון חוקרים/מפתחים, לא מותאם לעברית/RTL ולסטודנט לא-טכני. |
| **[OATutor](https://github.com/CAHLR/OATutor)** | UC Berkeley (מעבדת CAHL) | מערכת חונכות אדפטיבית (ITS) קלאסית עם Bayesian Knowledge Tracing, A/B testing, LTI. MIT. רץ סטטית על GitHub Pages. | **Knowledge Tracing** — מודל שליטה לכל מושג. מבנה תוכן של שאלות+רמזים. גרסת OATutor-GenAI מוסיפה יצירת רמזים ב-LLM. | תוכן ידני (אלגברה), לא מחולל מחומרים של הסטודנט. |
| **[UIUC.chat / Illinois Chat](https://github.com/UIUC-Chatbot)** | UIUC (NCSA) | פלטפורמת צ'אטבוט לקורס שמאומנת על חומרי הקורס, משמשת קורסים אמיתיים (למשל ECE 220). backend ב-MIT. | **מודל הפצה ארגוני** — אוניברסיטה שלמה על פלטפורמה אחת. Crawler לחומרי קורס. | שרת מרכזי (לא לוקלי), ממוקד מרצה ולא סטודנט, בעיקר Q&A. |
| **[TheoremExplainAgent](https://github.com/isichan0501/TheoremExplainAgent)** | Waterloo + Vector Institute | סוכן מתכנן + סוכן קוד שמייצרים סרטוני הסבר של 5+ דקות ב-**Manim**. MIT. | **בדיוק מה שצריך ל"הסברים ויזואליים"** במתמטיקה/הסתברות. בנצ'מרק TheoremExplainBench להערכה. | QuickStart עדיין "בבנייה"; יצירת וידאו איטית ויקרה. |
| **[Open TutorAI](https://github.com/Open-TutorAi/open-tutor-ai-CE)** ([מאמר](https://arxiv.org/abs/2602.07176)) | מחקר אקדמי (2026) | אונבורדינג שלומד מטרות והעדפות, עוזר מותאם אישית, אווטאר תלת-ממדי, learning analytics. | **אונבורדינג → פרופיל לומד**. אנליטיקה לוויסות עצמי. | אין הערכה בלתי-תלויה; יש גרסת Enterprise (open-core). |
| UBC HelpMe / LLM-Course-QA, Warwick AI-TA, UCSD tutor | UBC, Warwick, UCSD | עוזרי הוראה לקורסים | מודלים לשילוב במוסד | חלקם לא פתוחים במלואם, ממוקדי מרצה |
| TAU Digital Tutor, עוזר בר-אילן | ת"א, בר-אילן | צ'אטבוטים מעוגנים בחומרי קורס | הוכחה שיש ביקוש בישראל | לא נמצא קוד פתוח |

## 2. פרויקטים קהילתיים "NotebookLM פתוח" / כלי לימוד

| פרויקט | רישיון | מה הוא עושה | רלוונטיות |
|---|---|---|---|
| **[OpenTutor](https://github.com/zijinz456/OpenTutor)** | לבדוק | **הכי קרוב לחזון שלנו.** Self-hosted, local-first: מעלים PDF/DOCX/PPTX ומקבלים תוך ~30 שניות סיכומים, כרטיסיות, חידונים וטוטור עם ציטוטים. FSRS 4.5, BKT, גרף ידע (ניסיוני), Canvas ב-roadmap. Docker. | לימוד מפורט של ה-UX וזרימת ה-pipeline. פרויקט של מפתח יחיד — סיכון תחזוקה. |
| **[PageLM](https://github.com/CaviraOSS/PageLM)** | ⚠️ CaviraOSS Community License (**לא** OSI; אסור מסחרי) | SmartNotes (Cornell), כרטיסיות, חידונים, פודקאסט AI, תמלול, מתכנן שיעורי בית, **ExamLab** (סימולציית מבחן), Debate. Node.js. | **רשימת פיצ'רים מצוינת להשראה** (ExamLab = מקרה המשפטים שלך). **לא להעתיק קוד** בגלל הרישיון. |
| **[Open Notebook](https://github.com/lfnovo/open-notebook)** | MIT | חלופה ל-NotebookLM, Python + Next.js, מודלים מקומיים או בענן, פודקאסטים. | ארכיטקטורה טובה ל"מחברת מקורות". מועמד לשימוש-חוזר בקוד בזכות MIT. |
| **[SurfSense](https://github.com/MODSetter/SurfSense)** | Apache-2.0 | אפליקציית מחקר דסקטופ, הרבה קונקטורים (Notion, Slack, GitHub). | **מודל הקונקטורים** — רלוונטי ל-Moodle/Drive. |
| **[Khoj](https://github.com/khoj-ai/khoj)** | ⚠️ AGPL-3.0 | "מוח שני": חיפוש סמנטי, סוכנים, אוטומציות, Obsidian/WhatsApp. | רעיונות לאינטגרציות; AGPL מחייב זהירות בשימוש-חוזר. |
| NoteBotLM, AI Study Mentor, TutorAI, NeuroPilot ועוד | שונים | פרויקטי RAG + חידונים קטנים | הדגמות, לא בסיס. |

## 3. מסקנות וההחלטה

**מה כולם עושים (= commodity, לא נתחרה כאן):** העלאת PDF → צ'אט עם ציטוטים → סיכום → חידון → כרטיסיות.

**מה חסר בכל הפרויקטים — וזה הערך הייחודי שלנו:**

1. **ממוקד סטודנט ולא מרצה, ולאורך סמסטר שלם** — קורס, מבחן בתאריך X, חומר שמצטבר, מעקב שליטה לפי מושג.
2. **רב-תחומי באמת** — "חבילות תחום" (CS, מתמטיקה, משפטים, כלכלה, פסיכולוגיה...) עם כלים ייעודיים, לא רק "שאל את ה-PDF".
3. **עברית מהיום הראשון** — RTL, תמלול הרצאות בעברית, חיפוש סמנטי רב-לשוני, מונחים מעורבים עברית/אנגלית.
4. **מבנה שמזמין תרומה** — כל סטודנט יכול לכתוב "כלי" (plugin) אחד בלי להבין את כל המערכת. אף פרויקט קיים לא נבנה לזה.
5. **פדגוגיה לפני תשובות** — מצב סוקרטי, תרגול אחזור (retrieval practice), חזרה מרווחת — למידה ולא העתקה. חשוב גם מבחינת טוהר אקדמי מול האוניברסיטה.
6. **פלט עשיר** — ווידג'טים אינטראקטיביים, תלת-ממד, Manim — כחלק מובנה, לא תוספת.

**למה לא fork?** OpenTutor הוא הקרוב ביותר, אבל: (א) פרויקט של מפתח יחיד, (ב) לא תוכנן לפלאגינים, (ג) לא תוכנן לעברית, (ד) fork מעביר לנו חוב טכני שלא בחרנו. נשתמש ב**ספריות** (Docling, LiteLLM, py-fsrs, Manim, faster-whisper) ונלמד **דפוסים** (outline→scenes מ-OpenMAIC, זיכרון לומד מ-DeepTutor, BKT מ-OATutor, ExamLab מ-PageLM).

## מקורות

- [THU-MAIC/OpenMAIC](https://github.com/THU-MAIC/OpenMAIC) · [סקירה ב-HelloGitHub](https://hellogithub.com/en/repository/THU-MAIC/OpenMAIC) · [סקירה ב-DEV](https://dev.to/brooks_wilson_36fbefbbae4/tsinghua-open-sources-openmaic-one-click-generation-of-multi-agent-ai-classrooms-20fe)
- [HKUDS/DeepTutor](https://github.com/HKUDS/DeepTutor) · [דו"ח טכני arXiv 2604.26962](https://arxiv.org/pdf/2604.26962)
- [CAHLR/OATutor](https://github.com/CAHLR/OATutor) · [Berkeley](https://bse.berkeley.edu/leveraging-ai-improve-adaptive-tutoring-systems)
- [UIUC-Chatbot](https://github.com/UIUC-Chatbot) · [NCSA](https://ai.ncsa.illinois.edu/?p=2295)
- [TheoremExplainAgent](https://github.com/isichan0501/TheoremExplainAgent) · [arXiv 2502.19400](https://arxiv.org/abs/2502.19400)
- [Open TutorAI](https://github.com/Open-TutorAi/open-tutor-ai-CE) · [arXiv 2602.07176](https://arxiv.org/abs/2602.07176)
- [OpenTutor](https://github.com/zijinz456/OpenTutor) · [PageLM README](https://raw.githubusercontent.com/CaviraOSS/PageLM/main/README.md) · [PageLM review (Wavect)](https://wavect.io/blog/pagelm-self-hosted-ai-study-platform/)
- [Open Notebook vs Khoj vs SurfSense](https://dev.to/rohit_raj_8c7902b7d37cf21/open-notebook-vs-khoj-vs-surfsense-best-self-hosted-notebooklm-alternative-2026-3g57) · [SurfSense](https://github.com/MODSetter/SurfSense) · [Khoj](https://github.com/khoj-ai/khoj)
- [UBC HelpMe](https://coursehelp.ubc.ca/about) · [Warwick AI-TA](https://warwick.ac.uk/fac/cross_fac/eduport/edufund/projects/yang/projects/ai-ta-towards-an-intelligent-question-answer-teaching-assistant-using-open-source-llms/) · [UCSD](https://today.ucsd.edu/story/this-bespoke-ai-tutor-helps-students-learning)
- [TAU Digital Tutor (MDPI)](https://mdpi.com/2078-2489/16/4/264) · [Bar-Ilan (JPost)](https://jpost.com/brandblend/opening-the-academic-year-bar-ilan-university-launches-ai-based-teaching-assistant-825140)
