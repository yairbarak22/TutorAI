/**
 * Prerequisite-graph helpers for the concept map.
 *
 * The LLM gives each concept a list of prerequisite names. For display we need:
 *  - a DAG (prerequisite cycles happen; we drop the edge that closes a cycle),
 *  - the transitive reduction (if A→B→C, the direct A→C edge adds noise, not information),
 *  - a level per concept (longest prerequisite chain below it) so concepts can be laid out
 *    in columns from foundations to advanced,
 *  - an order inside each level that keeps connected concepts near each other.
 */

export interface ConceptGraphInput {
  name: string;
  prerequisites: string[];
}

export interface ConceptGraph {
  /** Columns from foundations (0) upward; each column is ordered to reduce crossings. */
  levels: string[][];
  levelOf: Map<string, number>;
  /** Reduced edges, prerequisite → dependent. */
  edges: [string, string][];
  /** Direct (reduced) prerequisites / dependents of each concept. */
  parents: Map<string, string[]>;
  children: Map<string, string[]>;
  /** Number of prerequisite links the LLM gave that were dropped (cycles or redundant). */
  removed: number;
}

export function buildConceptGraph(concepts: ConceptGraphInput[]): ConceptGraph {
  const names = concepts.map((c) => c.name);
  const known = new Set(names);

  // 1. Raw edges (prereq → concept), unknown names and self-loops dropped, duplicates merged.
  const out = new Map<string, Set<string>>(names.map((n) => [n, new Set()]));
  let total = 0;
  for (const c of concepts)
    for (const p of c.prerequisites)
      if (known.has(p) && p !== c.name && !out.get(p)!.has(c.name)) {
        out.get(p)!.add(c.name);
        total++;
      }

  // 2. Break cycles: DFS in input order, drop back edges.
  const state = new Map<string, 0 | 1 | 2>(); // 0 new, 1 on stack, 2 done
  const dag = new Map<string, string[]>(names.map((n) => [n, []]));
  const visit = (u: string) => {
    state.set(u, 1);
    for (const v of out.get(u)!) {
      const s = state.get(v) ?? 0;
      if (s === 1) continue; // back edge → cycle
      dag.get(u)!.push(v);
      if (s === 0) visit(v);
    }
    state.set(u, 2);
  };
  for (const n of names) if (!state.get(n)) visit(n);

  // 3. Topological order (reverse post-order on the DAG).
  const topo: string[] = [];
  const seen = new Set<string>();
  const post = (u: string) => {
    seen.add(u);
    for (const v of dag.get(u)!) if (!seen.has(v)) post(v);
    topo.push(u);
  };
  for (const n of names) if (!seen.has(n)) post(n);
  topo.reverse();

  // 4. Transitive reduction: keep u→v only if v is not reachable from another child of u.
  const reach = new Map<string, Set<string>>(); // descendants, computed bottom-up
  for (const u of [...topo].reverse()) {
    const r = new Set<string>();
    for (const v of dag.get(u)!) {
      r.add(v);
      reach.get(v)!.forEach((x) => r.add(x));
    }
    reach.set(u, r);
  }
  const edges: [string, string][] = [];
  for (const u of names)
    for (const v of dag.get(u)!) {
      const redundant = dag.get(u)!.some((w) => w !== v && reach.get(w)!.has(v));
      if (!redundant) edges.push([u, v]);
    }

  const parents = new Map<string, string[]>(names.map((n) => [n, []]));
  const children = new Map<string, string[]>(names.map((n) => [n, []]));
  for (const [u, v] of edges) {
    children.get(u)!.push(v);
    parents.get(v)!.push(u);
  }

  // 5. Level = longest chain of prerequisites below the concept.
  const levelOf = new Map<string, number>();
  for (const u of topo) levelOf.set(u, Math.max(0, ...parents.get(u)!.map((p) => levelOf.get(p)! + 1)));

  // 6. Order inside levels: start in input order, then a few barycenter sweeps (down, then up).
  const depth = Math.max(0, ...levelOf.values()) + 1;
  const levels: string[][] = Array.from({ length: depth }, () => []);
  for (const n of names) levels[levelOf.get(n)!].push(n);
  const pos = new Map<string, number>();
  const index = () => levels.forEach((col) => col.forEach((n, i) => pos.set(n, i)));
  const sortBy = (col: string[], neighbours: (n: string) => string[]) => {
    const key = new Map(
      col.map((n, i) => {
        const ns = neighbours(n);
        return [n, ns.length ? ns.reduce((s, x) => s + pos.get(x)!, 0) / ns.length : i];
      }),
    );
    col.sort((a, b) => key.get(a)! - key.get(b)!);
  };
  index();
  for (let sweep = 0; sweep < 3; sweep++) {
    for (let l = 1; l < depth; l++) {
      sortBy(levels[l], (n) => parents.get(n)!);
      index();
    }
    for (let l = depth - 2; l >= 0; l--) {
      sortBy(levels[l], (n) => children.get(n)!);
      index();
    }
  }

  return { levels, levelOf, edges, parents, children, removed: total - edges.length };
}

/** All prerequisites of a concept, transitively (not including itself). */
export function ancestorsOf(g: ConceptGraph, name: string): Set<string> {
  return walk(name, (n) => g.parents.get(n) ?? []);
}

/** All concepts that depend on this one, transitively (not including itself). */
export function descendantsOf(g: ConceptGraph, name: string): Set<string> {
  return walk(name, (n) => g.children.get(n) ?? []);
}

function walk(start: string, next: (n: string) => string[]): Set<string> {
  const out = new Set<string>();
  const stack = [...next(start)];
  while (stack.length) {
    const n = stack.pop()!;
    if (out.has(n) || n === start) continue;
    out.add(n);
    stack.push(...next(n));
  }
  return out;
}
