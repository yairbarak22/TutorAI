import initSqlJs, { type SqlJsStatic } from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useSyncExternalStore } from "react";
import {
  AnthropicLLM,
  DEFAULT_MODELS,
  LocalLLM,
  TieredLLM,
  type UsageEvent,
  MockLLM,
  Store,
  detectKind,
  safeMimeFor,
  gradeAnswer,
  ingestSource,
  recordAttempt,
  reviewCard,
  runTool,
  safeFileName,
  seedCourse,
  sha256Hex,
  buildSession,
  diagnoseMistake,
  firstRetry,
  localDay,
  previewSession,
  scheduleRetry,
  streakDays,
  type Mistake,
  type GradeInput,
  type ReviewGrade,
  type RunResult,
  type Source,
} from "@ruecai/core";
import { t, type ArtifactPayload, type ChatTurn, type LLMApi, type LoadedTool, type SolutionCheck } from "@ruecai/sdk";
import { sympyVerifier } from "./platform/sympy.ts";
import { courseFixtures, demoFixtures, getTool, tools } from "@ruecai/plugins";
import { DB_FILE, Persistence, exportBackup, type DataRoot } from "./platform/storage.ts";
import { secrets } from "./platform/secrets.ts";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

let sqlPromise: Promise<SqlJsStatic> | null = null;
const loadSql = () => (sqlPromise ??= initSqlJs({ locateFile: () => sqlWasmUrl }));

export type IngestEvent = { sourceId: number; pct: number; message: string; startedAt: number };

/**
 * App-level orchestration around the core: one Store (ruecai.db), one FileStore,
 * one LLM, the plugin registry, autosave, and a sequential ingestion queue.
 */
export class Engine {
  private listeners = new Set<() => void>();
  version = 0;
  llm!: LLMApi;
  demo = false;
  provider: "claude" | "local" | "hybrid" | "demo" = "demo";
  ingestStatus = new Map<number, IngestEvent>();
  private queue: number[] = [];
  private ingesting = false;
  lockWarning: string | null = null;

  private constructor(
    public store: Store,
    public root: DataRoot,
    public persistence: Persistence,
  ) {}

  static async start(root: DataRoot, overrideDb?: Uint8Array): Promise<Engine> {
    const SQL = await loadSql();
    let bytes: Uint8Array | null = overrideDb ?? null;
    if (!bytes) {
      try {
        bytes = await root.files.read(DB_FILE);
      } catch {
        bytes = null; // new folder
      }
    }
    const store = Store.open(SQL, bytes);
    let engine!: Engine;
    const persistence = new Persistence(root, () => store.export());
    engine = new Engine(store, root, persistence);
    persistence.onStatus = () => engine.bump();
    store.onChange(() => {
      persistence.markDirty();
      engine.bump();
    });
    engine.lockWarning = await persistence.checkLock();
    persistence.startHeartbeat();
    if (overrideDb || !bytes) {
      persistence.markDirty();
      await persistence.flush();
    }
    engine.configureLLM();
    // Resume ingestion interrupted by a closed tab.
    for (const c of store.courses())
      for (const s of store.sources(c.id)) if (["pending", "parsing", "analyzing"].includes(s.status)) engine.enqueue(s.id);
    return engine;
  }

  /* ---------------- reactivity ---------------- */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  bump() {
    this.version++;
    this.listeners.forEach((f) => f());
  }

  /* ---------------- LLM ---------------- */
  configureLLM() {
    const key = secrets.getApiKey();
    const provider = secrets.getProvider();
    const local = secrets.getLocal();
    const usage = (u: UsageEvent) => this.store.addUsage(u);
    const claude = key ? new AnthropicLLM(key, secrets.getModels() ?? DEFAULT_MODELS, usage) : null;
    const loc = local && (local.fast || local.smart) ? new LocalLLM(local, usage) : null;
    let llm: LLMApi | null = null;
    if (!secrets.isDemo()) {
      if (provider === "local") llm = loc;
      else if (provider === "hybrid") llm = loc && claude ? new TieredLLM(loc, claude) : (claude ?? loc);
      else llm = claude;
    }
    this.demo = !llm;
    this.provider = !llm ? "demo" : llm === loc ? "local" : llm instanceof TieredLLM ? "hybrid" : "claude";
    this.llm = llm ?? new MockLLM(demoFixtures(), { delayMs: 900 });
    this.bump();
  }

  /** Who is writing, for progress labels ("Claude is writing…" / "The local model is writing…"). */
  get writer(): string {
    return this.provider === "local" ? t("המודל המקומי", "The local model") : this.provider === "hybrid" ? t("ה-AI", "The AI") : "Claude";
  }

  get tools(): LoadedTool[] {
    return tools;
  }

  /* ---------------- courses ---------------- */
  loadDemoCourse(which: "probability" | "law"): number {
    return seedCourse(this.store, structuredClone(courseFixtures[which]));
  }

  /* ---------------- sources ---------------- */
  async addFiles(courseId: number, files: File[], kind: Source["kind"] = "material"): Promise<string[]> {
    const problems: string[] = [];
    for (const f of files) {
      if (!detectKind(f.name, f.type)) {
        problems.push(t(`${f.name}: סוג קובץ לא נתמך (PDF, PPTX, DOCX, TXT, MD)`, `${f.name}: unsupported file type (PDF, PPTX, DOCX, TXT, MD)`));
        continue;
      }
      if (f.size > 60 * 1024 * 1024) {
        problems.push(t(`${f.name}: הקובץ גדול מדי (מעל 60MB)`, `${f.name}: file is too large (over 60MB)`));
        continue;
      }
      const bytes = new Uint8Array(await f.arrayBuffer());
      const hash = await sha256Hex(bytes);
      if (this.store.sourceByHash(courseId, hash)) {
        problems.push(t(`${f.name}: הקובץ כבר קיים בקורס`, `${f.name}: this file is already in the course`));
        continue;
      }
      const path = `courses/${courseId}/sources/${hash.slice(0, 10)}-${safeFileName(f.name)}`;
      await this.root.files.write(path, bytes);
      const guessKind = /מבחן|בחינה|exam|מועד/i.test(f.name) && kind === "material" ? "sample_exam" : kind;
      const id = this.store.addSource({ course_id: courseId, name: f.name, kind: guessKind, mime: safeMimeFor(f.name), path, hash, size: f.size });
      this.enqueue(id);
    }
    return problems;
  }

  enqueue(sourceId: number) {
    if (!this.queue.includes(sourceId)) this.queue.push(sourceId);
    void this.drain();
  }

  retry(sourceId: number) {
    this.store.setSourceStatus(sourceId, "pending", 0);
    this.enqueue(sourceId);
  }

  private async drain() {
    if (this.ingesting) return;
    this.ingesting = true;
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!;
        if (!this.store.source(id)) continue;
        try {
          await ingestSource(
            {
              store: this.store,
              files: this.root.files,
              llm: this.llm,
              pdf: { pdfjs },
              ocrSparsePages: !this.demo && this.llm.limitsFor?.("fast")?.vision !== false,
              onProgress: (sourceId, pct, message) => {
                const startedAt = this.ingestStatus.get(sourceId)?.startedAt ?? Date.now();
                this.ingestStatus.set(sourceId, { sourceId, pct, message, startedAt });
                this.bump();
              },
            },
            id,
          );
        } catch (e) {
          console.warn("ingest failed", id, e);
        }
      }
    } finally {
      this.ingesting = false;
      this.bump();
    }
  }

  async deleteSource(id: number) {
    const s = this.store.source(id);
    if (!s) return;
    this.store.deleteSource(id);
    await this.root.files.remove(s.path);
  }

  /** Asks for confirmation, then deletes a course with all its files. Returns false if cancelled. */
  async deleteCourse(id: number): Promise<boolean> {
    const c = this.store.course(id);
    if (!c) return false;
    const ok = confirm(
      t(
        `למחוק את הקורס "${c.name}" וכל מה שבו? הקבצים יימחקו גם מהתיקייה. אי אפשר לבטל.`,
        `Delete the course "${c.name}" and everything in it? The files will also be deleted from the folder. This cannot be undone.`,
      ),
    );
    if (!ok) return false;
    for (const s of this.store.sources(id)) await this.deleteSource(s.id);
    this.store.deleteCourse(id);
    this.bump();
    return true;
  }

  async sourceUrl(id: number, page?: number | null): Promise<string> {
    const s = this.store.source(id);
    if (!s) throw new Error("not found");
    const bytes = await this.root.files.read(s.path);
    // Inert, allowlisted type: a stored file must never be rendered as HTML/SVG in our origin.
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: safeMimeFor(s.name) }));
    return page && s.name.toLowerCase().endsWith(".pdf") ? `${url}#page=${page}` : url;
  }

  /* ---------------- tools ---------------- */
  async run(
    toolId: string,
    courseId: number,
    params: Record<string, string | number>,
    onProgress?: (pct: number, msg: string) => void,
    onOutput?: (chars: number) => void,
  ): Promise<RunResult> {
    const res = await runTool(getTool(toolId), { store: this.store, llm: this.llm, courseId, params, onProgress, onOutput, math: sympyVerifier });
    // A checked solution with a mistake goes to the notebook, so it comes back in the daily session.
    if (res.kind === "artifact" && res.payload.type === "solution_check") {
      const d = res.payload.data as SolutionCheck;
      const step = d.steps[d.first_error];
      if (d.verdict !== "correct" && step)
        this.recordMistake({
          courseId,
          concept: d.concept,
          origin: "check",
          itemRef: `check:${res.artifactId}`,
          question: d.problem,
          studentAnswer: step.text,
          correctAnswer: d.fix || d.hints[d.hints.length - 1] || "",
          explanation: step.comment,
          citations: d.citations,
        });
    }
    return res;
  }

  /** Position in the ingestion queue (0 = being processed now), or -1 when not queued. */
  queuePosition(sourceId: number): number {
    if (this.ingesting && !this.queue.includes(sourceId) && this.ingestStatus.has(sourceId)) return 0;
    const i = this.queue.indexOf(sourceId);
    return i < 0 ? -1 : i + 1;
  }

  async chat(courseId: number, message: string, history: ChatTurn[], mode: string, onDelta: (t: string) => void) {
    const res = await runTool(getTool("tutor"), {
      store: this.store,
      llm: this.llm,
      courseId,
      params: { mode },
      chat: { history, message, onDelta },
    });
    if (res.kind !== "chat") throw new Error("unexpected");
    return res.reply;
  }

  async repairArtifact(artifactId: number, error: string, onOutput?: (chars: number) => void) {
    const a = this.store.artifact(artifactId);
    if (!a) return;
    const tool = getTool(a.tool_id);
    if (!tool.code?.repair) return;
    const { buildContext } = await import("@ruecai/core");
    const ctx = buildContext(tool, { store: this.store, llm: this.llm, courseId: a.course_id, params: a.params as Record<string, string>, onOutput }, new Set());
    const fixed = await tool.code.repair(ctx, { type: a.type, title: a.title, data: a.data } as ArtifactPayload, error);
    this.store.updateArtifactData(artifactId, fixed.data);
  }

  grade(input: GradeInput) {
    return gradeAnswer(this.llm, input);
  }

  recordAttempt(courseId: number, concept: string, itemRef: string, correct: boolean, score: number, kind: "mcq" | "open" | "exam" | "card", answer = "", feedback = "") {
    if (!concept) return;
    recordAttempt(this.store, { courseId, concept, itemRef, correct, score, kind, answer, feedback });
  }

  review(cardId: number, fsrs: string, grade: ReviewGrade, courseId: number, concept: string) {
    const next = reviewCard(fsrs, grade, new Date());
    this.store.updateCard(cardId, next.fsrs, next.due);
    this.recordAttempt(courseId, concept, `card:${cardId}`, grade === "good" || grade === "easy", grade === "again" ? 0 : 1, "card");
  }

  /* ---------------- mistakes notebook & daily session ---------------- */
  /** Log a wrong answer (one open entry per question) and diagnose it in the background. */
  recordMistake(m: {
    courseId: number;
    concept: string;
    origin: Mistake["origin"];
    itemRef: string;
    question: string;
    studentAnswer: string;
    correctAnswer: string;
    explanation?: string;
    citations?: string[];
  }): number {
    const id = this.store.addMistake({
      course_id: m.courseId,
      concept: m.concept,
      origin: m.origin,
      item_ref: m.itemRef,
      question: m.question,
      student_answer: m.studentAnswer,
      correct_answer: m.correctAnswer,
      explanation: m.explanation ?? "",
      citations: m.citations ?? [],
      due: firstRetry(new Date()),
    });
    void diagnoseMistake(this.llm, this.store, id).catch((e) => console.warn("diagnosis failed", e));
    return id;
  }

  /** A second chance on a logged mistake: right twice in a row resolves it. */
  retryMistake(id: number, correct: boolean) {
    const m = this.store.mistake(id);
    if (m) this.store.updateMistake(id, scheduleRetry(m, correct, new Date()));
  }

  /** Minutes for the daily session: a quarter of the course's daily study time, 10–25 min. */
  sessionBudget(courseId: number) {
    const per = this.store.course(courseId)?.minutes_per_day ?? 90;
    return Math.min(25, Math.max(10, Math.round(per / 4)));
  }

  sessionPreview(courseId: number) {
    return previewSession(this.store, courseId, new Date(), this.sessionBudget(courseId));
  }

  buildSession(courseId: number, onOutput?: (chars: number) => void) {
    return buildSession({ store: this.store, llm: this.llm, courseId, budgetMinutes: this.sessionBudget(courseId), onOutput });
  }

  finishSession(courseId: number, items: number, correct: number, seconds: number) {
    this.store.addSession({ course_id: courseId, day: localDay(), items, correct, seconds: Math.round(seconds) });
  }

  streak(courseId: number) {
    return streakDays(this.store.sessionDays(courseId), localDay());
  }

  /* ---------------- backup ---------------- */
  async backup(): Promise<Blob> {
    await this.persistence.flush();
    const paths = this.store.courses().flatMap((c) => this.store.sources(c.id).map((s) => s.path));
    return exportBackup(this.root, this.store.export(), paths);
  }
}

/* ---------------- React binding ---------------- */
let current: Engine | null = null;
export const setEngine = (e: Engine) => {
  current = e;
  // Dev-only handle for debugging and seeding test data from the console.
  if (import.meta.env.DEV) (window as unknown as { __ruecai?: Engine }).__ruecai = e;
};
export function useEngine(): Engine {
  const e = current!;
  useSyncExternalStore(e.subscribe, () => e.version);
  return e;
}
