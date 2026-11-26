/// <reference lib="webworker" />
/**
 * Real symbolic math for "Check my solution": Pyodide + SymPy in a dedicated worker.
 * Expressions arrive already validated by sympy.ts (whitelist); here they are parsed with SymPy's
 * own parser against a globals dict that contains only math names.
 */
import { loadPyodide, type PyodideInterface } from "pyodide";

const INDEX_URL = "https://cdn.jsdelivr.net/pyodide/v0.29.5/full/";

const PY = `
import sympy as sp
from sympy.parsing.sympy_parser import parse_expr, standard_transformations, implicit_multiplication, implicit_application, convert_xor

SAFE = {k: getattr(sp, k) for k in [
  "Rational","Integer","Float","sqrt","exp","log","ln","sin","cos","tan","asin","acos","atan","pi","E","oo","I",
  "binomial","factorial","Abs","integrate","diff","limit","Sum","Product","Symbol","floor","ceiling","Min","Max","gamma"
] if hasattr(sp, k)}
SAFE["ln"] = sp.log
TRANS = standard_transformations + (implicit_multiplication, implicit_application, convert_xor)

def P(s):
    g = dict(SAFE)
    g["__builtins__"] = {}
    return parse_expr(s, local_dict={}, global_dict=g, transformations=TRANS, evaluate=True)

def check(lhs, rhs):
    try:
        a = P(lhs); b = P(rhs)
    except Exception as e:
        return (None, "parse: " + str(e)[:120])
    try:
        a = a.doit() if hasattr(a, "doit") else a
        b = b.doit() if hasattr(b, "doit") else b
        d = sp.simplify(a - b)
        if d == 0:
            return (True, "equal")
        free = list(d.free_symbols)
        if not free:
            v = complex(sp.N(d))
            tol = 1e-9 * max(1.0, abs(complex(sp.N(a))))
            return (abs(v) <= tol, "difference " + str(sp.N(d, 6)))
        import random
        for _ in range(6):
            sub = {s: sp.Rational(random.randint(2, 9), random.randint(2, 9)) for s in free}
            v = complex(sp.N(d.subs(sub)))
            if abs(v) > 1e-8:
                return (False, "differs at " + ", ".join(f"{k}={sub[k]}" for k in free))
        return (True, "equal at sampled points")
    except Exception as e:
        return (None, "error: " + str(e)[:120])
`;

let ready: Promise<PyodideInterface> | null = null;
function boot() {
  return (ready ??= (async () => {
    const py = await loadPyodide({ indexURL: INDEX_URL });
    await py.loadPackage(["sympy"]);
    py.runPython(PY);
    return py;
  })());
}

self.onmessage = async (e: MessageEvent<{ id: number; claims: { lhs: string; rhs: string }[] }>) => {
  const { id, claims } = e.data;
  try {
    const py = await boot();
    const check = py.globals.get("check");
    const results = claims.map((c) => {
      const r = check(c.lhs, c.rhs);
      const [ok, detail] = r.toJs();
      r.destroy();
      return { ok: ok as boolean | null, detail: String(detail) };
    });
    check.destroy();
    self.postMessage({ id, results });
  } catch (err) {
    self.postMessage({ id, error: String((err as Error)?.message ?? err) });
  }
};
