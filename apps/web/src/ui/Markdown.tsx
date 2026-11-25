import { useMemo } from "react";
import { marked } from "marked";
import katex from "katex";
import DOMPurify from "dompurify";
import { useCitations } from "./Citations.tsx";

marked.setOptions({ gfm: true, breaks: true });

/** Markdown + KaTeX ($...$, $$...$$) + inline [S12] citations → sanitized HTML. */
export function renderMarkdown(src: string): string {
  const math: string[] = [];
  const stash = (html: string) => `@@MATH${math.push(html) - 1}@@`;
  let text = src
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex) => stash(safeKatex(tex, true)))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, tex) => stash(safeKatex(tex, true)))
    .replace(/(^|[^\\$])\$([^\n$]+?)\$/g, (_m, pre, tex) => pre + stash(safeKatex(tex, false)))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, tex) => stash(safeKatex(tex, false)));
  text = text.replace(/\[(S\d+)\]/g, (_m, id) => `<button type="button" class="cite" data-cite="${id}">${id}</button>`);
  let html = marked.parse(text, { async: false }) as string;
  html = html.replace(/@@MATH(\d+)@@/g, (_m, i) => math[Number(i)]);
  return DOMPurify.sanitize(html, { ADD_ATTR: ["data-cite", "aria-hidden"], ADD_TAGS: ["button"] });
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
        const el = (e.target as HTMLElement).closest("[data-cite]");
        if (el) open(el.getAttribute("data-cite")!);
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
