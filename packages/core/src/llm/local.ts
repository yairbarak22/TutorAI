import { z } from "zod";
import type { ChatTurn, LLMApi, LLMCallOptions, LLMLimits, Tier } from "@tutorai/sdk";
import { t } from "@tutorai/sdk";
import { LLMError, type UsageEvent } from "./anthropic.ts";

/**
 * Open-source models running on the student's own computer — no key, no cost.
 *
 *  - "ollama": Ollama's native API (default http://localhost:11434). Preferred: it lets us set the
 *    context window (num_ctx), turn off "thinking", and constrain output to a JSON schema.
 *  - "openai": any OpenAI-compatible server (LM Studio on :1234, llama.cpp server, vLLM, …).
 *
 * The browser calls the server directly, so the server must allow this site's origin
 * (Ollama: OLLAMA_ORIGINS; LM Studio: "Enable CORS").
 */
export type LocalFlavor = "ollama" | "openai";

export interface LocalConfig {
  baseUrl: string;
  flavor: LocalFlavor;
  fast: string;
  smart: string;
  /** Context window to request, in tokens. */
  contextTokens: number;
  /** Whether the chosen models read images (scanned-page OCR). */
  vision: boolean;
}

export const DEFAULT_LOCAL: LocalConfig = {
  baseUrl: "http://localhost:11434",
  flavor: "ollama",
  fast: "",
  smart: "",
  contextTokens: 16384,
  vision: false,
};

/** Hebrew runs ~2.5 characters per token on common open tokenizers; keep half the window for instructions and output. */
export const localContextChars = (contextTokens: number) => Math.max(6000, Math.floor(contextTokens * 0.5 * 2.5));

type Fetch = typeof fetch;

export class LocalLLM implements LLMApi {
  constructor(
    private cfg: LocalConfig,
    private onUsage?: (u: UsageEvent) => void,
    private fetchFn: Fetch = (...a) => fetch(...a),
  ) {}

  limitsFor(): LLMLimits {
    return { contextChars: localContextChars(this.cfg.contextTokens), vision: this.cfg.vision };
  }

  private model(tier: Tier = "smart") {
    return (tier === "fast" ? this.cfg.fast : this.cfg.smart) || this.cfg.smart || this.cfg.fast;
  }

  private messages(opts: LLMCallOptions, history: ChatTurn[] = [], extraSystem = "") {
    const system = [opts.system, opts.context ? `Relevant course material:\n\n${opts.context}` : "", extraSystem].filter(Boolean).join("\n\n");
    const images = opts.images ?? [];
    const user =
      this.cfg.flavor === "ollama"
        ? { role: "user", content: opts.prompt, ...(images.length ? { images: images.map((i) => i.base64) } : {}) }
        : {
            role: "user",
            content: images.length
              ? [...images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mediaType};base64,${i.base64}` } })), { type: "text", text: opts.prompt }]
              : opts.prompt,
          };
    return [...(system ? [{ role: "system", content: system }] : []), ...history.map((h) => ({ role: h.role, content: h.content })), user];
  }

  /** One streamed chat call. Returns the visible text (reasoning blocks removed). */
  private async chat(
    opts: LLMCallOptions & { history?: ChatTurn[] },
    onDelta: (d: string) => void,
    format?: Record<string, unknown>,
    extraSystem = "",
  ): Promise<string> {
    const model = this.model(opts.tier);
    if (!model) throw new LLMError(t("לא נבחר מודל מקומי. בחרו מודל בהגדרות.", "No local model selected. Pick one in Settings."), "other");
    const maxOut = Math.min(opts.maxTokens ?? 4096, Math.floor(this.cfg.contextTokens / 2));
    const messages = this.messages(opts, opts.history, extraSystem);
    const base = this.cfg.baseUrl.replace(/\/+$/, "");

    const send = (withThink: boolean) =>
      this.cfg.flavor === "ollama"
        ? this.post(`${base}/api/chat`, {
            model,
            messages,
            stream: true,
            ...(format ? { format } : {}),
            ...(withThink ? { think: false } : {}),
            options: { num_ctx: this.cfg.contextTokens, num_predict: maxOut, temperature: format ? 0.2 : 0.6 },
          })
        : this.post(`${base}/v1/chat/completions`, {
            model,
            messages,
            stream: true,
            stream_options: { include_usage: true },
            max_tokens: maxOut,
            temperature: format ? 0.2 : 0.6,
            ...(format ? { response_format: { type: "json_schema", json_schema: { name: "output", strict: true, schema: format } } } : {}),
          });

    let res = await send(true);
    // Models without a reasoning mode may reject the "think" flag — retry without it.
    if (!res.ok && this.cfg.flavor === "ollama") {
      const body = await res.clone().text();
      if (/think/i.test(body)) res = await send(false);
    }
    if (!res.ok) throw await httpError(res, model);
    if (!res.body) throw new LLMError(t("השרת המקומי לא החזיר תשובה.", "The local server returned no response."), "other");

    const stripper = thinkStripper(onDelta, opts.onOutput);
    let input = 0;
    let output = 0;
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (this.cfg.flavor === "ollama") {
          const j = JSON.parse(line);
          if (j.error) throw new LLMError(String(j.error), "other");
          if (j.message?.content) stripper.push(j.message.content);
          if (j.done) {
            input = j.prompt_eval_count ?? 0;
            output = j.eval_count ?? 0;
          }
        } else {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          const j = JSON.parse(data);
          if (j.error) throw new LLMError(String(j.error.message ?? j.error), "other");
          const d = j.choices?.[0]?.delta?.content;
          if (d) stripper.push(d);
          if (j.usage) {
            input = j.usage.prompt_tokens ?? 0;
            output = j.usage.completion_tokens ?? 0;
          }
        }
      }
    }
    this.onUsage?.({ tag: opts.tag ?? "", model: `local:${model}`, input, output, cacheRead: 0 });
    return stripper.end();
  }

  private async post(url: string, body: unknown): Promise<Response> {
    try {
      return await this.fetchFn(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch {
      throw new LLMError(
        t(
          `אין חיבור למודל המקומי (${this.cfg.baseUrl}). ודאו שהשרת פועל ושהאתר מורשה לגשת אליו (בהגדרות → מודל AI יש הוראות).`,
          `Can't reach the local model (${this.cfg.baseUrl}). Make sure the server is running and allows this site (see Settings → AI model).`,
        ),
        "network",
      );
    }
  }

  async object<S extends z.ZodType>(schema: S, opts: LLMCallOptions): Promise<z.infer<S>> {
    const json = z.toJSONSchema(schema, { target: "draft-7", io: "input" }) as Record<string, unknown>;
    const rule = `Answer with a single JSON value that matches this JSON Schema, and nothing else:\n${JSON.stringify(json)}`;
    let last = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const prompt =
        attempt === 0
          ? opts.prompt
          : `${opts.prompt}\n\nYour previous answer was not valid (${last}). Answer again with valid JSON only.`;
      const text = await this.chat({ ...opts, prompt }, () => {}, json, rule);
      const parsed = parseJsonLoose(text);
      if (parsed === undefined) {
        last = "not JSON";
        continue;
      }
      const r = schema.safeParse(parsed);
      if (r.success) return r.data;
      last = r.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
        .join("; ");
    }
    throw new LLMError(
      t("המודל המקומי החזיר תשובה במבנה לא תקין. נסו שוב או מודל גדול יותר.", "The local model returned an invalid structure. Try again or use a larger model."),
      "invalid_output",
    );
  }

  async text(opts: LLMCallOptions): Promise<string> {
    return this.chat(opts, () => {});
  }

  async stream(opts: LLMCallOptions & { history?: ChatTurn[] }, onDelta: (text: string) => void): Promise<string> {
    return this.chat(opts, onDelta);
  }
}

/** Sends fast-tier calls to one backend and smart-tier calls to another (e.g. local + Claude). */
export class TieredLLM implements LLMApi {
  constructor(
    private fast: LLMApi,
    private smart: LLMApi,
  ) {}
  private pick(tier: Tier = "smart") {
    return tier === "fast" ? this.fast : this.smart;
  }
  limitsFor(tier: Tier) {
    return this.pick(tier).limitsFor?.(tier);
  }
  object<S extends z.ZodType>(schema: S, opts: LLMCallOptions) {
    return this.pick(opts.tier).object(schema, opts);
  }
  text(opts: LLMCallOptions) {
    return this.pick(opts.tier).text(opts);
  }
  stream(opts: LLMCallOptions & { history?: ChatTurn[] }, onDelta: (text: string) => void) {
    return this.pick(opts.tier).stream(opts, onDelta);
  }
}

/** Models installed on the local server (for the settings picker). Throws an LLMError when unreachable. */
export async function listLocalModels(baseUrl: string, flavor: LocalFlavor, fetchFn: Fetch = (...a) => fetch(...a)): Promise<string[]> {
  const base = baseUrl.replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetchFn(flavor === "ollama" ? `${base}/api/tags` : `${base}/v1/models`);
  } catch {
    throw new LLMError(
      t(`אין חיבור ל-${baseUrl}. ודאו שהשרת פועל ושהאתר מורשה לגשת אליו.`, `Can't reach ${baseUrl}. Make sure the server is running and allows this site.`),
      "network",
    );
  }
  if (!res.ok) throw await httpError(res, "");
  const j = await res.json();
  const names: string[] = flavor === "ollama" ? (j.models ?? []).map((m: { name: string }) => m.name) : (j.data ?? []).map((m: { id: string }) => m.id);
  return names.filter((n) => !/embed/i.test(n)).sort();
}

async function httpError(res: Response, model: string): Promise<LLMError> {
  const body = await res.text().catch(() => "");
  if (res.status === 404 && model && /not found|pull/i.test(body))
    return new LLMError(t(`המודל "${model}" לא מותקן. התקינו אותו: ollama pull ${model}`, `The model "${model}" isn't installed. Install it: ollama pull ${model}`), "other");
  if (res.status === 403)
    return new LLMError(t("השרת המקומי חסם את הבקשה. צריך לאשר את כתובת האתר (OLLAMA_ORIGINS).", "The local server blocked the request. Allow this site's address (OLLAMA_ORIGINS)."), "auth");
  let msg = body;
  try {
    const j = JSON.parse(body);
    msg = j.error?.message ?? j.error ?? body;
  } catch {
    /* plain text */
  }
  return new LLMError(`${t("שגיאה מהמודל המקומי", "Local model error")} (${res.status}): ${String(msg).slice(0, 300)}`, "other");
}

/**
 * Removes <think>…</think> reasoning blocks from streamed text, holding back a possible partial tag
 * so it never flashes on screen.
 */
export function thinkStripper(onDelta: (d: string) => void, onOutput?: (chars: number) => void) {
  let raw = "";
  let shown = 0;
  const visible = (final: boolean) => {
    let v = raw.replace(/<think>[\s\S]*?<\/think>/g, "");
    const open = v.indexOf("<think>");
    if (open >= 0) v = v.slice(0, open);
    else if (!final) {
      const lt = v.lastIndexOf("<");
      if (lt >= 0 && v.length - lt < 8 && "<think>".startsWith(v.slice(lt))) v = v.slice(0, lt);
    }
    return final ? v.replace(/^\s+/, "") : v.replace(/^\s+/, "");
  };
  const flush = (final: boolean) => {
    const v = visible(final);
    if (v.length > shown) {
      onDelta(v.slice(shown));
      shown = v.length;
      onOutput?.(shown);
    }
    return v;
  };
  return {
    push(d: string) {
      raw += d;
      flush(false);
    },
    end() {
      return flush(true).trim();
    },
  };
}

/** Parses JSON from model output that may be wrapped in a code fence or surrounded by text. */
export function parseJsonLoose(text: string): unknown {
  const s = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [s, fenced?.[1] ?? ""];
  const start = s.search(/[[{]/);
  if (start >= 0) candidates.push(s.slice(start, Math.max(s.lastIndexOf("}"), s.lastIndexOf("]")) + 1));
  for (const c of candidates) {
    if (!c.trim()) continue;
    try {
      return JSON.parse(c);
    } catch {
      /* next */
    }
  }
  return undefined;
}
