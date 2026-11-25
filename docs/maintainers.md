# מדריך למתחזקים

## פריסה (Production)

- כל push ל-`main` מריץ את `.github/workflows/deploy.yml`: בדיקות, build, ופריסה ל-**GitHub Pages**.
- כתובת: https://yairbarak22.github.io/RuecAI_Tutor/
- חד-פעמי: ב-Settings ← Pages, תחת Source, לבחור **GitHub Actions**.
- כדאי בהמשך: דומיין משלכם (למשל `ruecai.app`), כדי שלאתר יהיה origin נפרד מאתרי GitHub Pages אחרים של אותו משתמש.

## תצוגה מקדימה לכל PR

מנגנון בשני שלבים, בטוח גם ל-PR מ-fork:

1. `preview-build.yml`: בונה את ה-PR בלי סודות, עם הרשאות קריאה בלבד, ומעלה את ה-build כ-artifact.
2. `preview-deploy.yml`: מריץ קוד של ה-main בלבד, מוריד את ה-artifact, פורס אותו ל-**Cloudflare Pages** ומגיב ב-PR עם הקישור.

**למה Cloudflare ולא GitHub Pages?** כל תצוגה מקדימה צריכה origin משלה. אם PR זדוני היה רץ על אותו origin כמו האתר האמיתי, הוא היה יכול לקרוא מפתחות API שסטודנטים שמרו בדפדפן.

**הגדרה חד-פעמית (כ-5 דקות):**
1. יוצרים חשבון חינמי ב-https://dash.cloudflare.com.
2. Workers & Pages ← Create ← Pages ← Direct Upload, בשם הפרויקט `ruecai-previews`.
3. My Profile ← API Tokens ← Create Token, עם הרשאת **Cloudflare Pages: Edit**.
4. בריפו: Settings ← Secrets and variables ← Actions, ומוסיפים `CLOUDFLARE_API_TOKEN` ו-`CLOUDFLARE_ACCOUNT_ID`.

עד שהסודות מוגדרים, ה-workflow מדלג על הפריסה בלי להיכשל, וה-build זמין להורדה כ-artifact.

## Evals חיים (מודל אמיתי)

אם מגדירים secret בשם `ANTHROPIC_API_KEY`, כל push ל-`main` מריץ את בדיקות האיכות של כל הכלים מול Claude. העלות היא סנטים בודדים לריצה. ב-PR רצים רק ה-evals המוקלטים, בלי עלות.

## Review

- **כלי חדש:** לוודא שיש `evals/` שעוברים, שהפרומפט בעברית טובה, שאין `fetch` חיצוני, ושהכלי לא פותר מטלות במקום הסטודנט.
- **ליבה/SDK:** רק אחרי RFC מוסכם. שינוי שובר ב-SDK מעלה גרסה.
- **אבטחה:** כל שינוי ב-`Visuals.tsx` (iframe/CSP), `Markdown.tsx` (sanitize), `secrets.ts` או ב-workflows דורש review של מתחזק ליבה.

## שחרור גרסה

הפריסה רציפה (כל merge). מדי פעם מתייגים `vX.Y.Z` ב-git וכותבים release notes בעברית.
