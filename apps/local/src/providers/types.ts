import type { Connections, InstallEvent, LLMEvent, LLMRequest, Settings } from "@tutorai/local-api";

/** A model backend on this computer. Must emit exactly one "result" or "error" event. */
export interface Provider {
  call(req: LLMRequest, emit: (e: LLMEvent) => void, signal: AbortSignal): Promise<void>;
}

export interface ClaudeCodeService {
  provider: Provider;
  status(fresh?: boolean): Promise<Connections["claudeCode"]>;
  install(emit: (e: InstallEvent) => void, signal: AbortSignal): Promise<void>;
  login(): Promise<{ started: boolean; manualCommand: string }>;
  logout(): Promise<void>;
}

export interface ChatgptService {
  provider: Provider;
  status(): Promise<Connections["chatgpt"]>;
  /** Starts a sign-in; returns the URL the page opens in a new tab. */
  start(redirectUri: string): Promise<string>;
  /** Handles /auth/callback; returns a short bilingual result for the page. */
  callback(query: URLSearchParams): Promise<{ ok: boolean; message: string }>;
  logout(): Promise<{ revoked: boolean }>;
}

export interface Services {
  claudeCode: ClaudeCodeService;
  chatgpt: ChatgptService;
  settings: () => Promise<Settings>;
}

/** Limits concurrent model calls (Claude Code processes / ChatGPT streams) across the server. */
export class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;
  constructor(private max: number) {}
  get busy() {
    return this.active + this.queue.length;
  }
  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve, reject) => {
        const go = () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        };
        const onAbort = () => {
          this.queue = this.queue.filter((f) => f !== go);
          reject(new Error("aborted"));
        };
        this.queue.push(go);
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.queue.shift()?.();
    };
  }
}
