/**
 * English demo mode: every English recorded output must mirror its Hebrew original
 * (same calls, same JSON shape), and every concept it names must exist in the English course.
 */
import { describe, expect, it } from "vitest";
import { demoCourse, demoFixtures } from "./registry.ts";

/** The JSON "shape": keys and array lengths, without the text. */
function shape(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(shape);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)]));
  return typeof v;
}

function conceptsIn(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => conceptsIn(x, out));
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      if (k === "concept" && typeof x === "string") out.push(x);
      else if (k === "concepts" && Array.isArray(x) && x.every((c) => typeof c === "string")) out.push(...(x as string[]));
      else conceptsIn(x, out);
    }
  return out;
}

describe("English demo mode", () => {
  const he = demoFixtures("he");
  const en = demoFixtures("en");

  it("covers the same model calls as Hebrew", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(he).sort());
  });

  it("keeps every output's structure", () => {
    for (const key of Object.keys(he)) expect(shape(en[key]), key).toEqual(shape(he[key]));
  });

  it("has no Hebrew left in English outputs", () => {
    const changed = Object.keys(he).filter((k) => JSON.stringify(he[k]) !== JSON.stringify(en[k]));
    for (const key of changed) expect(JSON.stringify(en[key]), key).not.toMatch(/[֐-׿]/);
  });

  it("only names concepts that exist in the English sample courses", () => {
    const known = new Set([...demoCourse("probability", "en").concepts, ...demoCourse("law", "en").concepts].map((c) => c.name));
    const changed = Object.keys(he).filter((k) => JSON.stringify(he[k]) !== JSON.stringify(en[k]) && k !== "ingest-analyze");
    for (const key of changed) for (const c of conceptsIn(en[key])) expect(known, `${key}: ${c}`).toContain(c);
  });

  it("translates the sample courses without changing their structure", () => {
    for (const which of ["probability", "law"] as const) {
      const a = demoCourse(which, "he");
      const b = demoCourse(which, "en");
      expect(shape(b)).toEqual(shape(a));
      expect(JSON.stringify(b)).not.toMatch(/[֐-׿]/);
      // prerequisites still point at concepts of the same course
      const names = new Set(b.concepts.map((c) => c.name));
      for (const c of b.concepts) for (const p of c.prerequisites) expect(names, `${which}: ${p}`).toContain(p);
    }
  });
});
