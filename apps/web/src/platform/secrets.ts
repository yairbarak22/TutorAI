import type { LocalConfig } from "@tutorai/core";
import type { Settings } from "@tutorai/local-api";
import { localApi, localServer } from "./local-server.ts";

/**
 * The API key stays on this device only (browser storage) — deliberately NOT in tutorai.db,
 * so syncing the data folder to Drive/OneDrive never uploads the key. The student can also
 * choose not to save it at all (sessionStorage, cleared when the tab closes).
 */
const KEY = "tutorai.apiKey";
/** "session" = the student chose not to save the key: it lives in sessionStorage and is gone when the tab closes. */
const KEY_MODE = "tutorai.apiKeyMode";
const DEMO = "tutorai.demo";
const MODELS = "tutorai.models";
const PROVIDER = "tutorai.provider";
const LOCAL = "tutorai.local";
const HYBRID_SMART = "tutorai.hybridSmart";

/**
 * Which backend answers: Claude (API key), a model on this computer, local for fast work + Claude
 * for the rest, or (in TutorAI Local) the student's Claude plan / ChatGPT plan.
 */
export type Provider = "claude" | "local" | "hybrid" | "claude-code" | "chatgpt";
export const isPlanProvider = (p: Provider): p is "claude-code" | "chatgpt" => p === "claude-code" || p === "chatgpt";

const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export const secrets = {
  getApiKey: () => safe(() => localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY), null),
  /** remember = keep it in this browser; otherwise only until this tab is closed. */
  setApiKey: (k: string, remember = true) =>
    safe(() => {
      localStorage.removeItem(KEY);
      sessionStorage.removeItem(KEY);
      if (remember) {
        localStorage.setItem(KEY, k.trim());
        localStorage.removeItem(KEY_MODE);
      } else {
        sessionStorage.setItem(KEY, k.trim());
        localStorage.setItem(KEY_MODE, "session");
      }
    }, undefined),
  clearApiKey: () =>
    safe(() => {
      localStorage.removeItem(KEY);
      sessionStorage.removeItem(KEY);
      localStorage.removeItem(KEY_MODE);
    }, undefined),
  /** The student uses a key but chose not to save it. */
  keyIsSessionOnly: () => safe(() => localStorage.getItem(KEY_MODE) === "session", false),
  /** A session-only key is expected but this tab doesn't have it yet. */
  needsSessionKey: () => safe(() => localStorage.getItem(KEY_MODE) === "session" && !localStorage.getItem(KEY) && !sessionStorage.getItem(KEY), false),
  isDemo: () => safe(() => localStorage.getItem(DEMO) === "1", false),
  setDemo: (on: boolean) => safe(() => (on ? localStorage.setItem(DEMO, "1") : localStorage.removeItem(DEMO)), undefined),
  getModels: (): { fast: string; smart: string } | null => safe(() => JSON.parse(localStorage.getItem(MODELS) ?? "null"), null),
  setModels: (m: { fast: string; smart: string }) => safe(() => localStorage.setItem(MODELS, JSON.stringify(m)), undefined),
  getProvider: (): Provider => safe(() => (localStorage.getItem(PROVIDER) as Provider | null) ?? "claude", "claude"),
  setProvider: (p: Provider) => {
    safe(() => localStorage.setItem(PROVIDER, p), undefined);
    // TutorAI Local keeps it server-side too, so it survives a port change.
    if (localServer()) void localApi.saveSettings({ provider: p }).catch(() => {});
  },
  /** In hybrid mode: which backend serves the smart tier (the API key, or a plan in TutorAI Local). */
  getHybridSmart: (): "claude" | "claude-code" | "chatgpt" =>
    safe(() => (localStorage.getItem(HYBRID_SMART) as "claude" | "claude-code" | "chatgpt" | null) ?? "claude", "claude"),
  setHybridSmart: (p: "claude" | "claude-code" | "chatgpt") => {
    safe(() => localStorage.setItem(HYBRID_SMART, p), undefined);
    if (localServer()) void localApi.saveSettings({ hybridSmart: p }).catch(() => {});
  },
  /** TutorAI Local: take the provider choices saved on the server (they outlive browser storage). */
  hydrate: (s: Settings) =>
    safe(() => {
      if (s.provider) localStorage.setItem(PROVIDER, s.provider);
      if (s.hybridSmart) localStorage.setItem(HYBRID_SMART, s.hybridSmart);
    }, undefined),
  getLocal: (): LocalConfig | null => safe(() => JSON.parse(localStorage.getItem(LOCAL) ?? "null"), null),
  setLocal: (c: LocalConfig) => safe(() => localStorage.setItem(LOCAL, JSON.stringify(c)), undefined),
};
