/**
 * End-to-end student journey in a real browser (demo mode, browser storage — the folder
 * picker is a native dialog that automation cannot drive; the folder path shares the same
 * FileStore contract and is covered by the storage unit test in apps/web).
 */
import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const fixtures = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const tab = (page: Page, name: RegExp) => page.getByRole("navigation", { name: "לשוניות הקורס" }).getByRole("link", { name });

async function onboard(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "בואו נתחיל" }).click();
  await page.getByText("בתוך הדפדפן").click();
  await page.getByRole("button", { name: /נסו במצב הדגמה/ }).click();
  await expect(page.getByRole("heading", { name: "הקורסים שלי" })).toBeVisible();
}

test("onboarding takes under a minute and needs no install", async ({ page }) => {
  const start = Date.now();
  await onboard(page);
  expect(Date.now() - start).toBeLessThan(60_000);
  await expect(page.getByText("מצב הדגמה").first()).toBeVisible();
});

test("upload PDF, PPTX, DOCX and a sample exam → all processed", async ({ page }) => {
  await onboard(page);
  await page.getByRole("main").getByRole("button", { name: "קורס חדש", exact: true }).click();
  await page.getByPlaceholder(/למשל/).fill("קורס בדיקה");
  await page.getByRole("button", { name: "יצירה" }).click();
  await page
    .getByTestId("file-input")
    .setInputFiles(["lecture-graphs.pdf", "lecture-rv.pptx", "summary-variance.docx", "מבחן לדוגמה 2025.md"].map(fixtures));
  const rows = page.getByTestId("source-row");
  await expect(rows).toHaveCount(4);
  for (let i = 0; i < 4; i++) await expect(rows.nth(i).getByText("מוכן")).toBeVisible({ timeout: 30_000 });
  await expect(rows.nth(3).getByText("מבחן לדוגמה", { exact: true })).toBeVisible();
  await expect(rows.nth(0)).toContainText("2 קטעים"); // 2 PDF pages

  // data survives a reload (autosave to ruecai.db)
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.getByTestId("source-row")).toHaveCount(4);
});

test("concept map, tools, quiz → mastery, flashcards → review, tutor with citations", async ({ page }) => {
  await onboard(page);
  await page.getByRole("button", { name: "קורס לדוגמה: הסתברות" }).click();

  await tab(page, /מפת מושגים/).click();
  await expect(page.getByTestId("concept-card")).toHaveCount(8);
  await expect(page.locator(".mermaid-host svg text").filter({ hasText: "בייס" }).first()).toBeVisible();

  // Summary with citations that open the source
  await tab(page, /כלים/).click();
  await page.getByTestId("tool-summary").click();
  await page.getByRole("button", { name: /יצירה/ }).click();
  await expect(page.getByRole("heading", { name: /סיכום/ })).toBeVisible();
  await expect(page.locator(".katex").first()).toBeVisible();
  await page.getByTestId("cite-chip").first().click();
  await expect(page.getByRole("dialog")).toContainText("עמ'");
  await page.keyboard.press("Escape");

  // Quiz updates mastery
  await tab(page, /כלים/).click();
  await page.getByTestId("tool-quiz").click();
  await page.getByRole("button", { name: /יצירה/ }).click();
  const q = page.getByTestId("quiz-question").first();
  await q.getByRole("radio").first().click();
  await q.getByRole("button", { name: "בדיקה" }).click();
  await expect(q).toContainText("נכון");
  await tab(page, /התקדמות/).click();
  await expect(page.getByTestId("mastery-row").filter({ hasText: "הסתברות מותנית" })).toContainText("· 1");

  // Flashcards → spaced repetition
  await tab(page, /כלים/).click();
  await page.getByTestId("tool-flashcards").click();
  await page.getByRole("button", { name: /יצירה/ }).click();
  await page.getByRole("button", { name: "לחזרה עכשיו" }).click();
  await page.getByRole("button", { name: "הצגת התשובה" }).click();
  await page.getByRole("button", { name: /^טוב/ }).click();
  await expect(page.getByTestId("review-card")).toBeVisible();

  // Tutor streams an answer with inline citations
  await tab(page, /טוטור/).click();
  await page.getByLabel("הודעה לטוטור").fill("לא מבין את נוסחת בייס");
  await page.keyboard.press("Enter");
  const answer = page.getByTestId("msg-assistant").last();
  await expect(answer).toContainText("שאלה מנחה");
  await expect(answer.getByTestId("cite-chip").first()).toBeVisible();
});

test("law: new exam from sample exams, graded by rubric", async ({ page }) => {
  await onboard(page);
  await page.getByRole("button", { name: "קורס לדוגמה: דיני חוזים" }).click();
  await tab(page, /כלים/).click();
  await page.getByTestId("tool-exam-from-samples").click();
  await page.getByRole("button", { name: /יצירה/ }).click();
  await expect(page.getByTestId("exam-question")).toHaveCount(2);
  await page.getByTestId("exam-question").first().locator("textarea").fill("זו הצעה, והקיבול בתנאי הוא הצעה נגדית לפי סעיף 6.");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "הגשה לבדיקה" }).click();
  await expect(page.getByText("/ 100")).toBeVisible();
  await expect(page.getByTestId("exam-question").first()).toContainText("נק'");
});

test("interactive explainer runs sandboxed without errors", async ({ page }) => {
  await onboard(page);
  await page.getByRole("button", { name: "קורס לדוגמה: הסתברות" }).click();
  await tab(page, /כלים/).click();
  await page.getByTestId("tool-explainer").click();
  await page.getByRole("combobox").first().selectOption("נוסחת בייס");
  await page.getByRole("button", { name: /יצירה/ }).click();
  const frame = page.frameLocator('iframe[title="הסבר אינטראקטיבי"]');
  await expect(frame.locator(".viz-readouts dd").last()).toHaveText(/%/);
  await expect(frame.locator("canvas")).toHaveCount(2); // 3D scene + 2D plot
  await expect(page.locator("iframe")).toHaveAttribute("sandbox", "allow-scripts");
  await expect(page.getByText("בווידג'ט יש שגיאה")).toHaveCount(0);
});
