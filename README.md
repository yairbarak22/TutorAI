# RuecAI Teacher 🎓

**עוזר לימודים מבוסס AI, בקוד פתוח, לסטודנטים של אוניברסיטת רייכמן.** פותחים קישור ומתחילים לעבוד: בלי התקנה, בלי שרת, והחומרים לא עוזבים את המחשב.

**👉 [לפתוח את האפליקציה](https://yairbarak22.github.io/RuecAI_Tutor/)**

מעלים את חומרי הקורס (PDF, מצגות, Word, מבחנים לדוגמה) ומקבלים:

| | |
|---|---|
| 🗺️ **מפת מושגים** | המושגים של הקורס ודרישות הקדם ביניהם, צבועים לפי רמת השליטה שלכם |
| 📝 **סיכומים** | כל טענה עם ציטוט; לחיצה פותחת את העמוד או השקף המקורי |
| 🎓 **טוטור סוקרטי** | שואל, מכוון ומצטט את החומר. אפשר גם הסבר ישיר או "בחן אותי" |
| ❓ **חידונים** | שאלות אמריקאיות ופתוחות עם משוב, שמעדכנות את מעקב השליטה |
| 🃏 **כרטיסיות** | חזרה מרווחת (FSRS) שמתזמנת כל כרטיסיה לפני שתשכחו |
| 📝 **מבחן מתוך מבחנים לדוגמה** | לומד את הסגנון, בונה מבחן חדש עם מחוון, ובודק את התשובות |
| 📅 **תוכנית לימוד** | לו"ז יומי עד המבחן לפי מה שאתם יודעים ומה עוד לא |
| 🧪 **הסברים אינטראקטיביים** | סימולציות ותרשימים שרצים בסביבה מבודדת |

## איך זה עובד

- **אתר local-first**: הכול רץ בדפדפן. הנתונים נשמרים בתיקייה שאתם בוחרים (`ruecai.db` + הקבצים) ב-Chrome/Edge, או באחסון הדפדפן ב-Safari/Firefox.
- **AI**: Claude של Anthropic, עם מפתח API אישי שנשמר רק בדפדפן שלכם. בלי מפתח אפשר לנסות **מצב הדגמה**.
- **כלים = תוספים**: כל כלי הוא תיקייה ב-[`plugins/`](plugins). אפשר לכתוב כלי חדש **בלי קוד** (קובץ YAML ופרומפט), או ב-TypeScript.

## לתרום 🙌

כל סטודנט/ית יכולים לתרום, גם בלי לתכנת: רעיונות לכלים, פרומפטים, בדיקות איכות ותרגומים.

- [מדריך תרומה](CONTRIBUTING.md) · [Contributing (English)](CONTRIBUTING.en.md)
- [כתיבת כלי חדש תוך 30 דקות](docs/plugins.md)
- [משימות למתחילים](https://github.com/yairbarak22/RuecAI_Tutor/issues?q=is%3Aopen+label%3A%22good+first+issue%22)

```bash
git clone https://github.com/yairbarak22/RuecAI_Tutor.git && cd RuecAI_Tutor
npm install
npm run dev        # http://localhost:5173
npm run check      # typecheck + בדיקות + evals + E2E
```

## מסמכים

[סקירת פרויקטים קיימים](docs/01-landscape-research.md) · [ארכיטקטורה](docs/02-architecture.md) · [Roadmap](docs/03-roadmap.md) · [הפצה והתקנה](docs/04-distribution.md) · [למתחזקים](docs/maintainers.md) · [אבטחה](SECURITY.md)

---

### English

RuecAI Teacher is an open-source, local-first AI study companion built by and for Reichman University students. It's a static web app with no backend: course files and the SQLite database stay on the student's machine, and Claude is called directly from the browser with the student's own key. Every learning tool is a plugin: either declarative (YAML + prompt, no code) or TypeScript. Every plugin ships with evals that run in CI. See [CONTRIBUTING.en.md](CONTRIBUTING.en.md).

Licensed under [Apache-2.0](LICENSE).
