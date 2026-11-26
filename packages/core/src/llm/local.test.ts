import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_LOCAL, LocalLLM, TieredLLM, listLocalModels, parseJsonLoose, thinkStripper } from "./local.ts";

/** A fetch that answers every POST with the given streamed lines and records the request bodies. */
function fakeFetch(replies: string[][], seen: unknown[] = []) {
  let i = 0;
  return (async (url: string, init?: RequestInit) => {
    if (!init?.method) return new Response(JSON.stringify({ models: [{ name: "qwen3:8b" }, { name: "nomic-embed-text" }] }));
    seen.push(JSON.parse(String(init.body)));
    const lines = replies[Math.min(i++, replies.length - 1)];
    return new Response(lines.join("\n") + "\n");
  }) as unknown as typeof fetch;
}
const ollama = (chunks: string[]) => [
  ...chunks.map((c) => JSON.stringify({ message: { content: c }, done: false })),
  JSON.stringify({ message: { content: "" }, done: true, prompt_eval_count: 10, eval_count: 5 }),
];

describe("LocalLLM (ollama)", () => {
  const cfg = { ...DEFAULT_LOCAL, fast: "qwen3:1.7b", smart: "qwen3:8b" };

  it("streams text, hides reasoning and reports usage", async () => {
    const usage: unknown[] = [];
    const seen: Record<string, unknown>[] = [];
    const llm = new LocalLLM(cfg, (u) => usage.push(u), fakeFetch([ollama(["<thi", "nk>hmm</think>", "שלום ", "עולם"])], seen));
    const deltas: string[] = [];
    const out = await llm.stream({ prompt: "hi", tier: "fast", system: "sys", context: "material" }, (d) => deltas.push(d));
    expect(out).toBe("שלום עולם");
    expect(deltas.join("")).toBe("שלום עולם");
    expect(seen[0].model).toBe("qwen3:1.7b");
    expect((seen[0].options as { num_ctx: number }).num_ctx).toBe(16384);
    expect(JSON.stringify(seen[0].messages)).toContain("material");
    expect(usage).toEqual([{ tag: "", model: "local:qwen3:1.7b", input: 10, output: 5, cacheRead: 0 }]);
  });

  it("returns schema-valid objects and retries once on invalid output", async () => {
    const S = z.object({ title: z.string(), n: z.number() });
    const seen: Record<string, unknown>[] = [];
    const llm = new LocalLLM(cfg, undefined, fakeFetch([ollama(['{"title": 3}']), ollama(['```json\n{"title":"א","n":2}\n```'])], seen));
    await expect(llm.object(S, { prompt: "go" })).resolves.toEqual({ title: "א", n: 2 });
    expect(seen).toHaveLength(2);
    expect(seen[0].format).toMatchObject({ type: "object" });
    expect(JSON.stringify(seen[1].messages)).toContain("not valid");
  });

  it("reports small-context limits for retrieval", () => {
    expect(new LocalLLM({ ...cfg, contextTokens: 8192 }).limitsFor().contextChars).toBe(10240);
  });

  it("explains an unreachable server", async () => {
    const llm = new LocalLLM(cfg, undefined, (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch);
    await expect(llm.text({ prompt: "x" })).rejects.toMatchObject({ kind: "network" });
  });
});

describe("LocalLLM (openai-compatible)", () => {
  it("parses SSE deltas", async () => {
    const sse = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "a" } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "b" } }], usage: { prompt_tokens: 3, completion_tokens: 2 } })}`,
      "data: [DONE]",
    ];
    const seen: Record<string, unknown>[] = [];
    const llm = new LocalLLM({ ...DEFAULT_LOCAL, flavor: "openai", baseUrl: "http://localhost:1234", smart: "m" }, undefined, fakeFetch([sse], seen));
    expect(await llm.text({ prompt: "x" })).toBe("ab");
    expect(seen[0].max_tokens).toBeGreaterThan(0);
  });
});

describe("helpers", () => {
  it("lists models without embedding models", async () => {
    expect(await listLocalModels("http://localhost:11434", "ollama", fakeFetch([[]]))).toEqual(["qwen3:8b"]);
  });
  it("parses loose JSON", () => {
    expect(parseJsonLoose('Sure! {"a":1} done')).toEqual({ a: 1 });
    expect(parseJsonLoose("nope")).toBeUndefined();
  });
  it("strips an unfinished reasoning block", () => {
    const out: string[] = [];
    const s = thinkStripper((d) => out.push(d));
    s.push("<think>still thinking");
    expect(s.end()).toBe("");
    expect(out).toEqual([]);
  });
  it("routes tiers", async () => {
    const mk = (name: string) => ({ object: async () => name, text: async () => name, stream: async () => name });
    const r = new TieredLLM(mk("local") as never, mk("claude") as never);
    expect(await r.text({ prompt: "", tier: "fast" })).toBe("local");
    expect(await r.text({ prompt: "", tier: "smart" })).toBe("claude");
  });
});
