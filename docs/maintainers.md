# מדריך למתחזקים

## פריסה (Production)

- כל push ל-`main` מריץ את `.github/workflows/deploy.yml`: בדיקות, build, ופריסה ל-**GitHub Pages**.
- כתובת: https://yairbarak22.github.io/RuecAI_Tutor/
- חד-פעמי: ב-Settings ← Pages, תחת Source, לבחור **GitHub Actions**.
- כדאי בהמשך: דומיין משלכם (למשל `ruecai.app`), כדי שלאתר יהיה origin נפרד מאתרי GitHub Pages אחרים של אותו משתמש.

## בדיקת PR

אין קישור תצוגה מקדימה לכל PR: הוחלט לוותר על Cloudflare. כל PR עובר CI (typecheck, בדיקות יחידה, evals מוקלטים ו-E2E). כדי לנסות PR מקומית: `gh pr checkout <מספר> && npm i && npm run dev`.

**אבטחה:** לעולם לא פורסים build של PR ל-origin של האתר האמיתי, כי PR זדוני היה יכול לקרוא מפתחות API שסטודנטים שמרו בדפדפן.

## Evals חיים (מודל אמיתי)

אם מגדירים secret בשם `ANTHROPIC_API_KEY`, כל push ל-`main` מריץ את בדיקות האיכות של כל הכלים מול Claude, עם המודל הזול (`claude-haiku-5-5`) לשתי הרמות. אפשר להחליף מודל עם `RUECAI_EVAL_MODEL`. העלות היא סנטים בודדים לריצה. ב-PR רצים רק ה-evals המוקלטים, בלי עלות.

## Review

- **כלי חדש:** לוודא שיש `evals/` שעוברים, שהפרומפט בעברית טובה, שאין `fetch` חיצוני, ושהכלי לא פותר מטלות במקום הסטודנט.
- **ליבה/SDK:** רק אחרי RFC מוסכם. שינוי שובר ב-SDK מעלה גרסה.
- **אבטחה:** כל שינוי ב-`Visuals.tsx` (iframe/CSP), `Markdown.tsx` (sanitize), `secrets.ts` או ב-workflows דורש review של מתחזק ליבה.

## שחרור גרסה

הפריסה רציפה (כל merge). מדי פעם מתייגים `vX.Y.Z` ב-git וכותבים release notes בעברית.
