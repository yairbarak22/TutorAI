// Generates small real documents for end-to-end tests: PDF (2 pages), PPTX, DOCX, Markdown exam.
import { writeFileSync } from "node:fs";
import JSZip from "jszip";

const out = new URL("../e2e/fixtures/", import.meta.url);

/* ---------- minimal valid PDF with text on 2 pages ---------- */
function pdf(pages) {
  const objs = [];
  const add = (s) => objs.push(s) && objs.length;
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds = [];
  const pagesId = objs.length + pages.length * 2 + 1;
  for (const lines of pages) {
    const content = ["BT /F1 14 Tf 60 760 Td 18 TL", ...lines.map((l) => `(${l.replace(/[()\\]/g, "\\$&")}) Tj T*`), "ET"].join("\n");
    const c = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${c} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  }
  add(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let body = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
writeFileSync(new URL("lecture-graphs.pdf", out), pdf([
  ["Lecture 4: Graphs", "A graph G = (V, E) is a set of vertices V and edges E.", "BFS explores vertices layer by layer using a queue.", "BFS runs in O(|V| + |E|) time."],
  ["DFS and topological sort", "DFS uses a stack (or recursion) and visits deep first.", "A DAG has a topological order; DFS finish times give it.", "Common mistake: running topological sort on a graph with a cycle."],
]));

/* ---------- PPTX ---------- */
const pptx = new JSZip();
const slide = (lines) => `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree>${lines
  .map((t) => `<p:sp><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp>`)
  .join("")}</p:spTree></p:cSld></p:sld>`;
pptx.file("ppt/slides/slide1.xml", slide(["משתנים מקריים", "משתנה מקרי הוא פונקציה ממרחב המדגם לממשיים"]));
pptx.file("ppt/slides/slide2.xml", slide(["התפלגות בינומית", "X ~ Bin(n,p): P(X=k) = C(n,k) p^k (1-p)^(n-k)", "התוחלת היא np"]));
pptx.file("ppt/notesSlides/notesSlide2.xml", slide(["להדגיש: התוחלת של בינומית היא np", "2"]));
writeFileSync(new URL("lecture-rv.pptx", out), await pptx.generateAsync({ type: "nodebuffer" }));

/* ---------- DOCX ---------- */
const docx = new JSZip();
const p = (t, h) => `<w:p>${h ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : ""}<w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
docx.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="w"><w:body>${[
  p("שונות", true), p("השונות מודדת פיזור: Var(X) = E[X^2] - (E[X])^2."), p("סטיית התקן היא שורש השונות."),
  p("אי-שוויון צ'בישב", true), p("P(|X - μ| ≥ kσ) ≤ 1/k^2 לכל k > 0."),
].join("")}</w:body></w:document>`);
writeFileSync(new URL("summary-variance.docx", out), await docx.generateAsync({ type: "nodebuffer" }));

/* ---------- sample exam ---------- */
writeFileSync(new URL("מבחן לדוגמה 2025.md", out), `# מבחן לדוגמה — הסתברות\n\nמשך: 3 שעות.\n\n## שאלה 1 (30 נק')\nמטילים מטבע הוגן 10 פעמים. מה ההסתברות לקבל בדיוק 4 פעמים עץ?\n\n## שאלה 2 (70 נק')\nהוכיחו את אי-שוויון צ'בישב בעזרת אי-שוויון מרקוב.\n`);
console.log("fixtures written");
