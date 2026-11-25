import { describe, expect, it } from "vitest";
import { ancestorsOf, buildConceptGraph, descendantsOf } from "./graph.ts";

const c = (name: string, ...prerequisites: string[]) => ({ name, prerequisites });

describe("buildConceptGraph", () => {
  it("assigns levels by the longest prerequisite chain", () => {
    const g = buildConceptGraph([c("C", "B"), c("B", "A"), c("A"), c("D", "A")]);
    expect(g.levelOf.get("A")).toBe(0);
    expect(g.levelOf.get("B")).toBe(1);
    expect(g.levelOf.get("D")).toBe(1);
    expect(g.levelOf.get("C")).toBe(2);
    expect(g.levels.map((l) => l.length)).toEqual([1, 2, 1]);
  });

  it("drops redundant edges (transitive reduction)", () => {
    const g = buildConceptGraph([c("A"), c("B", "A"), c("C", "A", "B")]);
    expect(g.edges).toEqual([
      ["A", "B"],
      ["B", "C"],
    ]);
    expect(g.removed).toBe(1);
  });

  it("survives cycles, self-loops and unknown names", () => {
    const g = buildConceptGraph([c("A", "C", "A", "nope"), c("B", "A"), c("C", "B")]);
    expect(g.edges.length).toBe(2);
    expect([...g.levelOf.values()].sort()).toEqual([0, 1, 2]);
  });

  it("walks ancestors and descendants", () => {
    const g = buildConceptGraph([c("A"), c("B", "A"), c("C", "B"), c("X")]);
    expect([...ancestorsOf(g, "C")].sort()).toEqual(["A", "B"]);
    expect([...descendantsOf(g, "A")].sort()).toEqual(["B", "C"]);
    expect(ancestorsOf(g, "X").size).toBe(0);
  });

  it("orders a level next to its prerequisites", () => {
    const g = buildConceptGraph([c("P1"), c("P2"), c("Q2", "P2"), c("Q1", "P1")]);
    expect(g.levels[0]).toEqual(["P1", "P2"]);
    expect(g.levels[1]).toEqual(["Q1", "Q2"]);
  });
});
