import { statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LLMEvent, LLMRequest } from "@tutorai/local-api";
import { createChatgpt, mapError, pickDefaults } from "../src/providers/chatgpt/index.ts";
import { ChatgptOAuth, endpoints } from "../src/providers/chatgpt/oauth.ts";
import { activeClientId, readCredential, writeCredential } from "../src/providers/chatgpt/tokens.ts";
import { startMockOpenAI, useMock, type MockOpenAI } from "./mock-openai.ts";
import { tempEnv } from "./helpers.ts";

let mock: MockOpenAI;
beforeAll(async () => {
  mock = await startMockOpenAI();
});
afterAll(async () => {
  await mock.close();
  delete process.env.TUTORAI_TEST;
});

let env: ReturnType<typeof tempEnv>;
beforeEach(() => {
  env = tempEnv();
  useMock(mock);
  mock.responses = "ok";
  mock.responsesCalls = 0;
  mock.tokenCalls = [];
  mock.audience = undefined;
  mock.scope = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
});

const REDIRECT = "http://127.0.0.1:4317/auth/callback";

async function signIn(svc = createChatgpt(), clientId = "oaiapp_123") {
  const url = new URL(await svc.start(REDIRECT));
  mock.nonce = url.searchParams.get("nonce")!;
  const r = await svc.callback(new URLSearchParams({ code: "good-code", state: url.searchParams.get("state")!, client_id: clientId, scope: mock.scope }));
  return { url, r, svc };
}

const req: LLMRequest = { provider: "chatgpt", tier: "smart", system: "Be brief", context: "material", prompt: "Hi" };
async function call(svc: ReturnType<typeof createChatgpt>, extra: Partial<LLMRequest> = {}) {
  const events: LLMEvent[] = [];
  await svc.provider.call({ ...req, ...extra }, (e) => events.push(e), new AbortController().signal);
  return events;
}

describe("Sign in with ChatGPT (open-source flow)", () => {
  it("first sign-in registers with dynamic_agent_client and the documented parameters", async () => {
    const { url, r } = await signIn();
    expect(url.origin + url.pathname).toBe(`${mock.base}/api/accounts/authorize`);
    const q = url.searchParams;
    expect(q.get("client_id")).toBe("dynamic_agent_client");
    expect(q.get("agent_name_hint")).toBe("TutorAI");
    expect(q.get("ext_agent_host_id")).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
    expect(q.get("redirect_uri")).toBe(REDIRECT);
    expect(q.get("scope")).toBe("openid profile email offline_access resource.invoke chatgpt.tokens.use.direct");
    expect(q.get("resource")).toBe("https://api.openai.com/v1");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(r.ok).toBe(true);
    expect(await activeClientId()).toBe("oaiapp_123");
    const c = (await readCredential("oaiapp_123"))!;
    expect(c).toMatchObject({ email: "student@example.com", subject: "user-1", client_id: "oaiapp_123" });
    expect(c.access_token).toMatch(/^at-/);
    if (process.platform !== "win32") expect(statSync(join(env.config, "chatgpt", "oaiapp_123.json")).mode & 0o777).toBe(0o600);
  });

  it("a returning sign-in reuses the issued client id with hints and no agent_name_hint", async () => {
    const { svc } = await signIn();
    const url = new URL(await svc.start(REDIRECT));
    expect(url.searchParams.get("client_id")).toBe("oaiapp_123");
    expect(url.searchParams.get("agent_name_hint")).toBeNull();
    expect(url.searchParams.get("id_token_hint")).toBeTruthy();
    expect(url.searchParams.get("login_hint")).toBe("student@example.com");
  });

  it("rejects access_denied, unknown state, nonce mismatch, wrong audience and a missing plan scope", async () => {
    const svc = createChatgpt();
    let url = new URL(await svc.start(REDIRECT));
    expect((await svc.callback(new URLSearchParams({ error: "access_denied", state: url.searchParams.get("state")! }))).ok).toBe(false);
    expect((await svc.callback(new URLSearchParams({ code: "good-code", state: "forged", client_id: "x" }))).ok).toBe(false);

    url = new URL(await svc.start(REDIRECT));
    mock.nonce = "something-else";
    expect((await svc.callback(new URLSearchParams({ code: "good-code", state: url.searchParams.get("state")!, client_id: "oaiapp_1" }))).ok).toBe(false);

    url = new URL(await svc.start(REDIRECT));
    mock.nonce = url.searchParams.get("nonce")!;
    mock.audience = "someone-else";
    expect((await svc.callback(new URLSearchParams({ code: "good-code", state: url.searchParams.get("state")!, client_id: "oaiapp_1" }))).ok).toBe(false);
    mock.audience = undefined;

    mock.scope = "openid profile email offline_access";
    const r = await signIn(svc, "oaiapp_2");
    expect(r.r.ok).toBe(false);
    expect((await svc.status()).signedIn).toBe(false);
  });

  it("a state can only be used once", async () => {
    const svc = createChatgpt();
    const url = new URL(await svc.start(REDIRECT));
    mock.nonce = url.searchParams.get("nonce")!;
    const q = new URLSearchParams({ code: "good-code", state: url.searchParams.get("state")!, client_id: "oaiapp_9" });
    expect((await svc.callback(q)).ok).toBe(true);
    expect((await svc.callback(q)).ok).toBe(false);
  });

  it("refreshes near expiry once for concurrent callers and saves the rotated refresh token", async () => {
    await signIn();
    const c = (await readCredential("oaiapp_123"))!;
    await writeCredential({ ...c, expires_in: 60 }); // expires within the 2-minute margin
    const oauth = new ChatgptOAuth();
    const [a, b] = await Promise.all([oauth.accessToken(), oauth.accessToken()]);
    expect(a!.token).toBe(b!.token);
    expect(mock.tokenCalls.filter((t) => t.grant_type === "refresh_token")).toHaveLength(1);
    const after = (await readCredential("oaiapp_123"))!;
    expect(after.refresh_token).not.toBe(c.refresh_token);
    expect(after.access_token).toBe(a!.token);
  });

  it("a refresh started with an already-rotated token uses the newer tokens instead of signing out", async () => {
    await signIn();
    const stale = (await readCredential("oaiapp_123"))!;
    await writeCredential({ ...stale, expires_in: 60 });
    // Request A refreshes and rotates the token…
    await new ChatgptOAuth().accessToken();
    const fresh = (await readCredential("oaiapp_123"))!;
    expect(fresh.refresh_token).not.toBe(stale.refresh_token);
    // …while request B (another instance, same file) still holds the old one.
    const b = await (new ChatgptOAuth() as unknown as { refresh(c: typeof stale): Promise<typeof stale | null> }).refresh({ ...stale, expires_in: 60 });
    expect(b?.access_token).toBe(fresh.access_token);
    expect((await readCredential("oaiapp_123"))!.access_token).toBe(fresh.access_token);
  });

  it("after sign-out, the next sign-in can be a different account (no old hints)", async () => {
    const { svc } = await signIn();
    await svc.logout();
    const url = new URL(await svc.start(REDIRECT));
    expect(url.searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(url.searchParams.get("id_token_hint")).toBeNull();
    mock.nonce = url.searchParams.get("nonce")!;
    mock.subject = "user-2";
    const r = await svc.callback(new URLSearchParams({ code: "good-code", state: url.searchParams.get("state")!, client_id: "oaiapp_456", scope: mock.scope }));
    mock.subject = "user-1";
    expect(r.ok).toBe(true);
    expect(await activeClientId()).toBe("oaiapp_456");
  });

  it("an invalid refresh token signs out but keeps the registration", async () => {
    await signIn();
    const c = (await readCredential("oaiapp_123"))!;
    await writeCredential({ ...c, expires_in: 1, refresh_token: "rt-bogus" });
    expect(await new ChatgptOAuth().accessToken()).toBeNull();
    expect((await readCredential("oaiapp_123"))!.client_id).toBe("oaiapp_123");
    expect(await activeClientId()).toBe("oaiapp_123");
  });

  it("sign-out revokes the refresh token and clears tokens", async () => {
    const { svc } = await signIn();
    const before = (await readCredential("oaiapp_123"))!.refresh_token!;
    expect(await svc.logout()).toEqual({ revoked: true });
    expect(mock.revoked).toContain(before);
    expect((await readCredential("oaiapp_123"))!.access_token).toBeUndefined();
    expect((await svc.status()).signedIn).toBe(false);
  });

  it("only test runs can point TutorAI at another OpenAI address", () => {
    delete process.env.TUTORAI_TEST;
    expect(endpoints().token).toBe("https://auth.openai.com/api/accounts/oauth/token");
    expect(endpoints().api).toBe("https://api.openai.com/v1");
    process.env.TUTORAI_TEST = "1";
  });
});

describe("ChatGPT plan inference (Responses API)", () => {
  it("lists models and picks defaults", async () => {
    const { svc } = await signIn();
    const s = await svc.status();
    expect(s.models?.map((m) => m.slug)).toEqual(["gpt-6.2-sol", "gpt-6.2-mini"]);
    expect(pickDefaults(s.models!)).toEqual({ fast: "gpt-6.2-mini", smart: "gpt-6.2-sol" });
  });

  it("streams with store:false and stream:true, without unsupported fields", async () => {
    const { svc } = await signIn();
    const events = await call(svc, { maxTokens: 100, history: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] });
    expect(events.filter((e) => e.type === "delta")).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: "result", text: "Hello world", model: "plan:gpt-6.2-sol", usage: { input: 20, output: 4, cacheRead: 8 } });
    const body = mock.lastResponsesBody!;
    expect(body).toMatchObject({ model: "gpt-6.2-sol", instructions: "Be brief", store: false, stream: true });
    for (const k of ["max_output_tokens", "temperature", "previous_response_id", "metadata", "user"]) expect(body).not.toHaveProperty(k);
    expect(JSON.stringify(body.input)).not.toContain('"role":"system"');
  });

  it("asks for JSON with a json_schema format and parses it", async () => {
    const { svc } = await signIn();
    mock.responses = "json";
    const events = await call(svc, { jsonSchema: { type: "object" } });
    expect(events.at(-1)).toMatchObject({ type: "result", json: { answer: 42 } });
    expect(mock.lastResponsesBody!.text).toEqual({ format: { type: "json_schema", name: "output", schema: { type: "object" }, strict: false } });
  });

  it("maps the plan's usage limit to rate_limit", async () => {
    const { svc } = await signIn();
    mock.responses = "limit";
    expect((await call(svc)).at(-1)).toMatchObject({ type: "error", kind: "rate_limit" });
  });

  it("retries a temporary failure only before any text was sent", async () => {
    const { svc } = await signIn();
    mock.responses = "unavailable-then-ok";
    expect((await call(svc)).at(-1)).toMatchObject({ type: "result", text: "ok" });
    mock.responsesCalls = 0;
    mock.responses = "fail-after-delta";
    const events = await call(svc);
    expect(events.at(-1)).toMatchObject({ type: "error", kind: "network" });
    expect(mock.responsesCalls).toBe(1);
  }, 15_000);

  it("refreshes once on 401 and retries", async () => {
    const { svc } = await signIn();
    mock.responses = "401-then-ok";
    expect((await call(svc)).at(-1)).toMatchObject({ type: "result", text: "ok" });
  });

  it("asks to sign in when not connected", async () => {
    expect((await call(createChatgpt())).at(-1)).toMatchObject({ type: "error", kind: "auth" });
  });

  it("maps documented error codes", () => {
    expect(mapError("subscription_sharing_user_not_eligible").kind).toBe("not_eligible");
    expect(mapError("subscription_sharing_usage_unavailable").retry).toBe(true);
    expect(mapError(undefined, 401).kind).toBe("auth");
  });
});
