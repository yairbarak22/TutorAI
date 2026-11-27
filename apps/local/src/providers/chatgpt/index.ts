import { z } from "zod";
import { PLAN_MODEL_PREFIX, type Connections, type ErrorKind, type LLMEvent, type LLMRequest } from "@tutorai/local-api";
import { loadSettings, saveSettings } from "../../config.ts";
import { log } from "../../log.ts";
import type { ChatgptService, Provider } from "../types.ts";
import { ChatgptOAuth, endpoints } from "./oauth.ts";
import { hasPlanScope } from "./tokens.ts";

/**
 * ChatGPT plan usage through the public Responses API (store:false, stream:true), as OpenAI's
 * open-source contract requires. Never the ChatGPT backend-api.
 */

const ModelsResponse = z.object({
  models: z.array(z.object({ slug: z.string(), display_name: z.string().optional(), visibility: z.string().optional() }).passthrough()),
});

/** Shared with the web app, which marks these as "recommended" in the model picker. */
import { pickChatgptDefaults as pickDefaults } from "@tutorai/local-api";
export { pickDefaults };

/** Maps OpenAI's documented subscription_sharing_* codes (and HTTP statuses) to our error kinds. */
export function mapError(code: string | undefined, status?: number): { kind: ErrorKind; message: string; retry?: boolean } {
  switch (code) {
    case "subscription_sharing_usage_limit_exceeded":
      return { kind: "rate_limit", message: "You've reached your ChatGPT plan's limit. See chatgpt.com/settings/usage." };
    case "subscription_sharing_user_not_eligible":
      return { kind: "not_eligible", message: "Your ChatGPT plan doesn't include this (Plus or Pro is needed)." };
    case "subscription_sharing_usage_unavailable":
    case "subscription_sharing_user_unavailable":
      return { kind: "network", message: "ChatGPT is temporarily unavailable. Try again in a moment.", retry: true };
    case "subscription_sharing_invalid_user":
      return { kind: "auth", message: "Sign in to ChatGPT again." };
    case "subscription_sharing_unsupported_capability":
    case "subscription_sharing_route_not_supported":
      return { kind: "other", message: "ChatGPT plan usage doesn't support this request." };
  }
  if (status === 401) return { kind: "auth", message: "Sign in to ChatGPT again." };
  if (status === 429) return { kind: "rate_limit", message: "ChatGPT is busy or your plan's limit was reached." };
  if (status && status >= 500) return { kind: "network", message: "ChatGPT is temporarily unavailable.", retry: true };
  return { kind: "other", message: `ChatGPT request failed${status ? ` (${status})` : ""}.` };
}

/** The Responses request body: course material as data, earlier turns, images, then the prompt. */
export function buildBody(req: LLMRequest, model: string) {
  const input: unknown[] = [];
  if (req.context) input.push({ role: "user", content: [{ type: "input_text", text: `<course_material>\n${req.context}\n</course_material>` }] });
  for (const h of req.history ?? [])
    input.push({ role: h.role, content: [{ type: h.role === "assistant" ? "output_text" : "input_text", text: h.content }] });
  input.push({
    role: "user",
    content: [
      ...(req.images ?? []).map((i) => ({ type: "input_image", image_url: `data:${i.mediaType};base64,${i.base64}` })),
      { type: "input_text", text: req.prompt },
    ],
  });
  return {
    model,
    ...(req.system ? { instructions: req.system } : {}),
    input,
    store: false,
    stream: true,
    ...(req.jsonSchema ? { text: { format: { type: "json_schema", name: "output", schema: req.jsonSchema, strict: false } } } : {}),
  };
}

/** Reads a Server-Sent Events body into JSON "data" payloads. */
export async function* sse(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      try {
        yield JSON.parse(data);
      } catch {
        /* skip malformed */
      }
    }
  }
}

export function createChatgpt(fetchFn: typeof fetch = (...a) => fetch(...a)): ChatgptService {
  const oauth = new ChatgptOAuth(fetchFn);
  let modelsCache: { at: number; list: { slug: string; name: string }[] } | null = null;

  const listModels = async (token: string) => {
    if (modelsCache && Date.now() - modelsCache.at < 3600_000) return modelsCache.list;
    const r = await fetchFn(`${endpoints().api}/models`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
    if (!r.ok) throw new Error(`models ${r.status}`);
    const parsed = ModelsResponse.parse(await r.json());
    const list = parsed.models.filter((m) => (m.visibility ?? "list") === "list").map((m) => ({ slug: m.slug, name: m.display_name ?? m.slug }));
    modelsCache = { at: Date.now(), list };
    return list;
  };

  const provider: Provider = {
    async call(req, emit, signal) {
      const settings = await loadSettings();
      let auth = await oauth.accessToken();
      if (!auth || !hasPlanScope(auth.credential)) return emit({ type: "error", kind: "auth", message: "Sign in to ChatGPT first." });
      let model = settings.models.chatgpt[req.tier];
      if (!model) {
        const defaults = pickDefaults(await listModels(auth.token));
        await saveSettings({ models: { ...settings.models, chatgpt: defaults } });
        model = defaults[req.tier];
      }

      let emittedDelta = false;
      for (let attempt = 0; attempt < 4; attempt++) {
        if (signal.aborted) return;
        const res = await fetchFn(`${endpoints().api}/responses`, {
          method: "POST",
          headers: { authorization: `Bearer ${auth!.token}`, "content-type": "application/json", accept: "text/event-stream" },
          body: JSON.stringify(buildBody(req, model)),
          signal,
        });
        if (!res.ok || !res.body) {
          const err = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
          if (res.status === 401 && attempt === 0) {
            auth = await oauth.accessToken(true);
            if (!auth) return emit({ type: "error", kind: "auth", message: "Sign in to ChatGPT again." });
            continue;
          }
          const m = mapError(err.error?.code, res.status);
          if (m.retry && attempt < 3) {
            await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
            continue;
          }
          return emit({ type: "error", kind: m.kind, message: m.message });
        }

        let text = "";
        let retry = false;
        for await (const ev of sse(res.body)) {
          const type = ev.type as string;
          if (type === "response.output_text.delta" && typeof ev.delta === "string") {
            text += ev.delta;
            emittedDelta = true;
            emit({ type: "delta", text: ev.delta });
          } else if (type === "response.completed") {
            const usage = ((ev.response as Record<string, unknown>)?.usage ?? {}) as {
              input_tokens?: number;
              output_tokens?: number;
              input_tokens_details?: { cached_tokens?: number };
            };
            let json: unknown;
            if (req.jsonSchema) {
              try {
                json = JSON.parse(text);
              } catch {
                /* the web side validates and repairs */
              }
            }
            return emit({
              type: "result",
              text,
              ...(json !== undefined ? { json } : {}),
              model: PLAN_MODEL_PREFIX + model,
              usage: { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0, cacheRead: usage.input_tokens_details?.cached_tokens ?? 0 },
            });
          } else if (type === "response.failed" || type === "error" || type === "response.incomplete") {
            const code = ((ev.response as { error?: { code?: string } })?.error?.code ?? (ev as { code?: string }).code) as string | undefined;
            const m = type === "response.incomplete" ? { kind: "invalid_output" as const, message: "The answer was cut off." } : mapError(code);
            // Retry a transient failure only before any text reached the student (no duplicated text).
            if ("retry" in m && m.retry && !emittedDelta && attempt < 3) {
              retry = true;
              break;
            }
            return emit({ type: "error", kind: m.kind, message: m.message });
          }
        }
        if (retry) {
          await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
          continue;
        }
        if (signal.aborted) return;
        return emit({ type: "error", kind: "network", message: "The ChatGPT answer stopped before it finished." });
      }
      emit({ type: "error", kind: "network", message: "ChatGPT is temporarily unavailable." });
    },
  };

  return {
    provider,
    async status(): Promise<Connections["chatgpt"]> {
      try {
        const auth = await oauth.accessToken();
        if (!auth || !hasPlanScope(auth.credential)) return { signedIn: false };
        let models: { slug: string; name: string }[] | undefined;
        try {
          models = await listModels(auth.token);
          const s = await loadSettings();
          if (!s.models.chatgpt.smart && models.length) await saveSettings({ models: { ...s.models, chatgpt: pickDefaults(models) } });
        } catch (e) {
          log("warn", `chatgpt models: ${(e as Error).message}`);
        }
        return { signedIn: true, email: auth.credential.email, models };
      } catch (e) {
        log("warn", `chatgpt status: ${(e as Error).message}`);
        return { signedIn: false };
      }
    },
    start: (redirectUri) => oauth.start(redirectUri),
    callback: async (q) => {
      const r = await oauth.callback(q);
      modelsCache = null;
      return r;
    },
    logout: () => oauth.logout(),
  };
}
