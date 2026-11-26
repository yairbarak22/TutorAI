import { describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import type { MathVerifier, SolutionCheck } from "@tutorai/sdk";
import { MockLLM, runTool, seedCourse, Store } from "@tutorai/core";
import { courseFixtures, demoFixtures, getTool } from "../../registry.ts";

const SQL = await initSqlJs();
const params = { problem: "מה ההסתברות?", answer: "C(5,2)*(1/2)^2 = 10/4 = 2.4" };

/** A fake SymPy: evaluates simple numeric claims with JS, so the reconciliation logic is testable in Node. */
const fakeMath: MathVerifier = {
  async verify(claims) {
    const num = (s: string) =>
      Function(`"use strict"; const Rational=(a,b)=>a/b; const binomial=(n,k)=>{let r=1;for(let i=1;i<=k;i++)r=r*(n-k+i)/i;return r}; return (${s.replace(/\*\*/g, "**")});`)() as number;
    return claims.map((c) => {
      const ok = Math.abs(num(c.lhs) - num(c.rhs)) < 1e-9;
      return { ok, detail: ok ? "equal" : "not equal" };
    });
  },
};

describe("check-solution", () => {
  it("uses symbolic checking to override the model on arithmetic, and keeps conceptual errors", async () => {
    const store = Store.open(SQL);
    const courseId = seedCourse(store, structuredClone(courseFixtures.probability));
    const llm = new MockLLM(demoFixtures());
    const res = await runTool(getTool("check-solution"), { store, llm, courseId, params, math: fakeMath });
    if (res.kind !== "artifact") throw new Error("expected artifact");
    const data = res.payload.data as SolutionCheck;
    expect(data.steps[1].status).toBe("error"); // conceptual (model)
    expect(data.steps[2].verified).toBe("pass"); // 10*(1/4) == 10/4
    expect(data.steps[3].verified).toBe("fail"); // 10/4 != 2.4 (SymPy)
    expect(data.steps[3].status).toBe("error");
    expect(data.first_error).toBe(1);
    expect(llm.calls.map((c) => c.tag)).toContain("check-solution:feedback");
  });

  it("still works without a math engine (verification unknown)", async () => {
    const store = Store.open(SQL);
    const courseId = seedCourse(store, structuredClone(courseFixtures.probability));
    const res = await runTool(getTool("check-solution"), { store, llm: new MockLLM(demoFixtures()), courseId, params });
    if (res.kind !== "artifact") throw new Error("expected artifact");
    const data = res.payload.data as SolutionCheck;
    expect(data.steps.every((s) => s.verified === "unknown")).toBe(true);
    expect(data.first_error).toBe(1);
  });

  it("asks for a solution when nothing was given", async () => {
    const store = Store.open(SQL);
    const courseId = seedCourse(store, structuredClone(courseFixtures.probability));
    await expect(runTool(getTool("check-solution"), { store, llm: new MockLLM(demoFixtures()), courseId, params: {} })).rejects.toThrow();
  });
});
