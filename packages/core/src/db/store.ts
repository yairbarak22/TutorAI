import type { Database, SqlJsStatic, SqlValue } from "sql.js";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.ts";

export type Row = Record<string, SqlValue>;

export interface Course {
  id: number;
  name: string;
  exam_date: string | null;
  minutes_per_day: number;
  created_at: string;
}
export interface Source {
  id: number;
  course_id: number;
  name: string;
  kind: "material" | "sample_exam";
  mime: string;
  path: string;
  hash: string;
  size: number;
  status: "pending" | "parsing" | "analyzing" | "ready" | "error";
  progress: number;
  error: string | null;
  created_at: string;
}
export interface Section {
  id: number;
  course_id: number;
  source_id: number;
  ord: number;
  anchor: string;
  page: number | null;
  title: string;
  summary: string;
  text: string;
  /** Seconds into a recording (lecture audio/video); null for documents. */
  t_start: number | null;
}
export interface Concept {
  id: number;
  course_id: number;
  name: string;
  name_en: string;
  definition: string;
  prerequisites: string[];
  section_ids: string[];
}
export interface Artifact {
  id: number;
  course_id: number;
  tool_id: string;
  type: string;
  title: string;
  data: unknown;
  params: Record<string, unknown>;
  created_at: string;
}
export interface Card {
  id: number;
  course_id: number;
  artifact_id: number | null;
  front: string;
  back: string;
  concept: string;
  citations: string[];
  fsrs: string;
  due: string;
}

export interface Mistake {
  id: number;
  course_id: number;
  concept: string;
  origin: "quiz" | "exam" | "session" | "check";
  item_ref: string;
  question: string;
  student_answer: string;
  correct_answer: string;
  explanation: string;
  citations: string[];
  misconception: string;
  status: "open" | "resolved";
  streak: number;
  due: string;
  created_at: string;
  updated_at: string;
}
export interface SessionLog {
  id: number;
  course_id: number;
  day: string;
  items: number;
  correct: number;
  seconds: number;
}

export const sectionKey = (id: number) => `S${id}`;
export const sectionIdFromKey = (key: string) => Number(key.replace(/^S/, ""));

/**
 * The whole local database. sql.js keeps it in memory; the platform layer persists
 * `export()` to `ruecai.db` in the student's folder whenever `onChange` fires.
 */
export class Store {
  private listeners = new Set<() => void>();
  private constructor(public readonly db: Database) {}

  static open(SQL: SqlJsStatic, bytes?: Uint8Array | null): Store {
    const db = bytes && bytes.length ? new SQL.Database(bytes) : new SQL.Database();
    db.run("PRAGMA foreign_keys = ON;");
    db.run(SCHEMA_SQL);
    const store = new Store(db);
    store.migrate();
    return store;
  }

  private migrate() {
    const v = this.get<{ value: string }>("SELECT value FROM meta WHERE key='schema_version'");
    const from = v ? Number(v.value) : SCHEMA_VERSION;
    if (from < 2) {
      // v2: recordings (sections.t_start). New tables are created by SCHEMA_SQL (IF NOT EXISTS).
      const cols = this.all<{ name: string }>("PRAGMA table_info(sections)").map((c) => c.name);
      if (!cols.includes("t_start")) this.db.run("ALTER TABLE sections ADD COLUMN t_start REAL");
    }
    this.db.run("INSERT INTO meta(key,value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [String(SCHEMA_VERSION)]);
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private changed() {
    this.listeners.forEach((fn) => fn());
  }

  export(): Uint8Array {
    return this.db.export();
  }

  /* -------- low level -------- */
  run(sql: string, params: SqlValue[] = []): number {
    this.db.run(sql, params);
    this.changed();
    const r = this.db.exec("SELECT last_insert_rowid() AS id");
    return Number(r[0]?.values[0]?.[0] ?? 0);
  }
  all<T = Row>(sql: string, params: SqlValue[] = []): T[] {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const out: T[] = [];
      while (stmt.step()) out.push(stmt.getAsObject() as T);
      return out;
    } finally {
      stmt.free();
    }
  }
  get<T = Row>(sql: string, params: SqlValue[] = []): T | undefined {
    return this.all<T>(sql, params)[0];
  }
  transaction<T>(fn: () => T): T {
    this.db.run("BEGIN");
    try {
      const out = fn();
      this.db.run("COMMIT");
      this.changed();
      return out;
    } catch (e) {
      this.db.run("ROLLBACK");
      throw e;
    }
  }

  /* -------- settings -------- */
  getSetting(key: string): string | null {
    return this.get<{ value: string }>("SELECT value FROM meta WHERE key=?", [`setting:${key}`])?.value ?? null;
  }
  setSetting(key: string, value: string) {
    this.run("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [
      `setting:${key}`,
      value,
    ]);
  }

  /* -------- courses -------- */
  createCourse(name: string, examDate: string | null = null): number {
    return this.run("INSERT INTO courses(name, exam_date) VALUES(?,?)", [name, examDate]);
  }
  updateCourse(id: number, patch: Partial<Pick<Course, "name" | "exam_date" | "minutes_per_day">>) {
    const c = this.course(id);
    if (!c) throw new Error("course not found");
    this.run("UPDATE courses SET name=?, exam_date=?, minutes_per_day=? WHERE id=?", [
      patch.name ?? c.name,
      patch.exam_date === undefined ? c.exam_date : patch.exam_date,
      patch.minutes_per_day ?? c.minutes_per_day,
      id,
    ]);
  }
  deleteCourse(id: number) {
    this.run("DELETE FROM courses WHERE id=?", [id]);
  }
  courses(): Course[] {
    return this.all<Course>("SELECT * FROM courses ORDER BY created_at DESC, id DESC");
  }
  course(id: number): Course | undefined {
    return this.get<Course>("SELECT * FROM courses WHERE id=?", [id]);
  }

  /* -------- sources -------- */
  addSource(s: Pick<Source, "course_id" | "name" | "kind" | "mime" | "path" | "hash" | "size">): number {
    return this.run("INSERT INTO sources(course_id,name,kind,mime,path,hash,size) VALUES(?,?,?,?,?,?,?)", [
      s.course_id,
      s.name,
      s.kind,
      s.mime,
      s.path,
      s.hash,
      s.size,
    ]);
  }
  sources(courseId: number): Source[] {
    return this.all<Source>("SELECT * FROM sources WHERE course_id=? ORDER BY id", [courseId]);
  }
  source(id: number): Source | undefined {
    return this.get<Source>("SELECT * FROM sources WHERE id=?", [id]);
  }
  sourceByHash(courseId: number, hash: string): Source | undefined {
    return this.get<Source>("SELECT * FROM sources WHERE course_id=? AND hash=?", [courseId, hash]);
  }
  setSourceStatus(id: number, status: Source["status"], progress: number, error: string | null = null) {
    this.run("UPDATE sources SET status=?, progress=?, error=? WHERE id=?", [status, progress, error, id]);
  }
  setSourceKind(id: number, kind: Source["kind"]) {
    this.run("UPDATE sources SET kind=? WHERE id=?", [kind, id]);
  }
  deleteSource(id: number) {
    this.run("DELETE FROM sources WHERE id=?", [id]);
  }

  /* -------- sections -------- */
  replaceSections(
    courseId: number,
    sourceId: number,
    sections: { anchor: string; page: number | null; title: string; text: string; tStart?: number | null }[],
  ): number[] {
    return this.transaction(() => {
      this.db.run("DELETE FROM sections WHERE source_id=?", [sourceId]);
      const ids: number[] = [];
      sections.forEach((s, i) => {
        this.db.run("INSERT INTO sections(course_id,source_id,ord,anchor,page,title,text,t_start) VALUES(?,?,?,?,?,?,?,?)", [
          courseId,
          sourceId,
          i,
          s.anchor,
          s.page,
          s.title,
          s.text,
          s.tStart ?? null,
        ]);
        ids.push(Number(this.db.exec("SELECT last_insert_rowid()")[0].values[0][0]));
      });
      return ids;
    });
  }
  updateSectionMeta(id: number, title: string, summary: string) {
    this.run("UPDATE sections SET title=?, summary=? WHERE id=?", [title, summary, id]);
  }
  sections(courseId: number, sourceIds?: number[]): Section[] {
    if (sourceIds && sourceIds.length) {
      const q = sourceIds.map(() => "?").join(",");
      return this.all<Section>(`SELECT * FROM sections WHERE course_id=? AND source_id IN (${q}) ORDER BY source_id, ord`, [
        courseId,
        ...sourceIds,
      ]);
    }
    return this.all<Section>("SELECT * FROM sections WHERE course_id=? ORDER BY source_id, ord", [courseId]);
  }
  sectionsOfSource(sourceId: number): Section[] {
    return this.all<Section>("SELECT * FROM sections WHERE source_id=? ORDER BY ord", [sourceId]);
  }
  section(id: number): Section | undefined {
    return this.get<Section>("SELECT * FROM sections WHERE id=?", [id]);
  }

  /* -------- concepts -------- */
  concepts(courseId: number): Concept[] {
    return this.all<Row>("SELECT * FROM concepts WHERE course_id=? ORDER BY id", [courseId]).map((r) => ({
      ...(r as unknown as Concept),
      prerequisites: JSON.parse(String(r.prerequisites)),
      section_ids: JSON.parse(String(r.section_ids)),
    }));
  }
  upsertConcept(courseId: number, c: Omit<Concept, "id" | "course_id">) {
    this.run(
      `INSERT INTO concepts(course_id,name,name_en,definition,prerequisites,section_ids) VALUES(?,?,?,?,?,?)
       ON CONFLICT(course_id,name) DO UPDATE SET name_en=excluded.name_en, definition=excluded.definition,
         prerequisites=excluded.prerequisites, section_ids=excluded.section_ids`,
      [courseId, c.name, c.name_en, c.definition, JSON.stringify(c.prerequisites), JSON.stringify(c.section_ids)],
    );
  }

  /* -------- artifacts -------- */
  addArtifact(a: Omit<Artifact, "id" | "created_at">): number {
    return this.run("INSERT INTO artifacts(course_id,tool_id,type,title,data,params) VALUES(?,?,?,?,?,?)", [
      a.course_id,
      a.tool_id,
      a.type,
      a.title,
      JSON.stringify(a.data),
      JSON.stringify(a.params),
    ]);
  }
  updateArtifactData(id: number, data: unknown) {
    this.run("UPDATE artifacts SET data=? WHERE id=?", [JSON.stringify(data), id]);
  }
  artifacts(courseId: number): Artifact[] {
    return this.all<Row>("SELECT * FROM artifacts WHERE course_id=? ORDER BY id DESC", [courseId]).map(parseArtifact);
  }
  artifact(id: number): Artifact | undefined {
    const r = this.get<Row>("SELECT * FROM artifacts WHERE id=?", [id]);
    return r ? parseArtifact(r) : undefined;
  }
  deleteArtifact(id: number) {
    this.run("DELETE FROM artifacts WHERE id=?", [id]);
  }

  /* -------- learner -------- */
  addAttempt(a: { course_id: number; concept: string; item_ref: string; correct: boolean; score: number; answer: string; feedback: string }) {
    return this.run("INSERT INTO attempts(course_id,concept,item_ref,correct,score,answer,feedback) VALUES(?,?,?,?,?,?,?)", [
      a.course_id,
      a.concept,
      a.item_ref,
      a.correct ? 1 : 0,
      a.score,
      a.answer,
      a.feedback,
    ]);
  }
  attempts(courseId: number) {
    return this.all<{ concept: string; correct: number; score: number; item_ref: string; created_at: string }>(
      "SELECT * FROM attempts WHERE course_id=? ORDER BY id",
      [courseId],
    );
  }
  mastery(courseId: number): Map<string, { p: number; attempts: number }> {
    const m = new Map<string, { p: number; attempts: number }>();
    for (const r of this.all<{ concept: string; p_known: number; attempts: number }>(
      "SELECT concept,p_known,attempts FROM mastery WHERE course_id=?",
      [courseId],
    ))
      m.set(r.concept, { p: r.p_known, attempts: r.attempts });
    return m;
  }
  setMastery(courseId: number, concept: string, p: number, attempts: number) {
    this.run(
      `INSERT INTO mastery(course_id,concept,p_known,attempts,updated_at) VALUES(?,?,?,?,datetime('now'))
       ON CONFLICT(course_id,concept) DO UPDATE SET p_known=excluded.p_known, attempts=excluded.attempts, updated_at=excluded.updated_at`,
      [courseId, concept, p, attempts],
    );
  }

  /* -------- cards -------- */
  addCard(c: Omit<Card, "id">): number {
    return this.run("INSERT INTO cards(course_id,artifact_id,front,back,concept,citations,fsrs,due) VALUES(?,?,?,?,?,?,?,?)", [
      c.course_id,
      c.artifact_id,
      c.front,
      c.back,
      c.concept,
      JSON.stringify(c.citations),
      c.fsrs,
      c.due,
    ]);
  }
  dueCards(courseId: number, nowIso: string): Card[] {
    return this.all<Row>("SELECT * FROM cards WHERE course_id=? AND due<=? ORDER BY due LIMIT 200", [courseId, nowIso]).map(parseCard);
  }
  cardCount(courseId: number): number {
    return Number(this.get<{ n: number }>("SELECT COUNT(*) AS n FROM cards WHERE course_id=?", [courseId])?.n ?? 0);
  }
  updateCard(id: number, fsrs: string, due: string) {
    this.run("UPDATE cards SET fsrs=?, due=? WHERE id=?", [fsrs, due, id]);
  }

  /* -------- chat -------- */
  chat(courseId: number): { id: number; messages: { role: "user" | "assistant"; content: string }[] } {
    const r = this.get<{ id: number; messages: string }>("SELECT id, messages FROM chats WHERE course_id=? ORDER BY id DESC LIMIT 1", [courseId]);
    if (r) return { id: r.id, messages: JSON.parse(r.messages) };
    const id = this.run("INSERT INTO chats(course_id) VALUES(?)", [courseId]);
    return { id, messages: [] };
  }
  saveChat(id: number, messages: unknown[]) {
    this.run("UPDATE chats SET messages=?, updated_at=datetime('now') WHERE id=?", [JSON.stringify(messages), id]);
  }
  newChat(courseId: number) {
    this.run("INSERT INTO chats(course_id) VALUES(?)", [courseId]);
  }

  /* -------- mistakes notebook -------- */
  addMistake(m: Omit<Mistake, "id" | "created_at" | "updated_at" | "status" | "streak" | "misconception"> & { misconception?: string }): number {
    // One open entry per item: answering the same question wrong again just resets its schedule.
    const existing = m.item_ref ? this.get<{ id: number }>("SELECT id FROM mistakes WHERE course_id=? AND item_ref=? AND status='open'", [m.course_id, m.item_ref]) : undefined;
    if (existing) {
      this.run("UPDATE mistakes SET student_answer=?, streak=0, due=?, updated_at=datetime('now') WHERE id=?", [m.student_answer, m.due, existing.id]);
      return existing.id;
    }
    return this.run(
      "INSERT INTO mistakes(course_id,concept,origin,item_ref,question,student_answer,correct_answer,explanation,citations,misconception,due) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      [m.course_id, m.concept, m.origin, m.item_ref, m.question, m.student_answer, m.correct_answer, m.explanation, JSON.stringify(m.citations), m.misconception ?? "", m.due],
    );
  }
  mistakes(courseId: number, status?: Mistake["status"]): Mistake[] {
    const rows = status
      ? this.all<Row>("SELECT * FROM mistakes WHERE course_id=? AND status=? ORDER BY due, id", [courseId, status])
      : this.all<Row>("SELECT * FROM mistakes WHERE course_id=? ORDER BY status DESC, due, id", [courseId]);
    return rows.map(parseMistake);
  }
  mistake(id: number): Mistake | undefined {
    const r = this.get<Row>("SELECT * FROM mistakes WHERE id=?", [id]);
    return r ? parseMistake(r) : undefined;
  }
  dueMistakes(courseId: number, nowIso: string): Mistake[] {
    return this.all<Row>("SELECT * FROM mistakes WHERE course_id=? AND status='open' AND due<=? ORDER BY due LIMIT 50", [courseId, nowIso]).map(parseMistake);
  }
  updateMistake(id: number, patch: Partial<Pick<Mistake, "misconception" | "status" | "streak" | "due" | "concept">>) {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (!keys.length) return;
    this.run(`UPDATE mistakes SET ${keys.map((k) => `${k}=?`).join(", ")}, updated_at=datetime('now') WHERE id=?`, [...keys.map((k) => patch[k] as SqlValue), id]);
  }
  deleteMistake(id: number) {
    this.run("DELETE FROM mistakes WHERE id=?", [id]);
  }

  /* -------- daily sessions -------- */
  addSession(s: Omit<SessionLog, "id">): number {
    return this.run("INSERT INTO sessions(course_id,day,items,correct,seconds) VALUES(?,?,?,?,?)", [s.course_id, s.day, s.items, s.correct, s.seconds]);
  }
  sessionDays(courseId: number): string[] {
    return this.all<{ day: string }>("SELECT DISTINCT day FROM sessions WHERE course_id=? ORDER BY day DESC LIMIT 400", [courseId]).map((r) => r.day);
  }

  /* -------- usage -------- */
  addUsage(u: { tag: string; model: string; input: number; output: number; cacheRead: number }) {
    this.run("INSERT INTO usage(tag,model,input_tokens,output_tokens,cache_read_tokens) VALUES(?,?,?,?,?)", [
      u.tag,
      u.model,
      u.input,
      u.output,
      u.cacheRead,
    ]);
  }
  usageTotals() {
    return this.all<{ model: string; input: number; output: number; cache_read: number }>(
      "SELECT model, SUM(input_tokens) AS input, SUM(output_tokens) AS output, SUM(cache_read_tokens) AS cache_read FROM usage GROUP BY model",
    );
  }
}

function parseArtifact(r: Row): Artifact {
  return { ...(r as unknown as Artifact), data: JSON.parse(String(r.data)), params: JSON.parse(String(r.params)) };
}
function parseCard(r: Row): Card {
  return { ...(r as unknown as Card), citations: JSON.parse(String(r.citations)) };
}

function parseMistake(r: Row): Mistake {
  return { ...(r as unknown as Mistake), citations: JSON.parse(String(r.citations ?? "[]")) };
}
