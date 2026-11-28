import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

/**
 * The Moodle connection in a real browser, against a mock Moodle (apps/local/test/mock-moodle.ts):
 * sign in on the site's own page, bring the link back, pick a course, import its files, and be
 * told when a new file appears. The sign-in handler is off here, so this is the copy-and-paste path.
 */

const here = dirname(fileURLToPath(import.meta.url));
const state = () => JSON.parse(readFileSync(join(here, ".state.json"), "utf8")) as { config: string; data: string; moodle: string; port: number };
const run = () => JSON.parse(readFileSync(join(state().config, "run.json"), "utf8")) as { controlSecret: string; port: number };

async function control(path: string) {
  const r = await fetch(`http://127.0.0.1:${run().port}${path}`, { method: "POST", headers: { authorization: `Bearer ${run().controlSecret}` } });
  expect(r.ok).toBe(true);
  return r.status === 204 ? null : r.json();
}
const mock = (cmd: Record<string, unknown>) => fetch(`${state().moodle}/__mock`, { method: "POST", body: JSON.stringify(cmd) });

test.beforeEach(async () => {
  await control("/control/test-reset");
  await mock({ reset: true });
  const { data } = state();
  for (const f of readdirSync(data)) rmSync(join(data, f), { recursive: true, force: true });
});

/** Opens TutorAI in demo mode and lands on Home. */
async function openHome(page: Page) {
  const { code } = (await control("/control/code")) as { code: string };
  await page.goto(`/open?code=${code}`);
  await page.getByRole("button", { name: "בואו נתחיל" }).click();
  await page.getByRole("combobox", { name: "איזה חשבון AI יש לכם?" }).click();
  await page.getByRole("option", { name: /רק לנסות/ }).click();
  await page.getByRole("button", { name: "כניסה במצב הדגמה" }).click();
  const tip = page.getByRole("dialog", { name: "TutorAI רץ במחשב שלכם" }).getByRole("button", { name: "הבנתי" });
  await tip.waitFor({ state: "visible", timeout: 5000 }).then(() => tip.click(), () => {});
}

/** Home → Import from Moodle → the test institution → the sign-in step. */
async function toSignIn(page: Page) {
  await page.getByRole("button", { name: "ייבוא מ-Moodle" }).click();
  const dialog = page.getByRole("dialog", { name: "חיבור ל-Moodle" });
  await dialog.getByRole("combobox", { name: "המוסד שלכם" }).click();
  await page.getByRole("option", { name: "מוסד בדיקה" }).click();
  await dialog.getByRole("button", { name: "המשך" }).click();
  return dialog;
}

/** Signs in on the mock's launch page and returns the link it shows. */
async function signIn(page: Page) {
  const dialog = await toSignIn(page);
  const link = dialog.getByRole("link", { name: "התחברות ל-Moodle" });
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  const [moodleTab] = await Promise.all([page.waitForEvent("popup"), link.click()]);
  await moodleTab.waitForLoadState();
  // The Moodle tab can't reach back into TutorAI's tab.
  expect(await moodleTab.evaluate(() => window.name)).toBe("opener:none");
  const href = await moodleTab.locator("#launchapp").getAttribute("href");
  expect(href).toMatch(/^moodlemobile:\/\/token=/);
  return { dialog, moodleTab, href: href! };
}

test("connects by signing in on Moodle's page, imports a course's files, and notices a new one", async ({ page }) => {
  await openHome(page);
  const { dialog, moodleTab, href } = await signIn(page);

  // A wrong paste is explained without being echoed.
  const box = dialog.getByLabel("הקישור מהדף של Moodle");
  await box.fill(moodleTab.url());
  await dialog.getByRole("button", { name: "חיבור", exact: true }).click();
  await expect(dialog.getByText("זו כתובת הדף עצמו")).toBeVisible();

  await box.fill(href);
  await dialog.getByRole("button", { name: "חיבור", exact: true }).click();
  await expect(dialog.getByText("מחוברים בתור סטודנט לדוגמה ב-Mock Moodle")).toBeVisible();
  await moodleTab.close();
  await dialog.getByRole("button", { name: "לבחירת קורסים" }).click();

  // The token is with TutorAI on this computer: not in the page's storage, not in the data folder.
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(stored).not.toContain("0123456789abcdef0123456789abcdef");

  const courses = page.getByRole("dialog", { name: "ייבוא קורסים מ-Moodle" });
  await courses.getByText("תורת הגרפים").click();
  await courses.getByRole("button", { name: "ייבוא קורס אחד" }).click();
  await expect(page.getByRole("heading", { name: "תורת הגרפים" })).toBeVisible();

  // The course's files are listed with the importable ones ticked; nothing is downloaded yet.
  const strip = page.getByTestId("moodle-strip");
  await expect(strip.getByTestId("moodle-file")).toHaveCount(2);
  await expect(strip.getByText("lecture-graphs.pdf")).toBeVisible();
  await expect(strip.getByText("summary-variance.docx")).toBeVisible();
  await expect(strip.getByText(/פעילות אחת שאינה קובץ/)).toBeVisible();
  await expect(page.getByTestId("source-row")).toHaveCount(0);

  // Select all clears and re-ticks everything; a file can be ticked by clicking its name.
  const all = strip.getByRole("checkbox", { name: "סימון כל הקבצים", exact: true });
  await expect(all).toBeChecked();
  await all.click();
  await expect(strip.getByRole("button", { name: "בחרו קבצים לייבוא" })).toBeDisabled();
  await strip.getByText("lecture-graphs.pdf").click();
  await expect(strip.getByRole("button", { name: /ייבוא קובץ אחד/ })).toBeVisible();
  await all.click();
  await strip.getByRole("button", { name: /ייבוא 2 קבצים/ }).click();
  await expect(strip.getByText(/יובאו 2 קבצים/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("source-row")).toHaveCount(2);
  // With nothing left to import there is no import button (and no "import 0 files").
  await expect(strip.getByRole("button", { name: /ייבוא|בחרו קבצים/ })).toHaveCount(0);
  await expect(page.getByTestId("source-row").filter({ hasText: "מוכן" })).toHaveCount(2, { timeout: 30_000 });

  // In the data folder under the usual names, and known to the saved database.
  const sources = join(state().data, "courses", "1", "sources");
  expect(readdirSync(sources).map((n) => n.replace(/^[a-f0-9]{10}-/, "")).sort()).toEqual(["lecture-graphs.pdf", "summary-variance.docx"]);
  await expect.poll(() => existsSync(join(state().data, "tutorai.db")) && readFileSync(join(state().data, "tutorai.db")).includes(Buffer.from("lecture-graphs.pdf")), { timeout: 10_000 }).toBe(true);
  expect(readFileSync(join(state().data, "tutorai.db")).includes(Buffer.from("0123456789abcdef0123456789abcdef"))).toBe(false);

  // A file appears in Moodle later.
  await mock({ addFile: { moduleId: 11, filename: "מבחן לדוגמה 2025.md", base64: Buffer.from("# מבחן לדוגמה\n\nשאלה 1: הגדירו גרף קשיר.").toString("base64") } });
  await strip.getByRole("button", { name: "בדיקה ב-Moodle עכשיו" }).click();
  await expect(strip.getByTestId("moodle-file")).toHaveCount(1);
  await expect(strip.getByText("מבחן לדוגמה 2025.md")).toBeVisible();
  await strip.getByRole("button", { name: /ייבוא קובץ אחד/ }).click();
  await expect(page.getByTestId("source-row")).toHaveCount(3, { timeout: 20_000 });
  await expect(page.getByTestId("source-row").filter({ hasText: "מבחן לדוגמה 2025.md" }).getByText("מבחן לדוגמה", { exact: true })).toBeVisible();

  // After a reload the link, the file list and the sources are all still there.
  await page.reload();
  await expect(page.getByTestId("source-row")).toHaveCount(3);
  await expect(page.getByTestId("moodle-strip").getByText(/Moodle · תורת הגרפים/)).toBeVisible();
});

test("says so when the connection ended, and lets the student sign in again", async ({ page }) => {
  await openHome(page);
  const { dialog, moodleTab, href } = await signIn(page);
  await dialog.getByLabel("הקישור מהדף של Moodle").fill(href);
  await dialog.getByRole("button", { name: "חיבור", exact: true }).click();
  await dialog.getByRole("button", { name: "לבחירת קורסים" }).click();
  await moodleTab.close();
  const courses = page.getByRole("dialog", { name: "ייבוא קורסים מ-Moodle" });
  await courses.getByText("תורת הגרפים").click();
  await courses.getByRole("button", { name: "ייבוא קורס אחד" }).click();
  const strip = page.getByTestId("moodle-strip");
  await expect(strip.getByTestId("moodle-file")).toHaveCount(2);

  await mock({ fault: "expired" });
  await strip.getByRole("button", { name: "בדיקה ב-Moodle עכשיו" }).click();
  await expect(strip.getByText(/החיבור ל-Moodle הסתיים/)).toBeVisible();
  await mock({ fault: "none" });
  await strip.getByRole("button", { name: "התחברות מחדש" }).click();
  await expect(page.getByRole("dialog", { name: "חיבור ל-Moodle" })).toBeVisible();

  // Settings shows the connection and can remove it.
  await page.getByRole("dialog", { name: "חיבור ל-Moodle" }).getByRole("button", { name: "סגירה" }).click();
  await page.goto("/#/settings");
  await page.getByRole("tab", { name: /נתונים/ }).or(page.getByRole("button", { name: /נתונים/ })).first().click();
  await expect(page.getByText("Moodle · Mock Moodle")).toBeVisible();
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "ניתוק" }).click();
  await expect(page.getByText("חברו את ה-Moodle של המוסד")).toBeVisible();
});

test("refuses a site whose details don't match its address, and explains one that can't be connected", async ({ page }) => {
  await openHome(page);
  await mock({ config: { launchurl: "javascript:alert(1)" } });
  let dialog = await toSignIn(page);
  await expect(dialog.getByText("האתר החזיר פרטים שלא תואמים את הכתובת שלו")).toBeVisible();
  await expect(dialog.getByRole("link", { name: "התחברות ל-Moodle" })).toHaveCount(0);

  await mock({ config: { wwwroot: "https://moodle.runi.ac.il/2027" } });
  await dialog.getByRole("button", { name: "המשך" }).click();
  await expect(dialog.getByText("האתר החזיר פרטים שלא תואמים את הכתובת שלו")).toBeVisible();

  await mock({ config: { enablemobilewebservice: 0 } });
  await dialog.getByRole("button", { name: "המשך" }).click();
  await expect(dialog.getByText(/לא מאפשר חיבור של אפליקציות/)).toBeVisible();
  dialog = page.getByRole("dialog", { name: "חיבור ל-Moodle" });
  await expect(dialog.getByRole("link", { name: "התחברות ל-Moodle" })).toHaveCount(0);
});
