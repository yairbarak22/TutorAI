import { describe, expect, it } from "vitest";
import { rejectExpression } from "./sympy.ts";

describe("SymPy expression whitelist", () => {
  it("accepts ordinary math", () => {
    for (const e of ["binomial(5,2)*Rational(1,2)**5", "(x+1)**2", "integrate(2*x, x)", "sqrt(2)/2", "0.3125", "diff(sin(x), x)", "Sum(k, (k, 1, n))", "mu + 2*sigma"])
      expect(rejectExpression(e), e).toBeNull();
  });
  it("rejects anything that could run code", () => {
    for (const e of [
      "__import__('os')",
      "open('x')",
      "x.__class__",
      "().__class__.__bases__",
      "eval(1)",
      "lambda: 1",
      "exec(1)",
      "getattr(x, 'y')",
      "js.fetch(1)",
      "Rational(1,2).evalf",
      "'abc'",
      "x[0]",
      "a;b",
      "x" + "1".repeat(400),
    ])
      expect(rejectExpression(e), e).not.toBeNull();
  });
});
