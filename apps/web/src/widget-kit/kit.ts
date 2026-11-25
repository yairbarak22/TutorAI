/**
 * RuecAI Viz Kit — injected into every interactive widget's sandboxed iframe.
 *
 * Model-written widgets call this small, stable API (global `Viz`, plus `THREE`) instead of
 * hand-rolling canvas code, so every explainer gets the same polished look: a real 3D scene
 * (three.js + orbit controls), a crisp 2D plotter, styled controls, readouts and LaTeX formulas.
 *
 * Bundled to one IIFE string at build time (see widget-kit-plugin.ts). It runs with no network
 * access, so everything it needs is inside this bundle. The API is documented for the model in
 * packages/sdk/src/widget-kit-api.ts. Keep the two in sync.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import katex from "katex";

/* ------------------------------------------------------------------ theme */
const PALETTE = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#4b5563"];
const INK = "#0f172a";
const MUTED = "#64748b";
const GRID = "#e2e8f0";
const ACCENT = "#3b6ea5";

const CSS = `
:root{color-scheme:light}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:${INK};font:15px/1.55 system-ui,-apple-system,"Segoe UI","Arial Hebrew",sans-serif}
body{padding:14px}
.viz-app{display:flex;flex-direction:column;gap:12px}
.viz-head h1{font-size:18px;margin:0 0 2px;font-weight:700}
.viz-head p{margin:0;color:${MUTED};font-size:14px}
.viz-main{display:grid;gap:12px;grid-template-columns:minmax(0,1fr);align-items:start}
@media (min-width:1000px){.viz-main:not(.viz-wide){grid-template-columns:minmax(0,1fr) 270px}}
.viz-stage{display:grid;gap:12px;min-width:0}
@media (min-width:760px){.viz-stage.viz-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:999px){.viz-main .viz-panel{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));align-items:start}}
.viz-card{position:relative;border:1px solid ${GRID};border-radius:12px;background:#fff;overflow:hidden;min-width:0}
.viz-card-title{position:absolute;top:8px;inset-inline-start:10px;z-index:2;font-size:12px;font-weight:600;color:${MUTED};background:rgba(255,255,255,.85);padding:2px 8px;border-radius:999px;pointer-events:none}
.viz-hint{position:absolute;bottom:6px;inset-inline-end:10px;z-index:2;font-size:11px;color:#94a3b8;pointer-events:none}
.viz-panel{display:flex;flex-direction:column;gap:12px;padding:12px;border:1px solid ${GRID};border-radius:12px;background:#f8fafc}
.viz-ctl label{display:flex;justify-content:space-between;gap:8px;font-size:13px;font-weight:600;margin-bottom:4px}
.viz-ctl output{font:600 13px ui-monospace,SFMono-Regular,Menlo,monospace;color:${ACCENT};direction:ltr;unicode-bidi:isolate}
.viz-ctl input[type=range]{width:100%;accent-color:${ACCENT};direction:ltr}
.viz-ctl select{width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;font:inherit}
.viz-btns{display:flex;flex-wrap:wrap;gap:6px}
.viz-btn{border:1px solid #cbd5e1;background:#fff;color:${INK};border-radius:8px;padding:6px 12px;font:600 13px inherit;cursor:pointer}
.viz-btn:hover{background:#eff6ff;border-color:${ACCENT}}
.viz-btn.primary{background:${ACCENT};border-color:${ACCENT};color:#fff}
.viz-toggle{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;cursor:pointer}
.viz-toggle input{accent-color:${ACCENT};width:16px;height:16px}
.viz-readouts{display:grid;grid-template-columns:1fr auto;gap:4px 10px;font-size:13px}
.viz-readouts dt{color:${MUTED}}
.viz-readouts dd{margin:0;font:700 14px ui-monospace,SFMono-Regular,Menlo,monospace;direction:ltr;unicode-bidi:isolate;text-align:left}
.viz-note{border-inline-start:4px solid #f59e0b;background:#fffbeb;border-radius:8px;padding:8px 12px;font-size:14px}
.viz-note b{color:#92400e}
.viz-formula{direction:ltr;text-align:center;overflow-x:auto;padding:10px 12px;background:#f8fafc;border:1px solid ${GRID};border-left:4px solid ${ACCENT};border-radius:10px;font-size:1.1em}
.viz-formula.inline{display:inline-block;padding:0 .2em;border:0;background:none;font-size:1em}
.viz-legend{display:flex;flex-wrap:wrap;gap:10px;padding:6px 10px 8px;font-size:12px;color:${MUTED}}
.viz-legend i{display:inline-block;width:12px;height:3px;border-radius:2px;margin-inline-end:5px;vertical-align:middle}
.viz-tip{position:absolute;pointer-events:none;z-index:3;background:${INK};color:#fff;font:12px ui-monospace,Menlo,monospace;padding:3px 7px;border-radius:6px;direction:ltr;white-space:nowrap;transform:translate(-50%,-130%);display:none}
math{font-size:1.1em;direction:ltr;unicode-bidi:isolate}
`;

function injectCss() {
  if (document.getElementById("viz-css")) return;
  const s = document.createElement("style");
  s.id = "viz-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

/* ------------------------------------------------------------------ helpers */
type El = HTMLElement;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", parent?: El | null, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  parent?.appendChild(e);
  return e;
}
function resolve(target?: El | string | null): El {
  if (!target) return document.body;
  if (typeof target === "string") {
    const e = document.querySelector<El>(target);
    if (!e) throw new Error(`Viz: element not found: ${target}`);
    return e;
  }
  return target;
}

/** Base direction of a label from its first strong character (Hebrew → rtl, otherwise ltr). */
const dirOf = (s: string): CanvasDirection => {
  const m = s.match(/[A-Za-z\u0590-\u05FF]/);
  return m && /[\u0590-\u05FF]/.test(m[0]) ? "rtl" : "ltr";
};

export function fmt(x: number, digits = 3): string {
  if (!Number.isFinite(x)) return String(x);
  if (x !== 0 && (Math.abs(x) >= 1e5 || Math.abs(x) < 1e-3)) return x.toExponential(2);
  return String(Number(x.toFixed(digits)));
}

function tex(texSrc: string, display: boolean): string {
  try {
    return katex.renderToString(texSrc, { displayMode: display, output: "mathml", throwOnError: false, strict: "ignore" });
  } catch {
    return texSrc.replace(/</g, "&lt;");
  }
}

/* ------------------------------------------------------------------ layout & controls */
export interface AppOptions {
  title: string;
  subtitle?: string;
  /** "side" (default): controls panel beside the stage. "below": stage full width, panel underneath. */
  panel?: "side" | "below";
  /** Lay out stage cards in two columns on wide screens. */
  columns?: 1 | 2;
}

export function app(opts: AppOptions) {
  injectCss();
  const root = h("div", "viz-app", document.body);
  const head = h("div", "viz-head", root);
  h("h1", "", head, opts.title);
  if (opts.subtitle) h("p", "", head, opts.subtitle);
  const main = h("div", "viz-main" + (opts.panel === "below" ? " viz-wide" : ""), root);
  const stage = h("div", "viz-stage" + (opts.columns === 2 ? " viz-cols-2" : ""), main);
  const panelEl = h("div", "viz-panel", main);
  const footer = h("div", "viz-app", root);
  const p = panel(panelEl);
  return {
    root,
    stage,
    panelEl,
    footer,
    /** A bordered card in the stage, optionally titled. Pass it to plot2d / scene3d. */
    card(title?: string, height?: number) {
      const c = h("div", "viz-card", stage);
      if (title) h("div", "viz-card-title", c, title);
      if (height) c.style.height = `${height}px`;
      return c;
    },
    ...p,
    note(html: string) {
      return note(footer, html);
    },
    formula(texSrc: string) {
      return formula(footer, texSrc);
    },
  };
}

/** Controls bound to a container (the app's side panel, or any element). */
export function panel(container: El) {
  return {
    slider(o: { label: string; min: number; max: number; step?: number; value: number; format?: (v: number) => string }, onInput: (v: number) => void) {
      const wrap = h("div", "viz-ctl", container);
      const lab = h("label", "", wrap);
      h("span", "", lab, o.label);
      const out = h("output", "", lab);
      const input = h("input", "", wrap) as HTMLInputElement;
      input.type = "range";
      input.min = String(o.min);
      input.max = String(o.max);
      input.step = String(o.step ?? (o.max - o.min) / 100);
      input.value = String(o.value);
      const show = () => (out.textContent = o.format ? o.format(+input.value) : fmt(+input.value));
      input.addEventListener("input", () => {
        show();
        onInput(+input.value);
      });
      show();
      return {
        get value() {
          return +input.value;
        },
        set(v: number, fire = true) {
          input.value = String(v);
          show();
          if (fire) onInput(+input.value);
        },
      };
    },
    select(o: { label: string; options: (string | { value: string; label: string })[]; value?: string }, onChange: (v: string) => void) {
      const wrap = h("div", "viz-ctl", container);
      h("label", "", wrap).append(h("span", "", null, o.label));
      const sel = h("select", "", wrap) as HTMLSelectElement;
      for (const opt of o.options) {
        const { value, label } = typeof opt === "string" ? { value: opt, label: opt } : opt;
        const e = h("option", "", sel, label) as HTMLOptionElement;
        e.value = value;
      }
      if (o.value != null) sel.value = o.value;
      sel.addEventListener("change", () => onChange(sel.value));
      return { get value() { return sel.value; } };
    },
    toggle(o: { label: string; value?: boolean }, onChange: (v: boolean) => void) {
      const lab = h("label", "viz-toggle", container);
      const cb = h("input", "", lab) as HTMLInputElement;
      cb.type = "checkbox";
      cb.checked = !!o.value;
      lab.append(o.label);
      cb.addEventListener("change", () => onChange(cb.checked));
      return { get value() { return cb.checked; } };
    },
    buttons(list: { label: string; onClick: () => void; primary?: boolean }[]) {
      const row = h("div", "viz-btns", container);
      return list.map((b) => {
        const btn = h("button", "viz-btn" + (b.primary ? " primary" : ""), row, b.label) as HTMLButtonElement;
        btn.type = "button";
        btn.addEventListener("click", b.onClick);
        return btn;
      });
    },
    /** Live numbers: readouts({ "P(A)": 0.3 }) once, then .set({...}) on every update. Keys may be LaTeX if wrapped in $...$. */
    readouts(initial: Record<string, number | string>) {
      const dl = h("dl", "viz-readouts", container);
      const cells = new Map<string, El>();
      const set = (vals: Record<string, number | string>) => {
        for (const [k, v] of Object.entries(vals)) {
          let dd = cells.get(k);
          if (!dd) {
            const dt = h("dt", "", dl);
            if (/^\$.*\$$/.test(k)) dt.innerHTML = tex(k.slice(1, -1), false);
            else dt.textContent = k;
            dd = h("dd", "", dl);
            cells.set(k, dd);
          }
          dd.textContent = typeof v === "number" ? fmt(v) : v;
        }
      };
      set(initial);
      return { set };
    },
    note(html: string) {
      return note(container, html);
    },
    formula(texSrc: string) {
      return formula(container, texSrc);
    },
  };
}

export function note(container: El | string, html: string) {
  injectCss();
  const e = h("div", "viz-note", resolve(container));
  e.innerHTML = html.replace(/\$([^$]+)\$/g, (_m, t) => tex(t, false));
  return e;
}

/** A display formula box (always LTR). Returns { set(tex) } to update it live. */
export function formula(container: El | string, texSrc: string) {
  injectCss();
  const e = h("div", "viz-formula", resolve(container));
  const set = (t: string) => (e.innerHTML = tex(t, true));
  set(texSrc);
  return { el: e, set };
}

/* ------------------------------------------------------------------ math & random */
export function rng(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    uniform: (lo = 0, hi = 1) => lo + (hi - lo) * next(),
    int: (lo: number, hi: number) => Math.floor(lo + (hi - lo + 1) * next()),
    normal: (mu = 0, sigma = 1) => {
      const u = 1 - next();
      const v = next();
      return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    bernoulli: (p: number) => next() < p,
    pick: <T,>(arr: T[]) => arr[Math.floor(next() * arr.length)],
  };
}

function erf(x: number) {
  const s = Math.sign(x);
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const logGamma = (z: number): number => {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
};
export const stats = {
  normalPdf: (x: number, mu = 0, s = 1) => Math.exp(-0.5 * ((x - mu) / s) ** 2) / (s * Math.sqrt(2 * Math.PI)),
  normalCdf: (x: number, mu = 0, s = 1) => 0.5 * (1 + erf((x - mu) / (s * Math.SQRT2))),
  binomPmf: (k: number, n: number, p: number) =>
    k < 0 || k > n ? 0 : Math.exp(logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1) + k * Math.log(p || 1e-300) + (n - k) * Math.log(1 - p || 1e-300)),
  poissonPmf: (k: number, lam: number) => (k < 0 ? 0 : Math.exp(k * Math.log(lam) - lam - logGamma(k + 1))),
  expPdf: (x: number, lam: number) => (x < 0 ? 0 : lam * Math.exp(-lam * x)),
  choose: (n: number, k: number) => Math.round(Math.exp(logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1))),
  mean: (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1),
  variance: (a: number[]) => {
    const m = stats.mean(a);
    return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length || 1);
  },
  linspace: (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1)),
};

/** Viridis-like colormap, t ∈ [0,1] → "#rrggbb". */
const CMAP = [
  [68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142],
  [31, 158, 137], [53, 183, 121], [109, 205, 89], [180, 222, 44], [253, 231, 37],
];
export function colormap(t: number): string {
  t = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (CMAP.length - 1);
  const i = Math.min(CMAP.length - 2, Math.floor(t));
  const f = t - i;
  const c = CMAP[i].map((v, k) => Math.round(v + (CMAP[i + 1][k] - v) * f));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** requestAnimationFrame loop with pause/resume. cb(t seconds, dt seconds). */
export function animate(cb: (t: number, dt: number) => void) {
  let running = true;
  let last = performance.now();
  let t = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (running) {
      t += dt;
      cb(t, dt);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return {
    get running() { return running; },
    pause: () => (running = false),
    play: () => { running = true; last = performance.now(); },
    toggle: () => (running ? (running = false) : ((running = true), (last = performance.now()))),
    reset: () => (t = 0),
  };
}

/* ------------------------------------------------------------------ 2D plot */
export interface Plot2DOptions {
  x: [number, number];
  y?: [number, number];
  height?: number;
  xLabel?: string;
  yLabel?: string;
  /** Equal scale on both axes (geometry). */
  equal?: boolean;
  grid?: boolean;
  /** Show coordinates under the mouse. Default true. */
  hover?: boolean;
}

type Style = { color?: string; width?: number; dash?: number[]; label?: string; fill?: string | boolean; opacity?: number };

export function plot2d(target: El | string, opts: Plot2DOptions) {
  injectCss();
  const host = resolve(target);
  host.style.position ||= "relative";
  const wrap = h("div", "", host);
  wrap.style.position = "relative";
  const canvas = h("canvas", "", wrap) as HTMLCanvasElement;
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = `${opts.height ?? 300}px`;
  const legendEl = h("div", "viz-legend", wrap);
  const tip = h("div", "viz-tip", wrap);
  const ctx = canvas.getContext("2d")!;
  let xr = [...opts.x] as [number, number];
  let yr = [...(opts.y ?? [0, 1])] as [number, number];
  const autoY = !opts.y;
  let drawFn: (g: Graphics) => void = () => {};
  const M = { l: 48, r: 14, t: 16, b: 36 };
  let W = 0;
  let H = 0;
  let colorIdx = 0;
  let legend: { label: string; color: string }[] = [];

  const sx = (x: number) => M.l + ((x - xr[0]) / (xr[1] - xr[0])) * (W - M.l - M.r);
  const sy = (y: number) => H - M.b - ((y - yr[0]) / (yr[1] - yr[0])) * (H - M.t - M.b);
  const ix = (px: number) => xr[0] + ((px - M.l) / (W - M.l - M.r)) * (xr[1] - xr[0]);
  const iy = (py: number) => yr[0] + ((H - M.b - py) / (H - M.t - M.b)) * (yr[1] - yr[0]);
  const nextColor = () => PALETTE[colorIdx++ % PALETTE.length];

  function ticks(a: number, b: number, n: number) {
    const span = b - a;
    const step0 = span / n;
    const mag = 10 ** Math.floor(Math.log10(step0));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
    const out: number[] = [];
    for (let v = Math.ceil(a / step) * step; v <= b + 1e-9 * span; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return out;
  }

  function stroke(st: Style, fallback: string) {
    ctx.strokeStyle = st.color ?? fallback;
    ctx.lineWidth = st.width ?? 2.5;
    ctx.setLineDash(st.dash ?? []);
    ctx.globalAlpha = st.opacity ?? 1;
  }
  function addLegend(st: Style, color: string) {
    if (st.label) legend.push({ label: st.label, color });
  }

  const g = {
    /** y = f(x) */
    fn(f: (x: number) => number, st: Style = {}) {
      const color = st.color ?? nextColor();
      const n = Math.max(200, Math.floor(W));
      const pts: [number, number][] = [];
      for (let i = 0; i <= n; i++) {
        const x = xr[0] + ((xr[1] - xr[0]) * i) / n;
        pts.push([x, f(x)]);
      }
      if (st.fill) g.area(pts, { ...st, color });
      g.line(pts, { ...st, color, label: undefined });
      addLegend(st, color);
      return g;
    },
    /** Polyline through data points. */
    line(pts: [number, number][], st: Style = {}) {
      const color = st.color ?? nextColor();
      ctx.save();
      clip();
      stroke(st, color);
      ctx.beginPath();
      let pen = false;
      for (const [x, y] of pts) {
        if (!Number.isFinite(y)) { pen = false; continue; }
        pen ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y));
        pen = true;
      }
      ctx.stroke();
      ctx.restore();
      addLegend(st, color);
      return g;
    },
    /** Shaded area between the curve and y=0 (or `base`). */
    area(pts: [number, number][], st: Style & { base?: number } = {}) {
      const color = st.color ?? nextColor();
      const base = st.base ?? 0;
      ctx.save();
      clip();
      ctx.fillStyle = typeof st.fill === "string" ? st.fill : color;
      ctx.globalAlpha = st.opacity ?? 0.18;
      ctx.beginPath();
      ctx.moveTo(sx(pts[0][0]), sy(base));
      for (const [x, y] of pts) ctx.lineTo(sx(x), sy(Number.isFinite(y) ? y : base));
      ctx.lineTo(sx(pts[pts.length - 1][0]), sy(base));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return g;
    },
    /** Shade under f between a and b. */
    shade(f: (x: number) => number, a: number, b: number, st: Style = {}) {
      const pts = stats.linspace(a, b, 120).map((x) => [x, f(x)] as [number, number]);
      return g.area(pts, { opacity: 0.25, ...st });
    },
    points(pts: [number, number][], st: Style & { r?: number } = {}) {
      const color = st.color ?? nextColor();
      ctx.save();
      clip();
      ctx.fillStyle = color;
      ctx.globalAlpha = st.opacity ?? 0.9;
      const r = st.r ?? 4;
      for (const [x, y] of pts) {
        ctx.beginPath();
        ctx.arc(sx(x), sy(y), r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      addLegend(st, color);
      return g;
    },
    /** Bars centred at x with width w (default: 0.8 spacing). */
    bars(data: { x: number; y: number; color?: string }[], st: Style & { w?: number } = {}) {
      const color = st.color ?? nextColor();
      const w = st.w ?? (data.length > 1 ? Math.abs(data[1].x - data[0].x) * 0.8 : 0.8);
      ctx.save();
      clip();
      for (const d of data) {
        ctx.fillStyle = d.color ?? color;
        ctx.globalAlpha = st.opacity ?? 0.85;
        const x0 = sx(d.x - w / 2);
        const x1 = sx(d.x + w / 2);
        const y0 = sy(Math.max(0, yr[0]));
        const y1 = sy(d.y);
        ctx.beginPath();
        ctx.roundRect(x0, Math.min(y0, y1), Math.max(1, x1 - x0), Math.abs(y0 - y1), 3);
        ctx.fill();
      }
      ctx.restore();
      addLegend(st, color);
      return g;
    },
    vline(x: number, st: Style = {}) {
      return g.line([[x, yr[0]], [x, yr[1]]], { width: 1.5, dash: [5, 4], color: MUTED, ...st });
    },
    hline(y: number, st: Style = {}) {
      return g.line([[xr[0], y], [xr[1], y]], { width: 1.5, dash: [5, 4], color: MUTED, ...st });
    },
    arrow(from: [number, number], to: [number, number], st: Style = {}) {
      const color = st.color ?? nextColor();
      const [x0, y0, x1, y1] = [sx(from[0]), sy(from[1]), sx(to[0]), sy(to[1])];
      const a = Math.atan2(y1 - y0, x1 - x0);
      ctx.save();
      stroke(st, color);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - 11 * Math.cos(a - 0.4), y1 - 11 * Math.sin(a - 0.4));
      ctx.lineTo(x1 - 11 * Math.cos(a + 0.4), y1 - 11 * Math.sin(a + 0.4));
      ctx.fill();
      ctx.restore();
      addLegend(st, color);
      return g;
    },
    text(x: number, y: number, s: string, st: { color?: string; size?: number; align?: CanvasTextAlign; bold?: boolean } = {}) {
      ctx.save();
      ctx.fillStyle = st.color ?? INK;
      ctx.font = `${st.bold ? 700 : 500} ${st.size ?? 13}px system-ui, sans-serif`;
      ctx.textAlign = st.align ?? "center";
      ctx.textBaseline = "middle";
      ctx.direction = dirOf(s);
      ctx.fillText(s, sx(x), sy(y));
      ctx.restore();
      return g;
    },
    /** Pixel helpers for custom drawing with g.ctx. */
    sx,
    sy,
    ctx,
  };
  type Graphics = typeof g;

  function clip() {
    ctx.beginPath();
    ctx.rect(M.l, M.t, W - M.l - M.r, H - M.t - M.b);
    ctx.clip();
  }

  function axes() {
    ctx.save();
    ctx.direction = "ltr";
    ctx.font = "11px ui-monospace, Menlo, monospace";
    ctx.fillStyle = MUTED;
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    for (const v of ticks(xr[0], xr[1], Math.max(3, Math.floor(W / 80)))) {
      if (opts.grid !== false) {
        ctx.beginPath();
        ctx.moveTo(sx(v), M.t);
        ctx.lineTo(sx(v), H - M.b);
        ctx.stroke();
      }
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(fmt(v), sx(v), H - M.b + 6);
    }
    for (const v of ticks(yr[0], yr[1], Math.max(3, Math.floor(H / 60)))) {
      if (opts.grid !== false) {
        ctx.beginPath();
        ctx.moveTo(M.l, sy(v));
        ctx.lineTo(W - M.r, sy(v));
        ctx.stroke();
      }
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(fmt(v), M.l - 6, sy(v));
    }
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 1.2;
    const y0 = yr[0] <= 0 && yr[1] >= 0 ? sy(0) : H - M.b;
    const x0 = xr[0] <= 0 && xr[1] >= 0 ? sx(0) : M.l;
    ctx.beginPath();
    ctx.moveTo(M.l, y0);
    ctx.lineTo(W - M.r, y0);
    ctx.moveTo(x0, M.t);
    ctx.lineTo(x0, H - M.b);
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = "600 12px system-ui, sans-serif";
    if (opts.xLabel) {
      ctx.direction = dirOf(opts.xLabel);
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(opts.xLabel, M.l + (W - M.l - M.r) / 2, H - 2);
    }
    if (opts.yLabel) {
      ctx.save();
      ctx.translate(12, M.t + (H - M.t - M.b) / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.direction = dirOf(opts.yLabel);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(opts.yLabel, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  function render() {
    const dpr = window.devicePixelRatio || 1;
    W = canvas.clientWidth || 600;
    H = canvas.clientHeight || 300;
    if (canvas.width !== Math.round(W * dpr)) canvas.width = Math.round(W * dpr);
    if (canvas.height !== Math.round(H * dpr)) canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (opts.equal) {
      const ppu = (W - M.l - M.r) / (xr[1] - xr[0]);
      const mid = (yr[0] + yr[1]) / 2;
      const half = (H - M.t - M.b) / ppu / 2;
      yr = [mid - half, mid + half];
    }
    colorIdx = 0;
    legend = [];
    if (autoY) {
      // Dry run to find the y-range from the user's draw function.
      const ys: number[] = [];
      const probe = new Proxy(g, {
        get(t, k) {
          if (k === "fn") return (f: (x: number) => number) => { for (const x of stats.linspace(xr[0], xr[1], 120)) ys.push(f(x)); return probe; };
          if (k === "line" || k === "points" || k === "area") return (pts: [number, number][]) => { for (const p of pts) ys.push(p[1]); return probe; };
          if (k === "bars") return (d: { y: number }[]) => { for (const p of d) ys.push(p.y); ys.push(0); return probe; };
          if (typeof (t as Record<string | symbol, unknown>)[k] === "function") return () => probe;
          return (t as Record<string | symbol, unknown>)[k];
        },
      });
      try {
        drawFn(probe as Graphics);
      } catch {
        /* real draw will surface the error */
      }
      const fin = ys.filter(Number.isFinite);
      if (fin.length) {
        let lo = Math.min(0, ...fin);
        let hi = Math.max(...fin);
        if (hi - lo < 1e-9) hi = lo + 1;
        const pad = (hi - lo) * 0.08;
        yr = [lo === 0 ? 0 : lo - pad, hi + pad];
      }
    }
    axes();
    drawFn(g);
    legendEl.innerHTML = "";
    legendEl.style.display = legend.length ? "" : "none";
    for (const l of legend) {
      const s = h("span", "", legendEl);
      const i = h("i", "", s);
      i.style.background = l.color;
      s.append(l.label);
    }
  }

  if (opts.hover !== false) {
    canvas.addEventListener("mousemove", (e) => {
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      if (px < M.l || px > W - M.r || py < M.t || py > H - M.b) return (tip.style.display = "none");
      tip.style.display = "block";
      tip.style.left = `${px}px`;
      tip.style.top = `${py}px`;
      tip.textContent = `(${fmt(ix(px), 2)}, ${fmt(iy(py), 3)})`;
    });
    canvas.addEventListener("mouseleave", () => (tip.style.display = "none"));
  }
  new ResizeObserver(() => render()).observe(canvas);

  return {
    canvas,
    /** Set the draw function and render. It is re-run on every resize / redraw(). */
    draw(fn: (g: Graphics) => void) {
      drawFn = fn;
      render();
    },
    redraw: render,
    setRange(x?: [number, number], y?: [number, number]) {
      if (x) xr = [...x];
      if (y) yr = [...y];
      render();
    },
    /** Convert a mouse event to data coordinates (for click/drag interactions). */
    toData(e: MouseEvent): [number, number] {
      const r = canvas.getBoundingClientRect();
      return [ix(e.clientX - r.left), iy(e.clientY - r.top)];
    },
  };
}

/* ------------------------------------------------------------------ 3D scene */
export interface Scene3DOptions {
  height?: number;
  /** Camera position (z is up). Default [6, -7, 5]. */
  camera?: [number, number, number];
  target?: [number, number, number];
  /** Axis length, or false. Default 3. */
  axes?: number | false;
  axisLabels?: [string, string, string];
  /** Floor grid size, or false. Default 6. */
  grid?: number | false;
  autoRotate?: boolean;
  background?: string;
}

type V3 = [number, number, number];
const v = (p: V3) => new THREE.Vector3(p[0], p[1], p[2]);

function textSprite(text: string, color = INK, size = 0.35, bold = true) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const font = `${bold ? 700 : 500} 64px system-ui, -apple-system, "Arial Hebrew", sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 24;
  c.width = w;
  c.height = 88;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.direction = dirOf(text);
  ctx.fillText(text, w / 2, 46);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const s = new THREE.Sprite(mat);
  s.scale.set((size * w) / 88, size, 1);
  s.renderOrder = 10;
  return s;
}

export function scene3d(target: El | string, opts: Scene3DOptions = {}) {
  injectCss();
  const host = resolve(target);
  host.style.position ||= "relative";
  const box = h("div", "", host);
  box.style.position = "relative";
  box.style.height = `${opts.height ?? 380}px`;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });
  } catch {
    box.innerHTML = `<div class="viz-note" style="margin:12px">הדפדפן לא תומך בתלת-ממד (WebGL). נסו Chrome או Edge מעודכנים.</div>`;
    throw new Error("WebGL is not available in this browser");
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  box.appendChild(renderer.domElement);
  h("div", "viz-hint", box, "גררו לסיבוב · גלגלת לזום");

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(opts.background ?? "#f8fafc");
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
  camera.up.set(0, 0, 1);
  camera.position.copy(v(opts.camera ?? [6, -7, 5]));
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(v(opts.target ?? [0, 0, 0]));
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = !!opts.autoRotate;
  controls.autoRotateSpeed = 0.8;
  controls.update();

  scene.add(new THREE.HemisphereLight(0xffffff, 0xcbd5e1, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(5, -4, 9);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5);
  fill.position.set(-6, 5, 3);
  scene.add(fill);

  const fixed = new THREE.Group();
  scene.add(fixed);
  const user = new THREE.Group();
  scene.add(user);

  if (opts.grid !== false) {
    const size = opts.grid ?? 6;
    const grid = new THREE.GridHelper(size, size * 2, 0xcbd5e1, 0xe2e8f0);
    grid.rotation.x = Math.PI / 2;
    // Centre the floor under the region being looked at.
    const tg = opts.target ?? [0, 0, 0];
    grid.position.set(Math.round(tg[0]), Math.round(tg[1]), 0);
    fixed.add(grid);
  }
  if (opts.axes !== false) {
    const L = opts.axes ?? 3;
    const labels = opts.axisLabels ?? ["x", "y", "z"];
    const cols = [0xdc2626, 0x059669, 0x2563eb];
    const dirs: V3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    dirs.forEach((d, i) => {
      const arrow = new THREE.ArrowHelper(v(d), new THREE.Vector3(), L, cols[i], 0.22, 0.12);
      fixed.add(arrow);
      const lab = textSprite(labels[i], `#${cols[i].toString(16).padStart(6, "0")}`, 0.32);
      lab.position.copy(v(d).multiplyScalar(L + 0.3));
      fixed.add(lab);
    });
  }

  const frameCbs: ((t: number, dt: number) => void)[] = [];
  let t = 0;
  let last = performance.now();
  const resize = () => {
    const w = box.clientWidth || 600;
    const hh = box.clientHeight || 380;
    renderer.setSize(w, hh, false);
    camera.aspect = w / hh;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(box);
  resize();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    t += dt;
    for (const cb of frameCbs) cb(t, dt);
    controls.update();
    renderer.render(scene, camera);
  });

  const material = (color: string | number | THREE.Color, o: { opacity?: number; flat?: boolean } = {}) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.45,
      metalness: 0.05,
      transparent: (o.opacity ?? 1) < 1,
      opacity: o.opacity ?? 1,
      flatShading: !!o.flat,
      side: THREE.DoubleSide,
    });

  const api = {
    THREE,
    scene,
    camera,
    controls,
    renderer,
    /** Group holding everything added through this API; clear() empties it. */
    group: user,
    add<T extends THREE.Object3D>(obj: T): T {
      user.add(obj);
      return obj;
    },
    clear() {
      for (const c of [...user.children]) {
        user.remove(c);
        c.traverse((o) => {
          const m = o as THREE.Mesh;
          m.geometry?.dispose?.();
          const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
          for (const mt of mats) {
            (mt as THREE.MeshBasicMaterial).map?.dispose();
            mt.dispose();
          }
        });
      }
    },
    /** Surface z = f(x, y), coloured by height. Returns the mesh; call again (after clear or remove) to update. */
    surface(
      f: (x: number, y: number) => number,
      o: { x?: [number, number]; y?: [number, number]; segments?: number; color?: string; colormap?: boolean; opacity?: number; wireframe?: boolean; zScale?: number } = {},
    ) {
      const [x0, x1] = o.x ?? [-3, 3];
      const [y0, y1] = o.y ?? [-3, 3];
      const n = o.segments ?? 80;
      const zs = o.zScale ?? 1;
      const geo = new THREE.PlaneGeometry(x1 - x0, y1 - y0, n, n);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      let zmin = Infinity;
      let zmax = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) + (x0 + x1) / 2;
        const y = pos.getY(i) + (y0 + y1) / 2;
        let z = f(x, y) * zs;
        if (!Number.isFinite(z)) z = 0;
        pos.setXYZ(i, x, y, z);
        zmin = Math.min(zmin, z);
        zmax = Math.max(zmax, z);
      }
      geo.computeVertexNormals();
      const useMap = o.colormap !== false && !o.color;
      if (useMap) {
        const colors = new Float32Array(pos.count * 3);
        const c = new THREE.Color();
        for (let i = 0; i < pos.count; i++) {
          c.set(colormap((pos.getZ(i) - zmin) / (zmax - zmin || 1)));
          colors.set([c.r, c.g, c.b], i * 3);
        }
        geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      }
      const mat = material(useMap ? 0xffffff : (o.color ?? PALETTE[0]), { opacity: o.opacity });
      if (useMap) mat.vertexColors = true;
      const mesh = new THREE.Mesh(geo, mat);
      if (o.wireframe !== false) {
        const wire = new THREE.LineSegments(
          new THREE.WireframeGeometry(new THREE.PlaneGeometry(1, 1, 1, 1)),
          new THREE.LineBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.12 }),
        );
        wire.geometry.dispose();
        wire.geometry = new THREE.WireframeGeometry(geo);
        mesh.add(wire);
      }
      return api.add(mesh);
    },
    /** Parametric curve p(t), t ∈ [a, b], drawn as a tube. */
    curve(p: (t: number) => V3, o: { t?: [number, number]; color?: string; radius?: number; segments?: number } = {}) {
      const [a, b] = o.t ?? [0, 1];
      const n = o.segments ?? 200;
      const pts = Array.from({ length: n + 1 }, (_, i) => v(p(a + ((b - a) * i) / n)));
      const path = new THREE.CatmullRomCurve3(pts);
      const geo = new THREE.TubeGeometry(path, n, o.radius ?? 0.035, 10, false);
      return api.add(new THREE.Mesh(geo, material(o.color ?? PALETTE[1])));
    },
    line(points: V3[], o: { color?: string; radius?: number } = {}) {
      if (points.length < 2) return null;
      const path = new THREE.CatmullRomCurve3(points.map(v), false, "centripetal", 0);
      const geo = new THREE.TubeGeometry(path, Math.max(2, points.length * 4), o.radius ?? 0.025, 8, false);
      return api.add(new THREE.Mesh(geo, material(o.color ?? PALETTE[7])));
    },
    arrow(from: V3, to: V3, o: { color?: string; label?: string } = {}) {
      const a = v(from);
      const d = v(to).sub(a);
      const len = d.length();
      const color = new THREE.Color(o.color ?? PALETTE[1]);
      const grp = new THREE.Group();
      const shaftLen = Math.max(0.001, len - 0.25);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, shaftLen, 12), material(color));
      shaft.position.y = shaftLen / 2;
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.25, 16), material(color));
      head.position.y = shaftLen + 0.125;
      grp.add(shaft, head);
      grp.position.copy(a);
      grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
      if (o.label) {
        const lab = textSprite(o.label, `#${color.getHexString()}`, 0.3);
        lab.position.set(0, len + 0.25, 0);
        grp.add(lab);
      }
      return api.add(grp);
    },
    sphere(pos: V3, o: { r?: number; color?: string; opacity?: number } = {}) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(o.r ?? 0.08, 24, 16), material(o.color ?? PALETTE[1], { opacity: o.opacity }));
      m.position.copy(v(pos));
      return api.add(m);
    },
    /** Many points at once (fast; for samples / scatter clouds). */
    points(list: V3[], o: { color?: string | ((p: V3, i: number) => string); size?: number } = {}) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(list.flat(), 3));
      const perPoint = typeof o.color === "function";
      if (perPoint) {
        const c = new THREE.Color();
        const cols = new Float32Array(list.length * 3);
        list.forEach((p, i) => {
          c.set((o.color as (p: V3, i: number) => string)(p, i));
          cols.set([c.r, c.g, c.b], i * 3);
        });
        geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
      }
      const sprite = (() => {
        const c = document.createElement("canvas");
        c.width = c.height = 64;
        const g2 = c.getContext("2d")!;
        g2.beginPath();
        g2.arc(32, 32, 28, 0, Math.PI * 2);
        g2.fillStyle = "#fff";
        g2.fill();
        return new THREE.CanvasTexture(c);
      })();
      const mat = new THREE.PointsMaterial({
        size: o.size ?? 0.12,
        color: perPoint ? 0xffffff : (o.color as string) ?? PALETTE[0],
        vertexColors: perPoint,
        map: sprite,
        alphaTest: 0.5,
        sizeAttenuation: true,
      });
      return api.add(new THREE.Points(geo, mat));
    },
    /** A box column from z=0 to height (3D histograms / joint PMFs). */
    bar(x: number, y: number, height: number, o: { w?: number; color?: string; opacity?: number } = {}) {
      const w = o.w ?? 0.8;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, w, Math.max(1e-4, height)), material(o.color ?? PALETTE[0], { opacity: o.opacity }));
      m.position.set(x, y, height / 2);
      return api.add(m);
    },
    /** Flat plane through a point with a normal (decision boundaries, cross-sections). */
    plane(point: V3, normal: V3, o: { size?: number; color?: string; opacity?: number } = {}) {
      const s = o.size ?? 4;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), material(o.color ?? PALETTE[4], { opacity: o.opacity ?? 0.35 }));
      m.position.copy(v(point));
      m.lookAt(v(point).add(v(normal)));
      return api.add(m);
    },
    label(text: string, pos: V3, o: { color?: string; size?: number } = {}) {
      const s = textSprite(text, o.color ?? INK, o.size ?? 0.3);
      s.position.copy(v(pos));
      return api.add(s);
    },
    /** Called every frame: cb(t seconds since start, dt). */
    onFrame(cb: (t: number, dt: number) => void) {
      frameCbs.push(cb);
    },
    setCamera(pos: V3, target?: V3) {
      camera.position.copy(v(pos));
      if (target) controls.target.copy(v(target));
      controls.update();
    },
  };
  return api;
}

/* ------------------------------------------------------------------ export */
const Viz = { app, panel, note, formula, plot2d, scene3d, animate, rng, stats, colormap, fmt, palette: PALETTE, tex: (t: string, display = false) => tex(t, display) };
(window as unknown as { Viz: typeof Viz; THREE: typeof THREE }).Viz = Viz;
(window as unknown as { THREE: typeof THREE }).THREE = THREE;
injectCss();
