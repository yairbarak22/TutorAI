import { describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import JSZip from "jszip";
import { z } from "zod";
import { checkGrounding, cleanCitations, hebrewRatio, renderTemplate, extractInlineCitations } from "@ruecai/sdk";
import { Store, sectionKey } from "./db/store.ts";
import { parseDocx, parsePptx, parseText, detectKind, safeMimeFor } from "./ingest/parsers.ts";
import { ingestSource, mergeConcepts } from "./ingest/pipeline.ts";
import { MemoryFileStore, sha256Hex } from "./files.ts";
import { MockLLM } from "./llm/mock.ts";
import { retrieve } from "./retrieve.ts";
import { hebrewTerms, searchSections } from "./search.ts";
import { bktUpdate } from "./learner/bkt.ts";
import { newCardState, reviewCard } from "./learner/srs.ts";
import { diagnoseMistake, scheduleRetry } from "./learner/mistakes.ts";
import { buildSession, streakDays } from "./learner/session.ts";
import { gradeAnswer, recordAttempt } from "./runtime.ts";
import { seedCourse } from "./seed.ts";
import probability from "../../../plugins/_fixtures/probability.json";
import coreGolden from "../../../plugins/_fixtures/core-golden.json";

const SQL = await initSqlJs();
const fixture = () => structuredClone(probability) as Parameters<typeof seedCourse>[1];

describe("store", () => {
  it("round-trips through export/import (the ruecai.db file)", () => {
    const a = Store.open(SQL);
    const id = a.createCourse("הסתברות", "2027-02-01");
    a.setSetting("apiKeyHint", "x");
    const b = Store.open(SQL, a.export());
    expect(b.course(id)?.name).toBe("הסתברות");
    expect(b.getSetting("apiKeyHint")).toBe("x");
  });
  it("notifies on change (drives autosave)", () => {
    const s = Store.open(SQL);
    let n = 0;
    s.onChange(() => n++);
    s.createCourse("x");
    expect(n).toBeGreaterThan(0);
  });
  it("cascades course deletion", () => {
    const s = Store.open(SQL);
    const cid = seedCourse(s, fixture());
    s.deleteCourse(cid);
    expect(s.sections(cid)).toEqual([]);
    expect(s.concepts(cid)).toEqual([]);
  });
});

describe("parsers", () => {
  it("detects kinds", () => {
    expect(detectKind("a.PDF")).toBe("pdf");
    expect(detectKind("a.pptx")).toBe("pptx");
    expect(detectKind("notes.md")).toBe("text");
    expect(detectKind("a.exe")).toBeNull();
  });
  it("never trusts the browser MIME type (no HTML/SVG as material)", () => {
    expect(detectKind("evil.html", "text/html")).toBeNull();
    expect(detectKind("evil.svg", "text/plain")).toBeNull();
    expect(safeMimeFor("notes.md")).toBe("text/plain;charset=utf-8");
    expect(safeMimeFor("evil.html")).toBe("application/octet-stream");
    expect(safeMimeFor("a.pdf")).toBe("application/pdf");
  });

  it("parses PPTX slides with notes, in slide order", async () => {
    const zip = new JSZip();
    const slide = (t: string[]) =>
      `<p:sld><p:cSld><p:spTree>${t.map((x) => `<a:p><a:r><a:t>${x}</a:t></a:r></a:p>`).join("")}</p:spTree></p:cSld></p:sld>`;
    zip.file("ppt/slides/slide10.xml", slide(["שקף עשר"]));
    zip.file("ppt/slides/slide2.xml", slide(["הסתברות מותנית", "P(A|B) = P(A&amp;B)/P(B)"]));
    zip.file("ppt/notesSlides/notesSlide2.xml", slide(["טעות נפוצה: לבלבל כיוון", "2"]));
    const units = await parsePptx(await zip.generateAsync({ type: "uint8array" }));
    expect(units.map((u) => u.anchor)).toEqual(["שקף 2", "שקף 10"]);
    expect(units[0].title).toBe("הסתברות מותנית");
    expect(units[0].text).toContain("P(A&B)/P(B)");
    expect(units[0].text).toContain("טעות נפוצה");
    expect(units[0].text).not.toMatch(/\n2$/);
  });

  it("parses DOCX into heading blocks", async () => {
    const zip = new JSZip();
    const p = (t: string, h = false) =>
      `<w:p>${h ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : ""}<w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
    zip.file("word/document.xml", `<w:document><w:body>${p("תוחלת", true)}${p("E[X] = Σ x P(X=x)")}${p("שונות", true)}${p("Var(X)")}</w:body></w:document>`);
    const units = await parseDocx(await zip.generateAsync({ type: "uint8array" }));
    expect(units).toHaveLength(2);
    expect(units[0].title).toBe("תוחלת");
    expect(units[1].text).toContain("Var(X)");
  });

  it("splits long text blocks", () => {
    const long = Array.from({ length: 30 }, (_, i) => `פסקה ${i} ${"מילה ".repeat(30)}`).join("\n\n");
    const units = parseText(`# פרק א\n\n${long}`);
    expect(units.length).toBeGreaterThan(1);
    expect(units.every((u) => u.text.length <= 2700)).toBe(true);
  });
});

describe("search & retrieval", () => {
  it("strips Hebrew prefixes", () => {
    expect(hebrewTerms("והסתברות")).toContain("הסתברות");
    expect(hebrewTerms("בבייס")).toContain("בייס");
  });

  it("finds sections by Hebrew keywords with prefixes", () => {
    const s = Store.open(SQL);
    const cid = seedCourse(s, fixture());
    const hits = searchSections(s.sections(cid), "ובנוסחת בייס");
    const top = s.section(hits[0].id)!;
    expect(top.title).toContain("בייס");
  });

  it("sends everything when the course fits the budget, in document order", () => {
    const s = Store.open(SQL);
    const cid = seedCourse(s, fixture());
    const r = retrieve(s, cid, { query: "בייס" });
    expect(r.sections).toHaveLength(8);
    expect(r.truncated).toBe(false);
    expect(r.text.indexOf("מרחב מדגם")).toBeLessThan(r.text.indexOf("נוסחת בייס"));
  });

  it("ranks by query/concept when over budget", () => {
    const s = Store.open(SQL);
    const cid = seedCourse(s, fixture());
    const r = retrieve(s, cid, { concept: "נוסחת בייס", budgetChars: 700 });
    expect(r.truncated).toBe(true);
    expect(r.sections.some((x) => x.title === "נוסחת בייס")).toBe(true);
    expect(r.text.length).toBeLessThan(1500);
  });

  it("separates sample exams from material", () => {
    const s = Store.open(SQL);
    const cid = seedCourse(s, fixture());
    const src = s.sources(cid)[0];
    s.setSourceKind(src.id, "sample_exam");
    expect(retrieve(s, cid, { mode: "samples" }).sections.every((x) => x.sourceId === src.id)).toBe(true);
    expect(retrieve(s, cid).sections.some((x) => x.sourceId === src.id)).toBe(false);
  });
});

describe("ingestion pipeline", () => {
  it("parses, sections, analyzes and merges concepts", async () => {
    const store = Store.open(SQL);
    const files = new MemoryFileStore();
    const cid = store.createCourse("קורס");
    const bytes = new TextEncoder().encode("# מבוא\n\nהגדרה ראשונה של המושג.\n\n# המשך\n\nדוגמה מספרית.");
    await files.write("courses/1/a.md", bytes);
    const sid = store.addSource({ course_id: cid, name: "a.md", kind: "material", mime: "text/markdown", path: "courses/1/a.md", hash: await sha256Hex(bytes), size: bytes.length });
    const progress: number[] = [];
    await ingestSource({ store, files, llm: new MockLLM(coreGolden), onProgress: (_id, p) => progress.push(p) }, sid);
    expect(store.source(sid)?.status).toBe("ready");
    const sections = store.sectionsOfSource(sid);
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe("מבוא");
    expect(sections[0].summary).toContain("פתיחה");
    const concepts = store.concepts(cid);
    expect(concepts[0].section_ids).toEqual([sectionKey(sections[0].id)]);
    expect(progress.at(-1)).toBe(1);
  });

  it("marks unsupported files as errors with a Hebrew message", async () => {
    const store = Store.open(SQL);
    const files = new MemoryFileStore();
    const cid = store.createCourse("קורס");
    await files.write("x.exe", new Uint8Array([1, 2]));
    const sid = store.addSource({ course_id: cid, name: "x.exe", kind: "material", mime: "", path: "x.exe", hash: "h", size: 2 });
    await expect(ingestSource({ store, files, llm: new MockLLM({}) }, sid)).rejects.toThrow();
    expect(store.source(sid)?.status).toBe("error");
    expect(store.source(sid)?.error).toMatch(/לא נתמך/);
  });

  it("merges duplicate concepts by name / English name", () => {
    const store = Store.open(SQL);
    const cid = store.createCourse("c");
    mergeConcepts(store, cid, [{ name: "הסתברות מותנית", name_en: "Conditional probability", definition: "קצר", prerequisites: [], citations: ["S1"] }]);
    mergeConcepts(store, cid, [{ name: "ההסתברות המותנית ", name_en: "conditional probability", definition: "הגדרה ארוכה יותר", prerequisites: ["מאורע"], citations: ["S2"] }]);
    const cs = store.concepts(cid);
    expect(cs).toHaveLength(1);
    expect(cs[0].definition).toBe("הגדרה ארוכה יותר");
    expect(cs[0].section_ids).toEqual(["S1", "S2"]);
  });
});

describe("learner model", () => {
  it("BKT goes up on correct and down on wrong", () => {
    expect(bktUpdate(0.3, true)).toBeGreaterThan(0.3);
    expect(bktUpdate(0.6, false)).toBeLessThan(0.6);
  });
  it("records attempts and updates mastery", () => {
    const s = Store.open(SQL);
    const cid = seedCourse(s, fixture());
    recordAttempt(s, { courseId: cid, concept: "נוסחת בייס", itemRef: "q1", correct: true, score: 1, kind: "mcq" });
    recordAttempt(s, { courseId: cid, concept: "נוסחת בייס", itemRef: "q2", correct: true, score: 1, kind: "open" });
    const m = s.mastery(cid).get("נוסחת בייס")!;
    expect(m.attempts).toBe(2);
    expect(m.p).toBeGreaterThan(0.5);
  });
  it("FSRS schedules good answers further out than again", () => {
    const now = new Date("2027-01-01T10:00:00Z");
    const c = newCardState(now);
    const good = reviewCard(c.fsrs, "good", now);
    const again = reviewCard(c.fsrs, "again", now);
    expect(Date.parse(good.due)).toBeGreaterThan(Date.parse(again.due));
    const later = reviewCard(good.fsrs, "good", new Date(good.due));
    expect(later.intervalDays).toBeGreaterThan(good.intervalDays);
  });
  it("grades open answers via the LLM and clamps the score", async () => {
    const res = await gradeAnswer(new MockLLM(coreGolden), { question: "q", answer: "תשובה", modelAnswer: "m", rubric: [], maxPoints: 10 });
    expect(res.score).toBe(7);
    expect(res.correct).toBe(true);
    const empty = await gradeAnswer(new MockLLM({}), { question: "q", answer: "  ", modelAnswer: "m", rubric: [], maxPoints: 5 });
    expect(empty.score).toBe(0);
  });
});

describe("sdk helpers", () => {
  it("checks and cleans citations", () => {
    const data = { sections: [{ citations: ["S1", "S9"] }, { citations: [] }, { citations: ["[S2]"] }] };
    const r = checkGrounding(data, ["S1", "S2"]);
    expect(r.items).toBe(3);
    expect(r.invalidIds).toContain("S9");
    cleanCitations(data, ["S1", "S2"]);
    expect(data.sections[0].citations).toEqual(["S1"]);
    expect(data.sections[2].citations).toEqual(["S2"]);
  });
  it("renders templates and fails on unknown variables", () => {
    expect(renderTemplate("שלום {{params.name}}{{#if params.x}} X{{/if}}", { params: { name: "דנה", x: "" } })).toBe("שלום דנה");
    expect(() => renderTemplate("{{nope}}", {})).toThrow(/nope/);
  });
  it("measures Hebrew ratio and inline citations", () => {
    expect(hebrewRatio("שלום עולם world")).toBeGreaterThan(0.5);
    expect(extractInlineCitations("כך [S3] וגם [S12].")).toEqual(["S3", "S12"]);
  });
  it("mock LLM remaps fixture citations to real ids", async () => {
    const llm = new MockLLM({ t: { citations: ["S1", "S2"] } });
    const out = await llm.object(z.object({ citations: z.array(z.string()) }), {
      tag: "t",
      prompt: "",
      context: '<section id="S40"></section><section id="S41"></section>',
    });
    expect(out.citations).toEqual(["S40", "S41"]);
  });
});

describe("mistakes notebook & daily session", () => {
  const mistakeFor = (store: Store, courseId: number, due: string) =>
    store.addMistake({
      course_id: courseId,
      concept: "הסתברות מותנית",
      origin: "quiz",
      item_ref: "1:q1",
      question: "מהו P(A|B)?",
      student_answer: "P(B|A)",
      correct_answer: "P(A∩B)/P(B)",
      explanation: "",
      citations: [],
      due,
    });

  it("schedules retries and resolves after two correct answers in a row", () => {
    const now = new Date("2027-01-10T10:00:00Z");
    const s1 = scheduleRetry({ streak: 0 }, true, now);
    expect(s1).toMatchObject({ streak: 1, status: "open" });
    expect(Date.parse(s1.due)).toBeGreaterThan(now.getTime());
    expect(scheduleRetry({ streak: 1 }, true, now).status).toBe("resolved");
    expect(scheduleRetry({ streak: 1 }, false, now)).toMatchObject({ streak: 0, status: "open" });
  });

  it("keeps one open entry per question and stores the model's diagnosis", async () => {
    const store = Store.open(SQL);
    const courseId = seedCourse(store, fixture());
    const due = new Date().toISOString();
    const a = mistakeFor(store, courseId, due);
    const b = mistakeFor(store, courseId, due);
    expect(b).toBe(a);
    expect(store.mistakes(courseId)).toHaveLength(1);
    await diagnoseMistake(new MockLLM(coreGolden), store, a);
    expect(store.mistake(a)?.misconception).toContain("P(A|B)");
  });

  it("builds an interleaved session from due mistakes, due cards and weak concepts", async () => {
    const store = Store.open(SQL);
    const courseId = seedCourse(store, fixture());
    const now = new Date("2027-01-10T10:00:00Z");
    mistakeFor(store, courseId, new Date(now.getTime() - 1000).toISOString());
    const s = newCardState(now);
    for (let i = 0; i < 3; i++)
      store.addCard({ course_id: courseId, artifact_id: null, front: `f${i}`, back: `b${i}`, concept: "תוחלת", citations: [], fsrs: s.fsrs, due: now.toISOString() });
    const plan = await buildSession({ store, llm: new MockLLM(coreGolden), courseId, now });
    expect(plan.counts.retry).toBe(1);
    expect(plan.counts.cards).toBe(3);
    expect(plan.items[0]).toMatchObject({ kind: "question", reason: "retry" });
    const kinds = plan.items.map((i) => i.kind);
    expect(kinds).toContain("card");
    expect(kinds.join(",")).not.toContain("card,card,card,card"); // interleaved, not grouped
    const retry = plan.items.find((i) => i.kind === "question" && i.reason === "retry");
    expect(retry && retry.kind === "question" && retry.q.concept).toBe("הסתברות מותנית");
  });

  it("falls back to the original question when the model is unavailable", async () => {
    const store = Store.open(SQL);
    const courseId = seedCourse(store, fixture());
    const now = new Date();
    mistakeFor(store, courseId, now.toISOString());
    const broken = new MockLLM({});
    const plan = await buildSession({ store, llm: broken, courseId, now: new Date(now.getTime() + 1000) });
    const q = plan.items.find((i) => i.kind === "question");
    expect(q && q.kind === "question" && q.q.prompt).toBe("מהו P(A|B)?");
  });

  it("counts streaks of consecutive study days", () => {
    expect(streakDays(["2027-01-10", "2027-01-09", "2027-01-08", "2027-01-05"], "2027-01-10")).toBe(3);
    expect(streakDays(["2027-01-09", "2027-01-08"], "2027-01-10")).toBe(2);
    expect(streakDays(["2027-01-07"], "2027-01-10")).toBe(0);
  });

  it("migrates a v1 database (adds sections.t_start)", () => {
    const db = new SQL.Database();
    db.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO meta VALUES('schema_version','1');");
    db.run("CREATE TABLE sections (id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER NOT NULL, source_id INTEGER NOT NULL, ord INTEGER NOT NULL, anchor TEXT NOT NULL, page INTEGER, title TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', text TEXT NOT NULL);");
    const store = Store.open(SQL, db.export());
    const cols = store.all<{ name: string }>("PRAGMA table_info(sections)").map((c) => c.name);
    expect(cols).toContain("t_start");
    expect(store.get<{ value: string }>("SELECT value FROM meta WHERE key='schema_version'")?.value).toBe("2");
  });
});
