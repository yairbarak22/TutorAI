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
