import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readJson, writePrivate } from "../../config.ts";
import { paths } from "../../paths.ts";

/**
 * OpenAI's documented credential record for local open-source clients
 * (developers.openai.com/siwc/token-sharing-open-source/sign-in §5), one file per issued
 * client ID, owner-only (0600), written atomically. Tokens never go to the browser or the log.
 */
export const Credential = z.object({
  email: z.string().optional(),
  issuer: z.string(),
  subject: z.string(),
  client_id: z.string(),
  ext_agent_host_id: z.string(),
  id_token: z.string().optional(),
  access_token: z.string().optional(),
  refresh_token: z.string().optional(),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
  scopes: z.array(z.string()),
  saved_at: z.string(),
});
export type Credential = z.infer<typeof Credential>;

const dir = () => paths().chatgpt;
const safeId = (clientId: string) => {
  if (!/^[\w.-]{1,128}$/.test(clientId)) throw new Error("bad client id");
  return clientId;
};
const fileFor = (clientId: string) => join(dir(), `${safeId(clientId)}.json`);
const activeFile = () => join(dir(), "active.json");

export async function activeClientId(): Promise<string | null> {
  const a = await readJson<{ client_id?: string }>(activeFile());
  return a?.client_id ?? null;
}

export async function setActive(clientId: string | null) {
  if (clientId === null) await rm(activeFile(), { force: true });
  else await writePrivate(activeFile(), JSON.stringify({ client_id: clientId }));
}

export async function readCredential(clientId: string): Promise<Credential | null> {
  const raw = await readJson<unknown>(fileFor(clientId));
  const p = Credential.safeParse(raw);
  return p.success ? p.data : null;
}

export async function writeCredential(c: Credential) {
  await writePrivate(fileFor(c.client_id), JSON.stringify(c, null, 2));
}

/** All saved registrations (to find this account's issued client ID on a later sign-in). */
export async function listCredentials(): Promise<Credential[]> {
  let names: string[] = [];
  try {
    names = await readdir(dir());
  } catch {
    return [];
  }
  const out: Credential[] = [];
  for (const n of names) {
    if (!n.endsWith(".json") || n === "active.json") continue;
    const c = await readCredential(n.slice(0, -5)).catch(() => null);
    if (c) out.push(c);
  }
  return out;
}

/** When the access token expires: from expires_in, else from the token's own JWT "exp". */
export function expiresAt(c: Credential): number {
  if (c.expires_in) return Date.parse(c.saved_at) + c.expires_in * 1000;
  try {
    const payload = JSON.parse(Buffer.from((c.access_token ?? "").split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: number };
    if (typeof payload.exp === "number") return payload.exp * 1000;
  } catch {
    /* not a JWT */
  }
  return Date.parse(c.saved_at) + 3600_000; // assume an hour rather than refreshing on every call
}
export const hasPlanScope = (c: Credential) => c.scopes.includes("chatgpt.tokens.use.direct");
