/**
 * The API key stays on this device only (browser storage) — deliberately NOT in ruecai.db,
 * so syncing the data folder to Drive/OneDrive never uploads the key.
 */
const KEY = "ruecai.apiKey";
const DEMO = "ruecai.demo";
const MODELS = "ruecai.models";

const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export const secrets = {
  getApiKey: () => safe(() => localStorage.getItem(KEY), null),
  setApiKey: (k: string) => safe(() => localStorage.setItem(KEY, k.trim()), undefined),
  clearApiKey: () => safe(() => localStorage.removeItem(KEY), undefined),
  isDemo: () => safe(() => localStorage.getItem(DEMO) === "1", false),
  setDemo: (on: boolean) => safe(() => (on ? localStorage.setItem(DEMO, "1") : localStorage.removeItem(DEMO)), undefined),
  getModels: (): { fast: string; smart: string } | null => safe(() => JSON.parse(localStorage.getItem(MODELS) ?? "null"), null),
  setModels: (m: { fast: string; smart: string }) => safe(() => localStorage.setItem(MODELS, JSON.stringify(m)), undefined),
};
