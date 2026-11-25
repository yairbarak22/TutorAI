import type { z } from "zod";
import type { ChatTurn, LLMApi, LLMCallOptions } from "@ruecai/sdk";

/**
 * Deterministic LLM used for:
 *  - CI evals (no API key, no cost) — runs the full tool pipeline against recorded outputs,
 *  - "מצב הדגמה" (demo mode) in the app, clearly labeled, so people can try the UI,
 *  - end-to-end browser tests.
 *
 * Responses are looked up by `opts.tag`. Citations in fixtures are written as S1..Sn and
 * remapped to the real section ids present in the request context, in order.
 */
export class MockLLM implements LLMApi {
  calls: { tag?: string; prompt: string; context?: string }[] = [];

  constructor(
    private fixtures: Record<string, unknown>,
    private options: { delayMs?: number } = {},
  ) {}

  private ids(opts: LLMCallOptions): string[] {
    const src = `${opts.context ?? ""}\n${opts.prompt}`;
    return [...new Set([...src.matchAll(/id="(S\d+)"/g)].map((m) => m[1]))];
  }

  private remap<T>(value: T, ids: string[]): T {
    if (!ids.length) return value;
    const json = JSON.stringify(value).replace(/"S(\d+)"/g, (_m, n) => `"${ids[(Number(n) - 1) % ids.length]}"`);
    return JSON.parse(json.replace(/\[S(\d+)\]/g, (_m, n) => `[${ids[(Number(n) - 1) % ids.length]}]`));
  }

  private find(tag: string | undefined): unknown {
    if (!tag) throw new Error("MockLLM: call without tag");
    const key = Object.keys(this.fixtures).find((k) => k === tag) ?? Object.keys(this.fixtures).find((k) => tag.startsWith(k));
    if (!key) throw new Error(`MockLLM: no fixture for "${tag}"`);
    return structuredClone(this.fixtures[key]);
  }

  private async wait() {
    if (this.options.delayMs) await new Promise((r) => setTimeout(r, this.options.delayMs));
  }

  async object<S extends z.ZodType>(schema: S, opts: LLMCallOptions): Promise<z.infer<S>> {
    this.calls.push({ tag: opts.tag, prompt: opts.prompt, context: opts.context });
    await this.wait();
    const ids = this.ids(opts);
    return schema.parse(this.remap(this.find(opts.tag), ids));
  }

  async text(opts: LLMCallOptions): Promise<string> {
    return this.stream(opts, () => {});
  }

  async stream(opts: LLMCallOptions & { history?: ChatTurn[] }, onDelta: (t: string) => void): Promise<string> {
    this.calls.push({ tag: opts.tag, prompt: opts.prompt, context: opts.context });
    const raw = this.find(opts.tag);
    const text = this.remap(typeof raw === "string" ? raw : JSON.stringify(raw), this.ids(opts));
    const chunks = text.match(/[\s\S]{1,24}/g) ?? [];
    for (const c of chunks) {
      if (this.options.delayMs) await new Promise((r) => setTimeout(r, Math.min(15, this.options.delayMs!)));
      onDelta(c);
    }
    return text;
  }
}
