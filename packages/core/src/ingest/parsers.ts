import JSZip from "jszip";

/** One addressable unit of a document: a PDF page, a slide, or a block of a text document. */
export interface RawUnit {
  anchor: string; // shown to students: "עמ' 4", "שקף 7", "קטע 2"
  page: number | null;
  title: string;
  text: string;
  /** PDF pages with almost no text (scans, formulas as images) — candidates for vision OCR. */
  sparse?: boolean;
}

export type SupportedKind = "pdf" | "pptx" | "docx" | "text";

/** Decided by file extension only — the browser-reported MIME type is not trusted. */
export function detectKind(name: string, _mime = ""): SupportedKind | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "pptx") return "pptx";
  if (ext === "docx") return "docx";
  if (["txt", "md", "markdown"].includes(ext)) return "text";
  return null;
}

/** Inert MIME type used when opening a stored file. Never an active type (html/svg/js). */
export function safeMimeFor(name: string): string {
  switch (detectKind(name)) {
    case "pdf":
      return "application/pdf";
    case "text":
      return "text/plain;charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");

/* ------------------------------ PPTX ------------------------------ */

/** Extracts text per slide (paragraph-aware) plus speaker notes. */
export async function parsePptx(bytes: Uint8Array): Promise<RawUnit[]> {
  const zip = await JSZip.loadAsync(bytes);
  const slideFiles = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));

  const units: RawUnit[] = [];
  for (const f of slideFiles) {
    const n = Number(f.match(/(\d+)\.xml$/)![1]);
    const xml = await zip.file(f)!.async("string");
    const paragraphs = drawingParagraphs(xml);
    const notesXml = await zip.file(`ppt/notesSlides/notesSlide${n}.xml`)?.async("string");
    const notes = notesXml ? drawingParagraphs(notesXml).filter((p) => !/^\d+$/.test(p)) : [];
    const title = paragraphs[0] ?? "";
    const text = [...paragraphs, ...(notes.length ? ["", "הערות מרצה:", ...notes] : [])].join("\n").trim();
    units.push({ anchor: `שקף ${n}`, page: n, title, text });
  }
  return units;
}

function drawingParagraphs(xml: string): string[] {
  const paras: string[] = [];
  for (const p of xml.match(/<a:p\b[\s\S]*?<\/a:p>/g) ?? []) {
    const runs = [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1]));
    const line = runs.join("").trim();
    if (line) paras.push(line);
  }
  return paras;
}

/* ------------------------------ DOCX ------------------------------ */

/** Splits a Word document into blocks by headings, max ~2500 chars per block. */
export async function parseDocx(bytes: Uint8Array): Promise<RawUnit[]> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("קובץ DOCX לא תקין");
  const paras: { text: string; heading: boolean }[] = [];
  for (const p of xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? []) {
    const text = [...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => decodeXml(m[1])).join("").trim();
    if (!text) continue;
    const heading = /<w:pStyle w:val="(Heading|Title|כותרת)[^"]*"/i.test(p);
    paras.push({ text, heading });
  }
  return blocksFromParagraphs(paras);
}

/* ------------------------------ TEXT ------------------------------ */

export function parseText(text: string): RawUnit[] {
  const paras = text
    .split(/\n\s*\n/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({ text: t, heading: /^#{1,4}\s/.test(t) && t.length < 120 }));
  return blocksFromParagraphs(paras.map((p) => ({ ...p, text: p.text.replace(/^#{1,4}\s/, "") })));
}

function blocksFromParagraphs(paras: { text: string; heading: boolean }[], maxChars = 2500): RawUnit[] {
  const units: RawUnit[] = [];
  let cur: { title: string; lines: string[] } | null = null;
  const flush = () => {
    if (cur && cur.lines.join("").trim()) {
      const n = units.length + 1;
      units.push({ anchor: `קטע ${n}`, page: null, title: cur.title, text: cur.lines.join("\n") });
    }
    cur = null;
  };
  for (const p of paras) {
    if (p.heading) {
      flush();
      cur = { title: p.text, lines: [p.text] };
      continue;
    }
    if (!cur) cur = { title: "", lines: [] };
    if (cur.lines.join("\n").length + p.text.length > maxChars && cur.lines.length) {
      const title: string = cur.title;
      flush();
      cur = { title: title ? `${title} (המשך)` : "", lines: [] };
    }
    cur.lines.push(p.text);
  }
  flush();
  return units;
}

/* ------------------------------ PDF ------------------------------ */

export interface PdfDeps {
  /** pdfjs-dist module (the app configures its worker). */
  pdfjs: typeof import("pdfjs-dist");
}

/** Extracts text per page, preserving line breaks. Marks pages with too little text as sparse. */
export async function parsePdf(bytes: Uint8Array, { pdfjs }: PdfDeps): Promise<RawUnit[]> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const units: RawUnit[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let text = "";
    let lastY: number | null = null;
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) text += "\n";
      else if (text && !text.endsWith(" ") && item.str && !item.str.startsWith(" ")) text += " ";
      text += item.str;
      lastY = y;
    }
    text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    const title = text.split("\n").find((l) => l.trim().length > 3)?.trim().slice(0, 80) ?? "";
    units.push({ anchor: `עמ' ${i}`, page: i, title, text, sparse: text.replace(/\s/g, "").length < 80 });
  }
  await doc.destroy();
  return units;
}

/** Renders one PDF page to PNG (base64) for vision OCR. Browser only (needs canvas). */
export async function renderPdfPagePng(bytes: Uint8Array, pageNumber: number, { pdfjs }: PdfDeps): Promise<string> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.6 });
  const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;
  const blob = await canvas.convertToBlob({ type: "image/png" });
  await doc.destroy();
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
