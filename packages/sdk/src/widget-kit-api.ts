/**
 * Reference for the Viz Kit that the platform injects into every interactive widget
 * (implementation: apps/web/src/widget-kit/kit.ts). Tools that output `interactive_widget`
 * include this text in their prompt so the model writes short code against a stable API.
 */
export const WIDGET_KIT_API = `## Viz Kit — available as globals inside the widget (no imports, no network)

\`Viz\` (helpers) and \`THREE\` (three.js r187) are already loaded. Coordinates in 3D: z is UP.

### Layout & controls
const ui = Viz.app({ title, subtitle?, panel?: "side"|"below", columns?: 1|2 })
  ui.card(title?, height?) → HTMLElement   // a bordered stage card; pass it to plot2d / scene3d
  ui.slider({ label, min, max, step?, value, format?: v=>string }, v => {...}) → { value, set(v) }
  ui.select({ label, options: ["a","b"] | [{value,label}], value? }, v => {...})
  ui.toggle({ label, value? }, checked => {...})
  ui.buttons([{ label, onClick, primary? }])
  ui.readouts({ "שם": 0.12, "$P(A\\\\mid B)$": 0.5 }) → { set({...}) }   // live numbers; keys in $...$ render as LaTeX
  ui.formula("P(A\\\\mid B)=\\\\frac{P(B\\\\mid A)P(A)}{P(B)}") → { set(tex) }   // LTR formula box (KaTeX)
  ui.note("<b>מה לשים לב:</b> ... $x^2$ ...")   // amber callout under the stage; $...$ becomes math

### 2D plot (crisp, responsive, axes + grid + hover coordinates + legend)
const p = Viz.plot2d(card, { x: [a, b], y?: [c, d] /* auto if omitted */, height?: 300, xLabel?, yLabel?, equal? })
p.draw(g => {            // re-run on every p.redraw() and on resize
  g.fn(x => ..., { color?, width?, dash?: [6,4], label?, fill?: true })
  g.shade(f, a, b, { color? })          // area under f on [a,b]
  g.bars([{ x, y, color? }], { w?, label? })
  g.points([[x, y], ...], { r?, color?, label? })
  g.line([[x, y], ...], { ... })   g.vline(x, {...})   g.hline(y, {...})
  g.arrow([x0, y0], [x1, y1], { color? })   g.text(x, y, "טקסט", { color?, size?, bold? })
  // custom drawing: g.ctx (CanvasRenderingContext2D) with g.sx(x), g.sy(y) for pixel coords
})
p.redraw()   p.setRange(x?, y?)   p.toData(mouseEvent) → [x, y]   p.canvas

### 3D scene (three.js with lighting, orbit controls, axes, grid already set up)
const s = Viz.scene3d(card, { height?: 380, camera?: [6,-7,5], target?: [0,0,0], axes?: 3|false, axisLabels?: ["x","y","z"], grid?: 6|false, autoRotate? })
  s.surface((x, y) => z, { x?: [-3,3], y?: [-3,3], segments?: 80, colormap?: true, color?, opacity?, wireframe?: true, zScale? })
  s.curve(t => [x, y, z], { t: [a, b], color?, radius? })
  s.line([[x,y,z], ...], { color?, radius? })
  s.arrow([x,y,z], [x,y,z], { color?, label? })
  s.sphere([x,y,z], { r?, color?, opacity? })
  s.points([[x,y,z], ...], { color?: "#hex" | (p,i)=>"#hex", size? })   // fast clouds (thousands)
  s.bar(x, y, height, { w?, color?, opacity? })                        // 3D histograms / joint PMFs
  s.plane([x,y,z], normal, { size?, color?, opacity? })
  s.label("טקסט", [x,y,z], { color?, size? })
  s.clear()               // remove everything added (call before rebuilding on slider change)
  s.onFrame((t, dt) => {...})   s.setCamera(pos, target?)   s.add(anyThreeObject)   s.THREE, s.scene, s.camera
  Every method returns the three.js object, so you can update it (e.g. mesh.position.set(...), mesh.visible = false).

### Utilities
Viz.animate((t, dt) => {...}) → { play, pause, toggle, reset, running }
Viz.rng(seed) → { next, uniform(a,b), int(a,b), normal(mu,s), bernoulli(p), pick(arr) }   // reproducible
Viz.stats: normalPdf(x,mu,s), normalCdf, binomPmf(k,n,p), poissonPmf(k,l), expPdf(x,l), choose(n,k), mean(arr), variance(arr), linspace(a,b,n)
Viz.colormap(t∈[0,1]) → "#hex"   Viz.palette (8 colours)   Viz.fmt(number, digits?)

### Skeleton
<script>
const ui = Viz.app({ title: "…", subtitle: "…" });
const plot3 = Viz.scene3d(ui.card("משטח"), { axisLabels: ["x", "y", "f"] });
const plot = Viz.plot2d(ui.card("חתך"), { x: [-3, 3], xLabel: "x" });
const out = ui.readouts({ "ערך": 0 });
const eq = ui.formula("f(x,y)=…");
let a = 1;
function update() {
  plot3.clear();
  plot3.surface((x, y) => …);
  plot.draw(g => { g.fn(x => …, { label: "…" }); });
  out.set({ "ערך": … });
}
ui.slider({ label: "a", min: 0, max: 3, step: 0.1, value: a }, v => { a = v; update(); });
ui.note("<b>מה לשים לב:</b> …");
update();
</script>`;
