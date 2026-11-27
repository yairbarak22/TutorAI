import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaContentBlockParam, BetaMessageParam, BetaTextBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { z } from "zod";
import type { ChatTurn, LLMApi, LLMCallOptions, Tier } from "@tutorai/sdk";
import { t } from "@tutorai/sdk";

export interface ModelConfig {
  fast: string;
  smart: string;
}

/** Defaults: the current Opus for quality work, the current Haiku for bulk extraction. */
export const DEFAULT_MODELS: ModelConfig = { fast: "claude-haiku-5-5", smart: "claude-sonnet-5-5" };

export interface UsageEvent {
  tag: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
}

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly kind: "auth" | "rate_limit" | "budget_limit" | "refusal" | "invalid_output" | "network" | "other",
    /** For rate_limit from a subscription plan: when the limit resets (ISO time), if known. */
    public readonly resetAt?: string,
  ) {
    super(message);
  }
}

/** Models that accept the server-side refusal fallback. */
const supportsFallback = (model: string) => /^claude-(opus-5|sonnet-5-5|fable-5)/.test(model);

/**
 * Claude via the official Anthropic SDK, called directly from the student's browser with
 * the student's own key (the key never touches a TutorAI server — there is none).
 */
export class AnthropicLLM implements LLMApi {
  private client: Anthropic;
  constructor(
    apiKey: string,
    private models: ModelConfig = DEFAULT_MODELS,
    private onUsage?: (u: UsageEvent) => void,
  ) {
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 3 });
  }

  private model(tier: Tier = "smart") {
    return tier === "fast" ? this.models.fast : this.models.smart;
  }

  private system(opts: LLMCallOptions): BetaTextBlockParam[] {
    const blocks: BetaTextBlockParam[] = [];
    if (opts.system) blocks.push({ type: "text", text: opts.system });
    if (opts.context)
      blocks.push({
        type: "text",
        text: `Relevant course material:\n\n${opts.context}`,
        cache_control: { type: "ephemeral" },
      });
    return blocks;
  }

  private userContent(opts: LLMCallOptions): BetaContentBlockParam[] {
    const content: BetaContentBlockParam[] = (opts.images ?? []).map((img) => ({
      type: "image" as const,
      source: { type: "base64" as const, media_type: img.mediaType, data: img.base64 },
    }));
    content.push({ type: "text", text: opts.prompt });
    return content;
  }

  private common(opts: LLMCallOptions, history: ChatTurn[] = []) {
    const model = this.model(opts.tier);
    const messages: BetaMessageParam[] = [
      ...history.map((t) => ({ role: t.role, content: t.content })),
      { role: "user", content: this.userContent(opts) },
    ];
    return {
      model,
      max_tokens: opts.maxTokens ?? 16000,
      system: this.system(opts),
      messages,
      ...(supportsFallback(model)
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
    };
  }

  private track(tag: string | undefined, model: string, usage: Anthropic.Beta.BetaUsage | undefined) {
    if (!usage) return;
    this.onUsage?.({
      tag: tag ?? "",
      model,
      input: usage.input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
    });
  }

  async object<S extends z.ZodType>(schema: S, opts: LLMCallOptions): Promise<z.infer<S>> {
    const params = this.common(opts);
    try {
      // Streamed even though we only need the final result: large max_tokens requests
      // are refused by the SDK unless streamed (long-request timeout guard).
      const stream = this.client.beta.messages.stream({
        ...params,
        output_config: {
          format: betaZodOutputFormat(schema),
          effort: opts.tier === "fast" ? "low" : "medium",
        },
      });
      if (opts.onOutput) stream.on("text", (_delta, snapshot) => opts.onOutput!(snapshot.length));
      const res = await stream.finalMessage();
      this.track(opts.tag, params.model, res.usage);
      if (res.stop_reason === "refusal") throw new LLMError(t("המודל סירב לבקשה הזו.", "The model declined this request."), "refusal");
      if (res.stop_reason === "max_tokens") throw new LLMError(t("התשובה נקטעה (ארוכה מדי). נסו היקף קטן יותר.", "The answer was cut off (too long). Try a smaller scope."), "invalid_output");
      if (res.parsed_output == null) throw new LLMError(t("המודל החזיר תשובה במבנה לא תקין.", "The model returned an answer in an invalid format."), "invalid_output");
      return res.parsed_output as z.infer<S>;
    } catch (e) {
      throw toLLMError(e);
    }
  }

  async text(opts: LLMCallOptions): Promise<string> {
    return this.stream(opts, () => {});
  }

  async stream(opts: LLMCallOptions & { history?: ChatTurn[] }, onDelta: (t: string) => void): Promise<string> {
    const params = this.common(opts, opts.history);
    try {
      const stream = this.client.beta.messages.stream({
        ...params,
        output_config: { effort: opts.tier === "fast" ? "low" : "medium" },
      });
      let text = "";
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          text += event.delta.text;
          onDelta(event.delta.text);
          opts.onOutput?.(text.length);
        }
      }
      const final = await stream.finalMessage();
      this.track(opts.tag, params.model, final.usage);
      if (final.stop_reason === "refusal") throw new LLMError(t("המודל סירב לבקשה הזו.", "The model declined this request."), "refusal");
      return text;
    } catch (e) {
      throw toLLMError(e);
    }
  }
}

function isBudgetExhaustedError(e: InstanceType<typeof Anthropic.APIError>): boolean {
  if (e instanceof Anthropic.PaymentRequiredError || e.status === 402) return true;
  return /(credit|balance|billing|budget|spend|quota)/i.test(e.message);
}

export function toLLMError(e: unknown): LLMError {
  if (e instanceof LLMError) return e;
  if (e instanceof Anthropic.AuthenticationError) return new LLMError(t("מפתח ה-API לא תקין. בדקו אותו בהגדרות.", "The API key is invalid. Check it in Settings."), "auth");
  if (e instanceof Anthropic.PermissionDeniedError) return new LLMError(t("למפתח אין הרשאה למודל הזה.", "This key has no access to this model."), "auth");
  if (e instanceof Anthropic.RateLimitError) {
    return isBudgetExhaustedError(e)
      ? new LLMError(
          t(
            "נגמרה יתרת האשראי או התקציב של מפתח ה-API. בדקו ב-console.anthropic.com או עברו למצב הדגמה.",
            "Your API key hit its spending limit or ran out of credit. Check console.anthropic.com or switch to demo mode.",
          ),
          "budget_limit",
        )
      : new LLMError(
          t(
            "הגעתם למגבלת הבקשות או התקציב של ה-API (429). נסו שוב בעוד דקה, בדקו ב-console.anthropic.com או עברו למצב הדגמה.",
            "You hit the API rate or spending limit (429). Try again in a minute, check console.anthropic.com, or switch to demo mode.",
          ),
          "rate_limit",
        );
  }
  if (e instanceof Anthropic.APIConnectionError) return new LLMError(t("אין חיבור לשרת של Anthropic. בדקו את האינטרנט.", "Can't reach Anthropic's servers. Check your internet connection."), "network");
  if (e instanceof Anthropic.APIError) {
    if (isBudgetExhaustedError(e)) {
      return new LLMError(
        t(
          "נגמרה יתרת האשראי או התקציב של מפתח ה-API. בדקו ב-console.anthropic.com או עברו למצב הדגמה.",
          "Your API key hit its spending limit or ran out of credit. Check console.anthropic.com or switch to demo mode.",
        ),
        "budget_limit",
      );
    }
    return new LLMError(`${t("שגיאת API", "API error")} (${e.status}): ${e.message}`, "other");
  }
  return new LLMError(e instanceof Error ? e.message : String(e), "other");
}

/** Cheap key check used by onboarding. */
export async function verifyApiKey(apiKey: string, model = DEFAULT_MODELS.fast): Promise<true | string> {
  try {
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
    await client.models.retrieve(model);
    return true;
  } catch (e) {
    return toLLMError(e).message;
  }
}
