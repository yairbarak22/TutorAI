/**
 * Outbound network allowlist for the server process (RFC §4.2). The Claude Code CLI is a
 * separate process and does its own networking; everything TutorAI Local itself fetches
 * must go to one of these hosts.
 */
export const ALLOWED_HOSTS = new Set([
  "auth.openai.com",
  "api.openai.com",
  "api.github.com",
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "localhost",
  "127.0.0.1",
]);

export function allowed(url: string | URL): boolean {
  try {
    const u = new URL(String(url));
    if (u.protocol === "https:") return ALLOWED_HOSTS.has(u.hostname);
    if (u.protocol === "http:") return u.hostname === "localhost" || u.hostname === "127.0.0.1";
    return false;
  } catch {
    return false;
  }
}

/** Wraps the global fetch once, at startup. */
export function installNetPolicy() {
  const original = globalThis.fetch;
  if ((original as { __tutorai?: boolean }).__tutorai) return;
  const guarded = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!allowed(url)) return Promise.reject(new Error(`Blocked network request to ${new URL(url).host}`));
    return original(input, init);
  }) as typeof fetch & { __tutorai?: boolean };
  guarded.__tutorai = true;
  globalThis.fetch = guarded;
}
