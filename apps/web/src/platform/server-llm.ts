import { z } from "zod";
import { LLMError, type UsageEvent } from "@tutorai/core";
import type { LocalProvider, LLMEvent, LLMRequest } from "@tutorai/local-api";
import { t, type ChatTurn, type LLMApi, type LLMCallOptions } from "@tutorai/sdk";
import { localApi } from "./local-server.ts";

/**
 * A model reached through TutorAI Local: the student's Claude plan (via the official Claude Code)
 * or ChatGPT plan (via Sign in with ChatGPT). The server streams events; validation of structured
 * output happens here with the tool's own Zod schema.
 */

type Call = (req: LLMRequest) => AsyncIterable<LLMEvent>;

export const stripFences = (s: string) => {
  const m = s.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : s.trim();
};

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function toLLMError(e: Extract<LLMEvent, { type: "error" }>, provider: LocalProvider): LLMError {
  const plan = provider === "claude-code" ? "Claude" : "ChatGPT";
  switch (e.kind) {
    case "rate_limit":
      return new LLMError(
        e.resetAt
          ? t(`הגעתם למגבלת השימוש של מנוי ${plan}. היא מתאפסת ב-${hhmm(e.resetAt)}.`, `You reached your ${plan} plan's usage limit. It resets at ${hhmm(e.resetAt)}.`)
          : t(`הגעתם למגבלת השימוש של מנוי ${plan}. נסו שוב מאוחר יותר.`, `You reached your ${plan} plan's usage limit. Try again later.`),
        "rate_limit",
        e.resetAt,
      );
    case "not_installed":
      return new LLMError(t("Claude Code לא מותקן. אפשר להתקין אותו בהגדרות ← חיבור.", "Claude Code isn't installed. You can install it in Settings → Connection."), "auth");
    case "not_eligible":
      return new LLMError(t("המנוי שלכם לא כולל את זה (נדרש Plus או Pro).", "Your plan doesn't include this (Plus or Pro is needed)."), "auth");
    case "auth":
      return new LLMError(t(`צריך להתחבר שוב ל-${plan}. אפשר לעשות את זה בהגדרות ← חיבור.`, `Sign in to ${plan} again in Settings → Connection.`), "auth");
    case "network":
      return new LLMError(e.message || t("אין חיבור למודל. נסו שוב.", "Couldn't reach the model. Try again."), "network");
    case "refusal":
    case "invalid_output":
      return new LLMError(e.message, e.kind);
    default:
      return new LLMError(e.message || t("שגיאה במודל.", "Model error."), "other");
  }
}

export class ServerLLM implements LLMApi {
  constructor(
    private provider: LocalProvider,
    private onUsage?: (u: UsageEvent) => void,
    private callFn: Call = (req) => localApi.llm(req),
  ) {}

  private request(opts: LLMCallOptions, extra: Partial<LLMRequest> = {}): LLMRequest {
    return {
      provider: this.provider,
      tier: opts.tier ?? "smart",
      system: opts.system,
      context: opts.context,
      prompt: opts.prompt,
      images: opts.images,
      maxTokens: opts.maxTokens,
      tag: opts.tag,
      ...extra,
    };
  }

  private async run(req: LLMRequest, onDelta?: (d: string) => void, onOutput?: (chars: number) => void) {
    let text = "";
    for await (const e of this.callFn(req)) {
      if (e.type === "delta") {
        text += e.text;
        onDelta?.(e.text);
        onOutput?.(text.length);
      } else if (e.type === "result") {
        this.onUsage?.({ tag: req.tag ?? "", model: e.model, input: e.usage.input, output: e.usage.output, cacheRead: e.usage.cacheRead });
        return e;
      } else throw toLLMError(e, this.provider);
    }
    throw new LLMError(t("החיבור למודל נקטע. נסו שוב.", "The connection to the model was cut. Try again."), "network");
  }

  async object<S extends z.ZodType>(schema: S, opts: LLMCallOptions): Promise<z.infer<S>> {
    const jsonSchema = z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" }) as Record<string, unknown>;
    let prompt = opts.prompt;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.run(this.request({ ...opts, prompt }, { jsonSchema }), undefined, opts.onOutput);
      let value: unknown = res.json;
      if (value === undefined) {
        try {
          value = JSON.parse(stripFences(res.text));
        } catch {
          value = undefined;
        }
      }
      const parsed = schema.safeParse(value);
      if (parsed.success) return parsed.data;
      const issues = parsed.error.issues
        .slice(0, 8)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      prompt = `${opts.prompt}\n\nYour previous reply did not match the required JSON schema (${issues}). Reply again with only a JSON object that matches it.`;
    }
    throw new LLMError(t("המודל החזיר תשובה במבנה לא תקין.", "The model returned an answer in an invalid format."), "invalid_output");
  }

  async text(opts: LLMCallOptions): Promise<string> {
    return (await this.run(this.request(opts), undefined, opts.onOutput)).text;
  }

  async stream(opts: LLMCallOptions & { history?: ChatTurn[] }, onDelta: (text: string) => void): Promise<string> {
    const res = await this.run(this.request(opts, { history: opts.history }), onDelta, opts.onOutput);
    return res.text;
  }
}
