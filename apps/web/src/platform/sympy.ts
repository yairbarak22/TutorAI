import type { MathCheckResult, MathVerifier } from "@tutorai/sdk";

/**
 * Browser-side MathVerifier backed by SymPy (Pyodide) in a worker.
 *
 * Model-written expressions are untrusted: before anything reaches Python they must pass a strict
 * whitelist (math characters and known function names only; no strings, attributes, dunder,
 * brackets or statements). Anything else is reported as "could not check" instead of being run.
 */
const ALLOWED_NAMES = new Set([
  "Rational", "Integer", "Float", "sqrt", "exp", "log", "ln", "sin", "cos", "tan", "asin", "acos", "atan", "pi", "E", "oo", "I",
  "binomial", "factorial", "Abs", "integrate", "diff", "limit", "Sum", "Product", "floor", "ceiling", "Min", "Max", "gamma",
]);
const CHARS = /^[A-Za-z0-9_+\-*/^().,\s]*$/;

/** Returns a reason when the expression is not safe/simple enough to check, else null. */
export function rejectExpression(s: string): string | null {
  if (!s || s.length > 300) return "too long or empty";
  if (!CHARS.test(s)) return "unsupported characters";
  if (/__|\blambda\b|\bimport\b/.test(s)) return "forbidden token";
  if (/[A-Za-z_]\s*\.|\.\s*[A-Za-z_]/.test(s)) return "attribute access";
  for (const name of s.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
    // Variables: short plain names (x, n, p1, mu, sigma). Functions: whitelist only.
    const isCall = new RegExp(`\\b${name}\\s*\\(`).test(s);
    if (isCall ? !ALLOWED_NAMES.has(name) : name.length > 6 && !ALLOWED_NAMES.has(name)) return `unknown name ${name}`;
  }
  return null;
}

const TIMEOUT_MS = 25_000;
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: { results?: MathCheckResult[]; error?: string }) => void>();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./sympy.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    pending.get(e.data.id)?.(e.data);
    pending.delete(e.data.id);
  };
  return worker;
}

/** First run downloads Pyodide + SymPy (~15 MB, cached by the browser afterwards). */
export const sympyVerifier: MathVerifier = {
  async verify(claims) {
    const out: MathCheckResult[] = claims.map(() => ({ ok: null, detail: "" }));
    const safe: { i: number; lhs: string; rhs: string }[] = [];
    claims.forEach((c, i) => {
      const why = rejectExpression(c.lhs) ?? rejectExpression(c.rhs);
      if (why) out[i] = { ok: null, detail: `not checked: ${why}` };
      else safe.push({ i, lhs: c.lhs, rhs: c.rhs });
    });
    if (!safe.length) return out;
    const id = ++seq;
    const w = getWorker();
    const res = await new Promise<{ results?: MathCheckResult[]; error?: string }>((resolve) => {
      const timer = setTimeout(() => {
        // A runaway simplify(): kill the worker so the next check starts fresh.
        pending.delete(id);
        w.terminate();
        worker = null;
        resolve({ error: "timeout" });
      }, TIMEOUT_MS + (seq === 1 ? 60_000 : 0));
      pending.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      w.postMessage({ id, claims: safe.map(({ lhs, rhs }) => ({ lhs, rhs })) });
    });
    if (res.error || !res.results) return out.map((o) => (o.detail ? o : { ok: null, detail: res.error ?? "unavailable" }));
    safe.forEach((s, k) => (out[s.i] = res.results![k]));
    return out;
  },
};
