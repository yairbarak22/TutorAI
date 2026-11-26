import { createServer, type Server } from "node:http";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";

/**
 * A stand-in for auth.openai.com + api.openai.com, following OpenAI's documented contract for
 * open-source clients (developers.openai.com/siwc). Tests point TutorAI at it with
 * TUTORAI_TEST=1, TUTORAI_OPENAI_AUTH_BASE and TUTORAI_OPENAI_API_BASE.
 */
export interface MockOpenAI {
  base: string;
  api: string;
  /** Set before the callback: the nonce the next ID token carries. */
  nonce: string;
  /** What the next /v1/responses call does. */
  responses: "ok" | "json" | "limit" | "unavailable-then-ok" | "fail-after-delta" | "401-then-ok";
  scope: string;
  audience?: string;
  subject: string;
  tokenCalls: { grant_type: string; client_id: string; refresh_token?: string }[];
  revoked: string[];
  lastResponsesBody: Record<string, unknown> | null;
  responsesCalls: number;
  close(): Promise<void>;
}

const ISSUER = "https://auth.openai.com";

export async function startMockOpenAI(): Promise<MockOpenAI> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  let refreshCounter = 0;
  const validRefresh = new Set<string>();

  const m = {
    base: "",
    api: "",
    nonce: "",
    responses: "ok",
    scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    subject: "user-1",
    tokenCalls: [],
    revoked: [],
    lastResponsesBody: null,
    responsesCalls: 0,
    close: async () => {},
  } as MockOpenAI;

  const idToken = (clientId: string) =>
    new SignJWT({ email: "student@example.com", nonce: m.nonce })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(ISSUER)
      .setAudience(m.audience ?? clientId)
      .setSubject(m.subject)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

  const tokens = async (clientId: string) => {
    const refresh = `rt-${++refreshCounter}`;
    validRefresh.add(refresh);
    return { access_token: `at-${refreshCounter}`, refresh_token: refresh, id_token: await idToken(clientId), token_type: "Bearer", expires_in: 3600, scope: m.scope };
  };

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    let body = "";
    for await (const c of req) body += c;
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    const sse = (events: unknown[]) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const e of events) res.write(`event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`);
      res.end();
    };

    // The consent page: approve at once and send the browser back, like OpenAI after "Allow".
    if (url.pathname === "/api/accounts/authorize") {
      m.nonce = url.searchParams.get("nonce") ?? "";
      const back = new URL(url.searchParams.get("redirect_uri")!);
      back.searchParams.set("code", "good-code");
      back.searchParams.set("state", url.searchParams.get("state")!);
      const cid = url.searchParams.get("client_id")!;
      back.searchParams.set("client_id", cid === "dynamic_agent_client" ? "oaiapp_e2e" : cid);
      back.searchParams.set("scope", m.scope);
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (url.pathname === "/.well-known/openid-configuration")
      return json(200, { issuer: ISSUER, jwks_uri: `${m.base}/jwks`, revocation_endpoint: `${m.base}/revoke` });
    if (url.pathname === "/jwks") return json(200, { keys: [jwk] });
    if (url.pathname === "/api/accounts/oauth/token") {
      const p = new URLSearchParams(body);
      m.tokenCalls.push({ grant_type: p.get("grant_type")!, client_id: p.get("client_id")!, refresh_token: p.get("refresh_token") ?? undefined });
      if (p.get("resource") !== "https://api.openai.com/v1") return json(400, { error: "invalid_target" });
      if (p.get("grant_type") === "authorization_code") {
        if (p.get("code") !== "good-code" || !p.get("code_verifier")) return json(400, { error: "invalid_grant" });
        return json(200, await tokens(p.get("client_id")!));
      }
      if (p.get("grant_type") === "refresh_token") {
        const rt = p.get("refresh_token")!;
        if (!validRefresh.has(rt)) return json(400, { error: "invalid_grant" });
        validRefresh.delete(rt); // rotation
        await new Promise((r) => setTimeout(r, 50));
        return json(200, await tokens(p.get("client_id")!));
      }
    }
    if (url.pathname === "/revoke") {
      const p = new URLSearchParams(body);
      m.revoked.push(p.get("token")!);
      validRefresh.delete(p.get("token")!);
      res.writeHead(200);
      return res.end();
    }
    if (url.pathname === "/v1/models") {
      if (!req.headers.authorization?.startsWith("Bearer at-")) return json(401, { error: { code: "invalid_token" } });
      return json(200, {
        models: [
          { slug: "gpt-6.2-sol", display_name: "GPT-6.2", visibility: "list" },
          { slug: "gpt-6.2-mini", display_name: "GPT-6.2 mini", visibility: "list" },
          { slug: "internal", display_name: "Hidden", visibility: "hide" },
        ],
      });
    }
    if (url.pathname === "/v1/responses") {
      m.responsesCalls++;
      m.lastResponsesBody = JSON.parse(body);
      const completed = { type: "response.completed", response: { usage: { input_tokens: 20, output_tokens: 4, input_tokens_details: { cached_tokens: 8 } } } };
      switch (m.responses) {
        case "ok":
          return sse([{ type: "response.output_text.delta", delta: "Hello " }, { type: "response.output_text.delta", delta: "world" }, completed]);
        case "json":
          return sse([{ type: "response.output_text.delta", delta: '{"answer":' }, { type: "response.output_text.delta", delta: "42}" }, completed]);
        case "limit":
          return sse([{ type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } }]);
        case "unavailable-then-ok":
          if (m.responsesCalls === 1) return sse([{ type: "response.failed", response: { error: { code: "subscription_sharing_usage_unavailable" } } }]);
          return sse([{ type: "response.output_text.delta", delta: "ok" }, completed]);
        case "fail-after-delta":
          return sse([{ type: "response.output_text.delta", delta: "partial" }, { type: "response.failed", response: { error: { code: "subscription_sharing_usage_unavailable" } } }]);
        case "401-then-ok":
          if (m.responsesCalls === 1) return json(401, { error: { code: "invalid_token" } });
          return sse([{ type: "response.output_text.delta", delta: "ok" }, completed]);
      }
    }
    json(404, { error: "not found" });
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  m.base = `http://127.0.0.1:${port}`;
  m.api = `${m.base}/v1`;
  m.close = () => new Promise<void>((r) => server.close(() => r()));
  return m;
}

export function useMock(m: MockOpenAI) {
  process.env.TUTORAI_TEST = "1";
  process.env.TUTORAI_OPENAI_AUTH_BASE = m.base;
  process.env.TUTORAI_OPENAI_API_BASE = m.api;
}
