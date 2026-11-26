import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM module without types
import { decideClaim, decideStale, parseCommand } from "./claims.mjs";

const base = { user: "dana", assignees: [], isPullRequest: false, isOpen: true, otherOpenClaims: 0, mergedPrs: 0, plan: "I'll add a case-comparison tool for contract law." };

describe("issue claiming", () => {
  it("parses commands and the plan", () => {
    expect(parseCommand("/claim I will fix the label")).toEqual({ command: "claim", plan: "I will fix the label" });
    expect(parseCommand("  /UNCLAIM")).toEqual({ command: "unclaim", plan: "" });
    expect(parseCommand("I want to /claim this")).toBeNull();
  });
  it("assigns a free issue and asks for a plan when it is missing", () => {
    expect(decideClaim(base).action).toBe("assign");
    expect(decideClaim({ ...base, plan: "" }).reply).toContain("short plan");
  });
  it("does not take an issue someone else holds", () => {
    const d = decideClaim({ ...base, assignees: ["yossi"] });
    expect(d.action).toBe("none");
    expect(d.reply).toContain("@yossi");
  });
  it("limits newcomers to one issue at a time until two merged PRs", () => {
    expect(decideClaim({ ...base, otherOpenClaims: 1 }).action).toBe("none");
    expect(decideClaim({ ...base, otherOpenClaims: 1, mergedPrs: 2 }).action).toBe("assign");
  });
  it("ignores pull requests and closed issues", () => {
    expect(decideClaim({ ...base, isPullRequest: true }).action).toBe("none");
    expect(decideClaim({ ...base, isOpen: false }).action).toBe("none");
  });
  it("reminds after 10 days and releases after 14 without a linked PR", () => {
    const at = "2027-01-01T00:00:00Z";
    expect(decideStale({ assignedAt: at, now: "2027-01-05T00:00:00Z", hasLinkedPr: false, reminded: false })).toBe("none");
    expect(decideStale({ assignedAt: at, now: "2027-01-11T00:00:00Z", hasLinkedPr: false, reminded: false })).toBe("remind");
    expect(decideStale({ assignedAt: at, now: "2027-01-11T00:00:00Z", hasLinkedPr: false, reminded: true })).toBe("none");
    expect(decideStale({ assignedAt: at, now: "2027-01-15T00:00:00Z", hasLinkedPr: false, reminded: true })).toBe("release");
    expect(decideStale({ assignedAt: at, now: "2027-02-15T00:00:00Z", hasLinkedPr: true, reminded: true })).toBe("none");
  });
});
