#!/usr/bin/env node
/**
 * Regenerates the README screenshots in docs/screenshots/ by driving the app in demo mode
 * (prerecorded answers, no API key, no network calls to a model).
 *
 * Uses the production build: in the dev server the SymPy worker ("Check my solution") doesn't load.
 *
 *   npm run build && npm run preview              # serves http://localhost:4173
 *   npm run screenshots -- [baseURL]              # default http://localhost:4173
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? "http://localhost:4173";
const out = fileURLToPath(new URL("../docs/screenshots/", import.meta.url));
await mkdir(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: "en-US" });
const shot = async (name, settle = 600) => {
  await page.waitForTimeout(settle);
  await page.screenshot({ path: `${out}${name}.png` });
  console.log(`docs/screenshots/${name}.png`);
};
const tab = (name) => page.getByRole("navigation", { name: "Course sections" }).getByRole("link", { name });
const go = async (hash) => {
  await page.goto(`${base}/#${hash}`);
  await page.waitForLoadState("networkidle");
};

// Onboarding in demo mode, with in-browser storage (the folder picker is a native dialog).
await page.goto(base);
await page.getByRole("button", { name: "Let's get started" }).click();
await page.getByText("Inside the browser").click();
await page.getByRole("button", { name: /Try demo mode/ }).click();
await page.getByRole("button", { name: "Sample course: Probability" }).click();
await page.getByRole("button", { name: "Dismiss" }).click().catch(() => {});

// Some practice first, so mastery colors and the daily session have something to show.
await tab(/Tools/).click();
await page.getByTestId("tool-quiz").click();
await page.getByRole("button", { name: /Create/ }).click();
const questions = page.getByTestId("quiz-question");
await questions.first().waitFor();
for (let i = 0; i < (await questions.count()); i++) {
  const q = questions.nth(i);
  const radios = q.getByRole("radio");
  if (!(await radios.count())) continue;
  await radios.nth(i % 2 ? 3 : 0).click();
  await q.getByRole("button", { name: "Check" }).click();
}
await page.waitForTimeout(1500);

// Concept map, with one concept in focus (the README hero)
await go("/");
await tab(/Concept map/).click();
await page.getByTestId("concept-card").filter({ hasText: "Bayes" }).first().click();
await shot("concept-map");

// Today's session
await tab(/Daily session/).click();
await shot("session");

// Private tutor, with a cited answer
await tab(/Tutor/).click();
await page.getByLabel("Message to the tutor").fill("I don't get Bayes' theorem");
await page.keyboard.press("Enter");
await page.getByText("guiding question").first().waitFor({ timeout: 60_000 });
await shot("tutor", 1200);

// Check my solution: first mistake + one hint
await tab(/Tools/).click();
await page.getByTestId("tool-check-solution").click();
await page.getByLabel(/Or type your solution/).fill("C(5,2)*(1/2)^2 = 10/4 = 2.4");
await page.getByRole("button", { name: /Check my solution/ }).click();
await page.getByTestId("solution-check").waitFor({ timeout: 120_000 });
await page.getByRole("button", { name: "First hint" }).click();
await shot("check-solution");

// Interactive explainer (sandboxed widget)
await tab(/Tools/).click();
await page.getByTestId("tool-explainer").click();
await page.getByRole("combobox").first().click();
await page.getByRole("option", { name: "Bayes' theorem" }).click();
await page.getByRole("button", { name: /Create/ }).click();
await page.frameLocator("iframe").locator("canvas").first().waitFor({ timeout: 60_000 });
await shot("explainer", 2500);

await browser.close();
