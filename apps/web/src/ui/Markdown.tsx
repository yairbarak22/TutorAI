import { useMemo } from "react";
import { marked } from "marked";
import katex from "katex";
import DOMPurify from "dompurify";
import { useCitations } from "./Citations.tsx";

marked.setOptions({ gfm: true, breaks: true });

/**
 * Markdown + KaTeX ($...$, $$...$$) + inline [S12] citations → sanitized HTML.
 * Math is always left-to-right: display formulas go in a fixed "formula box",
 * inline math and runs of Latin text are bidi-isolated so they never scramble the Hebrew around them.
 */
export function renderMarkdown(src: string): string {
  const math: string[] = [];
  const stash = (html: string) => `@@MATH${math.push(html) - 1}@@`;
  const block = (tex: string) =>
    stash(`<div class="math-box" dir="ltr" data-tex="${encodeURIComponent(tex.trim())}">${safeKatex(tex, true)}</div>`);
  const inline = (tex: string) => stash(`<span class="math-inline" dir="ltr">${safeKatex(tex, false)}</span>`);
  let text = src
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex) => block(tex))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, tex) => block(tex))
    .replace(/(^|[^\\$])\$([^\n$]+?)\$/g, (_m, pre, tex) => pre + inline(tex))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, tex) => inline(tex));
  text = text.replace(/\[(S\d+)\]/g, (_m, id) => `<button type="button" class="cite" data-cite="${id}">${id}</button>`);
  let html = marked.parse(text, { async: false }) as string;
  html = html
    .replace(/<p>\s*(@@MATH\d+@@)\s*<\/p>/g, "$1")
    .replace(/@@MATH(\d+)@@/g, (_m, i) => math[Number(i)]);
  const clean = DOMPurify.sanitize(html, { ADD_ATTR: ["data-cite", "data-tex", "aria-hidden"], ADD_TAGS: ["button"] });
  return isolateLatin(clean);
}

const SKIP = new Set(["CODE", "PRE", "BUTTON", "BDI", "SCRIPT", "STYLE"]);
const LATIN_RUN = /[A-Za-z][A-Za-z0-9 .,:;'’()[\]{}+\-*/=<>^_|!?%]*[A-Za-z0-9)\]}%!']|[A-Za-z]/g;

/** Wraps runs of Latin text (English terms, plain-text formulas) in <bdi dir="ltr"> so punctuation stays put. */
function isolateLatin(html: string): string {
  if (typeof document === "undefined" || !/[A-Za-z]/.test(html)) return html;
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    if (!/[A-Za-z]/.test(t.data) || !/[\u0590-\u05FF]/.test(t.parentElement?.textContent ?? "")) continue;
    let el: Element | null = t.parentElement;
    let skip = false;
    for (; el; el = el.parentElement) if (SKIP.has(el.tagName) || el.classList.contains("katex") || el.classList.contains("math-box")) { skip = true; break; }
    if (!skip) targets.push(t);
  }
  for (const t of targets) {
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of t.data.matchAll(LATIN_RUN)) {
      const run = m[0].replace(/\s+$/, "");
      if (m.index! > last) frag.append(t.data.slice(last, m.index));
      const bdi = document.createElement("bdi");
      bdi.dir = "ltr";
      bdi.textContent = run;
      frag.append(bdi);
      last = m.index! + run.length;
    }
    frag.append(t.data.slice(last));
    t.replaceWith(frag);
  }
  return tpl.innerHTML;
}

function safeKatex(tex: string, display: boolean) {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html", strict: "ignore" });
  } catch {
    return `<code>${tex.replace(/</g, "&lt;")}</code>`;
  }
}

export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  const { open } = useCitations();
  return (
    <div
      dir="auto"
      className={`prose-he [&_.cite]:mx-0.5 [&_.cite]:rounded [&_.cite]:bg-brand-50 [&_.cite]:px-1 [&_.cite]:text-xs [&_.cite]:font-semibold [&_.cite]:text-brand-600 [&_.cite]:hover:bg-brand-100 ${className}`}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        const el = target.closest("[data-cite]");
        if (el) return open(el.getAttribute("data-cite")!);
        const box = target.closest<HTMLElement>(".math-box");
        if (box?.dataset.tex && e.detail === 2) {
          // Double-click a formula box → copy its LaTeX source.
          void navigator.clipboard?.writeText(decodeURIComponent(box.dataset.tex));
          box.classList.add("copied");
          setTimeout(() => box.classList.remove("copied"), 1200);
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
