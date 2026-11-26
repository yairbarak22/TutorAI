import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { hostId } from "../../config.ts";
import { log } from "../../log.ts";
import { activeClientId, listCredentials, readCredential, setActive, writeCredential, expiresAt, type Credential } from "./tokens.ts";

/**
 * "Sign in with ChatGPT" for open-source, locally hosted apps
 * (developers.openai.com/siwc/token-sharing-open-source). No client secret: the first sign-in
 * registers this app with client_id=dynamic_agent_client and OpenAI issues our own client ID.
 */

export const AGENT_NAME = "TutorAI";
export const RESOURCE = "https://api.openai.com/v1";
export const SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";

/** Overridable only in tests (TUTORAI_TEST=1), so a production build can't be pointed elsewhere. */
export function endpoints() {
  const test = process.env.TUTORAI_TEST === "1";
  const auth = (test && process.env.TUTORAI_OPENAI_AUTH_BASE) || "https://auth.openai.com";
  const api = (test && process.env.TUTORAI_OPENAI_API_BASE) || "https://api.openai.com/v1";
  return {
    issuer: "https://auth.openai.com",
    authorize: `${auth}/api/accounts/authorize`,
    token: `${auth}/api/accounts/oauth/token`,
    discovery: `${auth}/.well-known/openid-configuration`,
    api,
  };
}

const b64url = (b: Buffer) => b.toString("base64url");

interface Pending {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  /** Set when reauthorizing a saved registration. */
  clientId: string | null;
  expires: number;
}

const PENDING_TTL_MS = 10 * 60 * 1000;

const TokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
  scope: z.string().optional(),
});

const Discovery = z.object({ jwks_uri: z.string(), revocation_endpoint: z.string().optional(), issuer: z.string().optional() }).passthrough();

export class ChatgptOAuth {
  private pending = new Map<string, Pending>();
  private discovery: { at: number; value: z.infer<typeof Discovery> } | null = null;
  private jwks: JWTVerifyGetKey | null = null;

  constructor(private fetchFn: typeof fetch = (...a) => fetch(...a)) {}

  async discover() {
    if (this.discovery && Date.now() - this.discovery.at < 3600_000) return this.discovery.value;
    const r = await this.fetchFn(endpoints().discovery, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`OpenID discovery failed (${r.status})`);
    const value = Discovery.parse(await r.json());
    this.discovery = { at: Date.now(), value };
    this.jwks = null;
    return value;
  }

  private async keys(): Promise<JWTVerifyGetKey> {
    if (this.jwks) return this.jwks;
    const d = await this.discover();
    this.jwks = createRemoteJWKSet(new URL(d.jwks_uri), { cacheMaxAge: 3600_000 });
    return this.jwks;
  }

  /** Builds the authorization URL for a new or returning sign-in. */
  async start(redirectUri: string): Promise<string> {
    const now = Date.now();
    for (const [k, p] of this.pending) if (p.expires < now) this.pending.delete(k);
    const state = b64url(randomBytes(32));
    const nonce = b64url(randomBytes(32));
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash("sha256").update(verifier).digest());
    const active = await activeClientId();
    const saved = active ? await readCredential(active) : null;
    const clientId = saved?.client_id ?? null;
    this.pending.set(state, { state, nonce, verifier, redirectUri, clientId, expires: now + PENDING_TTL_MS });

    const q = new URLSearchParams({
      client_id: clientId ?? "dynamic_agent_client",
      ext_agent_host_id: await hostId(),
      response_type: "code",
      redirect_uri: redirectUri,
      scope: SCOPES,
      resource: RESOURCE,
      state,
      nonce,
      code_challenge_method: "S256",
      code_challenge: challenge,
    });
    if (!clientId) q.set("agent_name_hint", AGENT_NAME);
    if (saved?.id_token) q.set("id_token_hint", saved.id_token);
    if (saved?.email) q.set("login_hint", saved.email);
    return `${endpoints().authorize}?${q.toString()}`;
  }

  /** Validates the callback, exchanges the code, checks the ID token and plan permission, saves. */
  async callback(query: URLSearchParams): Promise<{ ok: boolean; message: string }> {
    const fail = (message: string) => ({ ok: false, message });
    const state = query.get("state");
    const p = state ? this.pending.get(state) : undefined;
    if (!p || p.expires < Date.now()) return fail("This sign-in link expired. Start again from TutorAI.");
    this.pending.delete(p.state);

    const error = query.get("error");
    if (error === "access_denied") return fail("ChatGPT plan use wasn't enabled. You can try again from TutorAI.");
    if (error) return fail(`Sign-in failed (${error.slice(0, 60)}).`);

    const code = query.get("code");
    const issued = query.get("client_id");
    if (!code) return fail("Sign-in failed (no code).");
    if (p.clientId && issued && issued !== p.clientId) return fail("Sign-in returned a different app registration. Start again.");
    const clientId = p.clientId ?? issued;
    if (!clientId || clientId === "dynamic_agent_client") return fail("Registration didn't complete. Start again.");

    const res = await this.fetchFn(endpoints().token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: p.verifier, redirect_uri: p.redirectUri, resource: RESOURCE }),
    });
    if (!res.ok) {
      log("warn", `chatgpt token exchange failed: ${res.status}`);
      return fail("Sign-in failed while finishing. Start again from TutorAI.");
    }
    const tokens = TokenResponse.parse(await res.json());
    if (!tokens.id_token) return fail("Sign-in failed (no identity token).");

    let claims: { sub?: string; email?: unknown };
    try {
      const v = await jwtVerify(tokens.id_token, await this.keys(), { issuer: endpoints().issuer, audience: clientId });
      claims = v.payload as typeof claims;
      if (v.payload.nonce !== p.nonce) return fail("Sign-in failed (nonce mismatch). Start again.");
    } catch (e) {
      log("warn", `chatgpt id token invalid: ${(e as Error).message}`);
      return fail("Sign-in failed (identity check). Start again.");
    }
    if (!claims.sub) return fail("Sign-in failed (no account id).");

    const scopes = (tokens.scope ?? query.get("scope") ?? "").split(/[\s+]+/).filter(Boolean);
    if (!scopes.includes("chatgpt.tokens.use.direct")) return fail("ChatGPT plan use wasn't enabled. Sign in again and allow it.");
    const prev = await readCredential(clientId);
    if (prev && prev.subject !== claims.sub) return fail("That's a different ChatGPT account than this registration. Use “Sign out” first.");

    const record: Credential = {
      email: typeof claims.email === "string" ? claims.email : prev?.email,
      issuer: endpoints().issuer,
      subject: claims.sub,
      client_id: clientId,
      ext_agent_host_id: await hostId(),
      id_token: tokens.id_token,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type ?? "Bearer",
      expires_in: tokens.expires_in,
      scopes,
      saved_at: new Date().toISOString(),
    };
    await writeCredential(record);
    await setActive(clientId);
    return { ok: true, message: "מחובר ל-ChatGPT. אפשר לסגור את הלשונית הזו. · Connected to ChatGPT. You can close this tab." };
  }

  /* ---------------- refresh (serialized: OpenAI rotates refresh tokens) ---------------- */

  private refreshing: Promise<Credential | null> | null = null;

  /** A valid access token for the active registration, refreshed when it's about to expire. */
  async accessToken(force = false): Promise<{ token: string; credential: Credential } | null> {
    const id = await activeClientId();
    if (!id) return null;
    let c = await readCredential(id);
    if (!c?.access_token) return null;
    if (force || expiresAt(c) - Date.now() < 120_000) {
      this.refreshing ??= this.refresh(c).finally(() => (this.refreshing = null));
      c = await this.refreshing;
      if (!c?.access_token) return null;
    }
    return { token: c.access_token!, credential: c };
  }

  private async refresh(c: Credential): Promise<Credential | null> {
    // Another refresh may have rotated the token since this caller read the file: use its result
    // instead of sending an already-used refresh token (which would sign the student out).
    const latest = await readCredential(c.client_id);
    if (latest && latest.refresh_token !== c.refresh_token && latest.access_token && expiresAt(latest) - Date.now() > 120_000) return latest;
    if (latest) c = latest;
    if (!c.refresh_token) return null;
    const res = await this.fetchFn(endpoints().token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: c.client_id, refresh_token: c.refresh_token, resource: RESOURCE }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (body.error === "invalid_grant") {
        // The session ended (revoked, expired). Keep the registration, drop the tokens.
        await writeCredential({ ...c, access_token: undefined, refresh_token: undefined });
        return null;
      }
      throw new Error(`Token refresh failed (${res.status})`);
    }
    const t = TokenResponse.parse(await res.json());
    const next: Credential = {
      ...c,
      access_token: t.access_token,
      refresh_token: t.refresh_token ?? c.refresh_token,
      id_token: t.id_token ?? c.id_token,
      expires_in: t.expires_in,
      scopes: t.scope ? t.scope.split(/\s+/).filter(Boolean) : c.scopes,
      saved_at: new Date().toISOString(),
    };
    await writeCredential(next);
    return next;
  }

  /** Revokes the renewable session, then clears tokens locally. Keeps the registration and host id. */
  async logout(): Promise<{ revoked: boolean }> {
    const id = await activeClientId();
    if (!id) return { revoked: true };
    const c = await readCredential(id);
    let revoked = !c?.refresh_token;
    if (c?.refresh_token) {
      for (let i = 0; i < 3 && !revoked; i++) {
        try {
          const d = await this.discover();
          if (!d.revocation_endpoint) break;
          const r = await this.fetchFn(d.revocation_endpoint, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ token: c.refresh_token, token_type_hint: "refresh_token", client_id: c.client_id }),
          });
          if (r.ok) revoked = true;
          else if (r.status < 500) break;
        } catch {
          /* network: retry */
        }
        if (!revoked) await new Promise((r) => setTimeout(r, 500 * 2 ** i));
      }
    }
    // Keep the registration file (OpenAI: retain the client mapping), but forget the session: no
    // id_token_hint after sign-out, and the next sign-in may be a different account.
    if (c) await writeCredential({ ...c, access_token: undefined, refresh_token: undefined, id_token: undefined });
    await setActive(null);
    return { revoked };
  }

  /** The saved registration for an account, so a later sign-in reuses its client ID. */
  async registrations() {
    return listCredentials();
  }
}
