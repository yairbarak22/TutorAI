import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

/** TutorAI Local in a real browser: one-time open link, local onboarding, both plans, security. */

const here = dirname(fileURLToPath(import.meta.url));
const state = () => JSON.parse(readFileSync(join(here, ".state.json"), "utf8")) as { config: string; data: string; mock: string; port: number };
const run = () => JSON.parse(readFileSync(join(state().config, "run.json"), "utf8")) as { controlSecret: string; port: number };

async function control(path: string) {
  const r = await fetch(`http://127.0.0.1:${run().port}${path}`, { method: "POST", headers: { authorization: `Bearer ${run().controlSecret}` } });
  expect(r.ok).toBe(true);
  return r.status === 204 ? null : r.json();
}

/** A fresh install: settings, ChatGPT sign-in, Claude sign-in and the data folder all reset. */
async function freshInstall() {
  await control("/control/test-reset");
  const { data } = state();
  for (const f of readdirSync(data)) rmSync(join(data, f), { recursive: true, force: true });
  const claudeState = join(dirname(state().config), "claude-state");
  rmSync(join(claudeState, "logged-in"), { force: true });
}

async function openApp(page: Page) {
  const { code } = (await control("/control/code")) as { code: string };
  await page.goto(`/open?code=${code}`);
}

/** The first-run "close and reopen" explanation appears once TutorAI is set up; dismiss it. */
async function dismissTip(page: Page) {
  const got = page.getByRole("dialog", { name: "TutorAI רץ במחשב שלכם" }).getByRole("button", { name: "הבנתי" });
  await got.waitFor({ state: "visible", timeout: 5000 }).then(() => got.click(), () => {});
}

test.beforeEach(async () => {
  await freshInstall();
});

test("opens from a one-time link; the link can't be reused; data is saved in the folder", async ({ page, browser }) => {
  const { code } = (await control("/control/code")) as { code: string };
  await page.goto(`/open?code=${code}`);
  await expect(page.getByRole("button", { name: "בואו נתחיל" })).toBeVisible();

  const other = await browser.newContext({ baseURL: `http://127.0.0.1:${state().port}` });
  const second = await other.newPage();
  await second.goto(`/open?code=${code}`);
  await expect(second.getByText("הקישור הזה כבר לא תקף")).toBeVisible();
  await other.close();

  await page.getByRole("button", { name: "בואו נתחיל" }).click();
  // No storage step in the local version: straight to connecting the AI.
  await expect(page.getByRole("heading", { name: "איך לחבר את ה-AI?" })).toBeVisible();
  await page.getByRole("combobox", { name: "איזה חשבון AI יש לכם?" }).click();
  await page.getByRole("option", { name: /רק לנסות/ }).click();
  await page.getByRole("button", { name: "כניסה במצב הדגמה" }).click();
  await dismissTip(page);
  await page.getByRole("button", { name: "קורס לדוגמה: הסתברות" }).click();
  await expect(page.getByRole("heading", { name: "הסתברות למדעי המחשב" })).toBeVisible();
  // Saved to the real folder (the database is written ~0.7 s after a change).
  const db = join(state().data, "tutorai.db");
  await expect.poll(() => existsSync(db) && readFileSync(db).includes(Buffer.from("הסתברות למדעי המחשב")), { timeout: 10_000 }).toBe(true);

  await page.reload();
  await expect(page.getByText("הסתברות למדעי המחשב").first()).toBeVisible();
});

test("connects a ChatGPT plan through Sign in with ChatGPT and answers with it", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "בואו נתחיל" }).click();
  await page.getByRole("combobox", { name: "איזה חשבון AI יש לכם?" }).click();
  await page.getByRole("option", { name: /מנוי ChatGPT/ }).click();
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Continue with ChatGPT" }).click();
  const tab = await popup;
  await expect(tab.getByText("Connected to ChatGPT")).toBeVisible();
  await tab.close().catch(() => {});

  await expect(page.getByRole("dialog")).toContainText("ChatGPT");
  await page.getByRole("button", { name: "הבנתי" }).click();

  // The account's models, starting on the recommended pair; a change is saved in the server's settings.
  const hard = page.getByRole("combobox", { name: "מודל למשימות קשות" });
  await expect(hard).toHaveText(/GPT-6.2 · מומלץ/);
  await expect(page.getByRole("combobox", { name: "מודל למשימות פשוטות" })).toHaveText(/GPT-6.2 mini · מומלץ/);
  await hard.click();
  await page.getByRole("option", { name: /GPT-6.2 mini/ }).click();
  await expect
    .poll(() => JSON.parse(readFileSync(join(state().config, "settings.json"), "utf8")).models?.chatgpt)
    .toEqual({ fast: "gpt-6.2-mini", smart: "gpt-6.2-mini" });

  await page.getByRole("button", { name: "שימוש במנוי ChatGPT" }).click();
  await dismissTip(page);
  await expect(page.getByText("ערב טוב").or(page.getByText("בוקר טוב")).or(page.getByText("צהריים טובים")).or(page.getByText("לילה טוב")).first()).toBeVisible();

  // A model call from the page goes through the server to the (mock) Responses API.
  const answer = await page.evaluate(async () => {
    const r = await fetch("/api/llm", { method: "POST", headers: { "content-type": "application/json", "x-tutorai": localStorage.getItem("tutorai.localToken") ?? "" }, body: JSON.stringify({ provider: "chatgpt", tier: "smart", prompt: "hi" }) });
    return (await r.text()).trim().split("\n").map((l) => JSON.parse(l)).at(-1);
  });
  expect(answer).toMatchObject({ type: "result", text: "Hello world" });

  await page.goto("/#/settings");
  await expect(page.getByText("מחובר למנוי ChatGPT שלכם.")).toBeVisible();
});

test("connects a Claude plan through the official CLI's own sign-in", async ({ page }) => {
  test.skip(process.platform === "win32", "the fake CLI is a shell script; Windows supports only the native claude.exe");
  await openApp(page);
  await page.getByRole("button", { name: "בואו נתחיל" }).click();
  await page.getByRole("combobox", { name: "איזה חשבון AI יש לכם?" }).click();
  await page.getByRole("option", { name: /מנוי Claude/ }).click();
  await expect(page.getByText("תנאים של Anthropic")).toBeVisible();
  await page.getByRole("button", { name: "התחברות לחשבון Claude" }).click();
  // The fake CLI "signs in" like `claude auth login`; the card notices by polling.
  await page.getByRole("button", { name: "שימוש במנוי Claude" }).click({ timeout: 20_000 });
  await dismissTip(page);

  const answer = await page.evaluate(async () => {
    const r = await fetch("/api/llm", { method: "POST", headers: { "content-type": "application/json", "x-tutorai": localStorage.getItem("tutorai.localToken") ?? "" }, body: JSON.stringify({ provider: "claude-code", tier: "fast", prompt: "hi" }) });
    return (await r.text()).trim().split("\n").map((l) => JSON.parse(l)).at(-1);
  });
  expect(answer).toMatchObject({ type: "result", text: "שלום עולם", model: "plan:claude-haiku-5-5" });

  await page.goto("/#/settings");
  await expect(page.getByText("מחובר למנוי Claude שלכם דרך Claude Code.")).toBeVisible();
});

test("other websites can't use the local server", async ({ page }) => {
  await openApp(page);
  // A page on another origin (the mock's) tries to read and to act.
  await page.goto(`${state().mock}/jwks`);
  const result = await page.evaluate(async (port) => {
    const out: string[] = [];
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/hello`, { credentials: "include" });
      out.push(`read:${r.status}`);
    } catch {
      out.push("read:blocked");
    }
    try {
      await fetch(`http://127.0.0.1:${port}/api/quit`, { method: "POST", mode: "no-cors", credentials: "include" });
      out.push("quit:sent");
    } catch {
      out.push("quit:blocked");
    }
    return out;
  }, state().port);
  expect(result[0]).toBe("read:blocked");
  // Whatever the browser did with the no-cors POST, the server is still running.
  const r = await fetch(`http://127.0.0.1:${state().port}/index.html`);
  expect(r.ok).toBe(true);
});

test("a tab not opened from the TutorAI icon asks to open it from there", async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: `http://127.0.0.1:${state().port}`, locale: "he-IL" });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByText("פתחו את TutorAI מהסמל שלו")).toBeVisible();
  await ctx.close();
});
