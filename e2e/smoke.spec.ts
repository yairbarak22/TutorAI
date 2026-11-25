import { expect, test } from "@playwright/test";

test("loads in Hebrew RTL with no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "RuecAI Teacher" })).toBeVisible();
  await page.getByRole("button", { name: "בואו נתחיל" }).click();
  await page.getByText("בתוך הדפדפן").click();
  await page.getByRole("button", { name: /נסו במצב הדגמה/ }).click();
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
    await page.getByRole("button", { name: /demo/i }).click();
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
