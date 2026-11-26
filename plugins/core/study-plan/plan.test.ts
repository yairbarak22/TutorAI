import { describe, expect, it } from "vitest";
import type { ConceptInfo } from "@tutorai/sdk";
import { buildStudyPlan, prerequisiteOrder } from "./plan.ts";

const c = (name: string, prerequisites: string[] = [], mastery = 0.2, attempts = 0): ConceptInfo => ({
  name, nameEn: "", definition: "", prerequisites, mastery, attempts,
});

describe("study plan", () => {
  it("orders prerequisites first", () => {
    const order = prerequisiteOrder([c("בייס", ["מותנית"]), c("מותנית", ["אקסיומות"]), c("אקסיומות")]).map((x) => x.name);
    expect(order).toEqual(["אקסיומות", "מותנית", "בייס"]);
  });

  it("respects the daily budget and ends with a review day", () => {
    const plan = buildStudyPlan({
      concepts: [c("א"), c("ב", ["א"]), c("ג", ["ב"]), c("ד"), c("ה", [], 0.9, 5)],
      today: "2027-01-01", examDate: "2027-01-15", minutesPerDay: 60,
    });
    for (const d of plan.days.slice(0, -1)) expect(d.items.reduce((n, i) => n + i.minutes, 0)).toBeLessThanOrEqual(60);
    const last = plan.days.at(-1)!;
    expect(last.date).toBe("2027-01-14");
    expect(last.items.every((i) => i.activity === "review")).toBe(true);
    // strong concept only appears (if at all) never as "learn"
    expect(plan.days.flatMap((d) => d.items).some((i) => i.concept === "ה" && i.activity === "learn")).toBe(false);
    // "א" is learned before "ג"
    const firstDay = (name: string) => plan.days.findIndex((d) => d.items.some((i) => i.concept === name && i.activity === "learn"));
    expect(firstDay("א")).toBeLessThanOrEqual(firstDay("ג"));
  });

  it("handles an exam tomorrow", () => {
    const plan = buildStudyPlan({ concepts: [c("א"), c("ב")], today: "2027-01-01", examDate: "2027-01-02", minutesPerDay: 30 });
    expect(plan.days.length).toBeGreaterThan(0);
  });
});
