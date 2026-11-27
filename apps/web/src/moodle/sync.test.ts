import initSqlJs from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";
import { Store, safeFileName } from "@tutorai/core";
import type { MoodleContents, MoodleDownloadEvent, MoodleDownloadRequest } from "@tutorai/local-api";
import { safeName, type RemoteFile } from "@tutorai/moodle";
import { dismissNew, errorKindOf, guessKind, importFiles, linkNewCourse, newFiles, refreshCourse, shouldRefresh, type SyncDeps } from "./sync.ts";

const SQL = await initSqlJs();
const SITE = "https://moodle.runi.ac.il/2027";
const file = (key: string, over: Partial<RemoteFile> = {}): RemoteFile => ({ key, cmid: Number(key.split(":")[0]), modname: "resource", section: "שבוע 1", activity: "מצגת", filename: key.split("/").pop()!, filepath: "/", size: 1000, modified: 10, ...over });
const hash = (n: number) => String(n).repeat(64).slice(0, 64);

let store: Store;
let courseId: number;
let remote: RemoteFile[];
let answers: Map<string, MoodleDownloadEvent[] | Error>;
let requests: MoodleDownloadRequest[];
let enqueued: number[];
let flushes: number;
let flushError: string | null;
let contentsError: unknown;
let deps: SyncDeps;

beforeEach(() => {
  store = Store.open(SQL);
  courseId = store.createCourse("רשתות");
  store.linkMoodle(courseId, SITE, 101, "רשתות תקשורת מחשבים");
  remote = [file("1:/lecture1.pdf"), file("2:/exam-2025.pdf", { activity: "מבחנים" }), file("3:/data.zip")];
  answers = new Map();
  requests = [];
  enqueued = [];
  flushes = 0;
  flushError = null;
  contentsError = null;
  deps = {
    store,
    contents: async (): Promise<MoodleContents> => {
      if (contentsError) throw contentsError;
      return { files: remote, other: { textPages: 0, links: 0, external: 0, notImportable: {} } };
    },
    download: async function* (req) {
      requests.push(req);
      const a = answers.get(req.key) ?? [{ type: "done", path: `courses/${req.courseId}/sources/x-${req.key.split("/").pop()}`, hash: hash(requests.length), size: 1000, name: req.key.split("/").pop()! }];
      if (a instanceof Error) throw a;
      yield* a;
    },
    enqueue: (id) => void enqueued.push(id),
    flush: async () => (flushes++, flushError),
    lang: () => "he",
    now: () => new Date("2026-11-27T10:00:00Z"),
  };
});

const rows = () => store.moodleFiles(courseId);
const row = (key: string) => rows().find((r) => r.remote_key === key)!;

describe("refresh", () => {
  it("records what Moodle lists and when, without downloading anything", async () => {
    await refreshCourse(deps, courseId);
    expect(rows().map((r) => [r.remote_key, r.state])).toEqual([["1:/lecture1.pdf", "new"], ["2:/exam-2025.pdf", "new"], ["3:/data.zip", "unsupported"]]);
    expect(store.moodleLink(courseId)).toMatchObject({ last_sync: "2026-11-27T10:00:00.000Z", last_error: null });
    expect(requests).toEqual([]);
    expect(newFiles(store, courseId).map((r) => r.filename)).toEqual(["lecture1.pdf", "exam-2025.pdf"]);
  });

  it("keeps the rows and remembers why when Moodle can't be reached", async () => {
    await refreshCourse(deps, courseId);
    contentsError = Object.assign(new Error("502"), { kind: "auth" });
    await expect(refreshCourse(deps, courseId)).rejects.toBeTruthy();
    expect(rows()).toHaveLength(3);
    expect(store.moodleLink(courseId)).toMatchObject({ last_sync: "2026-11-27T10:00:00.000Z", last_error: "auth" });
    contentsError = null;
    await refreshCourse(deps, courseId);
    expect(store.moodleLink(courseId)!.last_error).toBeNull();
  });

  it("checks a course again after six hours", () => {
    const link = store.moodleLink(courseId)!;
    expect(shouldRefresh(link)).toBe(true);
    expect(shouldRefresh({ ...link, last_sync: "2026-11-27T10:00:00Z" }, new Date("2026-11-27T15:00:00Z"))).toBe(false);
    expect(shouldRefresh({ ...link, last_sync: "2026-11-27T10:00:00Z" }, new Date("2026-11-27T16:30:00Z"))).toBe(true);
  });
});

describe("import", () => {
  beforeEach(async () => {
    await refreshCourse(deps, courseId);
  });

  it("turns a downloaded file into a source, saves, and starts analysis", async () => {
    const lecture = row("1:/lecture1.pdf");
    const exam = row("2:/exam-2025.pdf");
    const out = await importFiles(deps, courseId, [lecture.id, exam.id]);
    expect(out).toEqual({ imported: 2, duplicates: 0, failed: 0 });
    const sources = store.sources(courseId);
    expect(sources.map((s) => [s.name, s.kind, s.mime, s.path])).toEqual([
      ["lecture1.pdf", "material", "application/pdf", `courses/${courseId}/sources/x-lecture1.pdf`],
      ["exam-2025.pdf", "sample_exam", "application/pdf", `courses/${courseId}/sources/x-exam-2025.pdf`],
    ]);
    expect(enqueued).toEqual(sources.map((s) => s.id));
    expect(flushes).toBe(2);
    expect(row("1:/lecture1.pdf")).toMatchObject({ state: "imported", source_id: sources[0].id, changed: false });
    expect(requests[0]).toMatchObject({ site: SITE, remoteCourseId: 101, key: "1:/lecture1.pdf", courseId, knownHashes: [] });
    expect(requests[1].knownHashes).toEqual([sources[0].hash]); // the second request already knows the first file
    expect(newFiles(store, courseId)).toEqual([]);
  });

  it("uses the type the student chose, and guesses exams from the names around a file", async () => {
    await importFiles(deps, courseId, [row("1:/lecture1.pdf").id], new Map([[row("1:/lecture1.pdf").id, "sample_exam"]]));
    expect(store.sources(courseId)[0].kind).toBe("sample_exam");
    expect(guessKind({ filename: "a.pdf", activity: "Slides", section: "בחינות משנים קודמות" })).toBe("sample_exam");
    expect(guessKind({ filename: "a.pdf", activity: "Slides", section: "Week 1" })).toBe("material");
  });

  it("points a duplicate at the source the course already has", async () => {
    await importFiles(deps, courseId, [row("1:/lecture1.pdf").id]);
    const existing = store.sources(courseId)[0];
    answers.set("2:/exam-2025.pdf", [{ type: "duplicate", hash: existing.hash }]);
    expect(await importFiles(deps, courseId, [row("2:/exam-2025.pdf").id])).toEqual({ imported: 0, duplicates: 1, failed: 0 });
    expect(row("2:/exam-2025.pdf")).toMatchObject({ state: "imported", source_id: existing.id });
    expect(store.sources(courseId)).toHaveLength(1);
  });

  it("does not add a file twice when another import brought it in meanwhile", async () => {
    await importFiles(deps, courseId, [row("1:/lecture1.pdf").id]);
    const existing = store.sources(courseId)[0];
    const removed: string[] = [];
    deps.removeFile = async (path) => void removed.push(path);
    // The server could not know: it answers "done" with the same content under another name…
    answers.set("2:/exam-2025.pdf", [{ type: "done", path: `courses/${courseId}/sources/x-copy.pdf`, hash: existing.hash, size: 1000, name: "copy.pdf" }]);
    expect(await importFiles(deps, courseId, [row("2:/exam-2025.pdf").id])).toEqual({ imported: 0, duplicates: 1, failed: 0 });
    expect(store.sources(courseId)).toHaveLength(1);
    expect(row("2:/exam-2025.pdf")).toMatchObject({ state: "imported", source_id: existing.id });
    expect(removed).toEqual([`courses/${courseId}/sources/x-copy.pdf`]);
    // …or under the very same path, which must not be deleted from under the existing source.
    remote.push(file("4:/again.pdf"));
    await refreshCourse(deps, courseId);
    answers.set("4:/again.pdf", [{ type: "done", path: existing.path, hash: existing.hash, size: 1000, name: existing.name }]);
    await importFiles(deps, courseId, [row("4:/again.pdf").id]);
    expect(removed).toHaveLength(1);
    expect(enqueued).toHaveLength(1);
  });

  it("marks failures by kind, and stops the batch only when going on is pointless", async () => {
    answers.set("1:/lecture1.pdf", [{ type: "error", kind: "wrong_type" }]);
    answers.set("2:/exam-2025.pdf", [{ type: "progress", received: 5, total: 10 }, { type: "error", kind: "too_large" }]);
    const progress: number[] = [];
    let out = await importFiles(deps, courseId, [row("1:/lecture1.pdf").id, row("2:/exam-2025.pdf").id], new Map(), (_id, received) => progress.push(received));
    expect(out).toEqual({ imported: 0, duplicates: 0, failed: 2 });
    expect(progress).toEqual([5]);
    expect(row("1:/lecture1.pdf")).toMatchObject({ state: "failed", error: "wrong_type" });
    expect(row("2:/exam-2025.pdf")).toMatchObject({ state: "too_large", error: null });

    for (const kind of ["auth", "blocked"] as const) {
      requests.length = 0;
      answers.set("1:/lecture1.pdf", [{ type: "error", kind }]);
      answers.delete("2:/exam-2025.pdf");
      out = await importFiles(deps, courseId, [row("1:/lecture1.pdf").id, row("2:/exam-2025.pdf").id]);
      expect(out).toEqual({ imported: 0, duplicates: 0, failed: 1, stopped: kind });
      expect(requests).toHaveLength(1);
    }
  });

  it("treats a lost connection to TutorAI as a failed file, and a failed save as a reason to stop", async () => {
    answers.set("1:/lecture1.pdf", []); // the stream ended without a final event
    answers.set("2:/exam-2025.pdf", new TypeError("fetch failed"));
    expect(await importFiles(deps, courseId, [row("1:/lecture1.pdf").id, row("2:/exam-2025.pdf").id])).toEqual({ imported: 0, duplicates: 0, failed: 2 });
    expect(row("1:/lecture1.pdf").error).toBe("network");
    expect(row("2:/exam-2025.pdf").error).toBe("network");

    answers.clear();
    flushError = "disk full";
    const out = await importFiles(deps, courseId, [row("1:/lecture1.pdf").id, row("2:/exam-2025.pdf").id]);
    expect(out).toEqual({ imported: 1, duplicates: 0, failed: 0, stopped: "save" });
    expect(requests.filter((r) => r.key === "2:/exam-2025.pdf")).toHaveLength(1); // only the earlier failed attempt
  });

  it("offers a changed file again and keeps the old source", async () => {
    await importFiles(deps, courseId, [row("1:/lecture1.pdf").id]);
    const old = store.sources(courseId)[0];
    remote[0] = file("1:/lecture1.pdf", { size: 2000, modified: 20 });
    await refreshCourse(deps, courseId);
    expect(row("1:/lecture1.pdf")).toMatchObject({ state: "imported", changed: true, source_id: old.id });
    expect(newFiles(store, courseId).map((r) => r.remote_key)).toContain("1:/lecture1.pdf");
    answers.set("1:/lecture1.pdf", [{ type: "done", path: `courses/${courseId}/sources/y-lecture1.pdf`, hash: hash(9), size: 2000, name: "lecture1.pdf" }]);
    await importFiles(deps, courseId, [row("1:/lecture1.pdf").id]);
    const sources = store.sources(courseId);
    expect(sources).toHaveLength(2);
    expect(row("1:/lecture1.pdf")).toMatchObject({ changed: false, source_id: sources[1].id });
  });

  it("stops offering what the student dismissed or deleted, until it changes", async () => {
    await importFiles(deps, courseId, [row("1:/lecture1.pdf").id]);
    dismissNew(store, courseId);
    expect(row("2:/exam-2025.pdf").state).toBe("skipped");
    expect(newFiles(store, courseId)).toEqual([]);
    store.deleteSource(store.sources(courseId)[0].id);
    expect(row("1:/lecture1.pdf").source_id).toBeNull();
    await refreshCourse(deps, courseId);
    expect(row("1:/lecture1.pdf").state).toBe("skipped");
    remote[1] = file("2:/exam-2025.pdf", { modified: 99 });
    await refreshCourse(deps, courseId);
    expect(row("2:/exam-2025.pdf").state).toBe("new");
  });
});

describe("linking", () => {
  it("creates one course per Moodle course and reuses an existing link", () => {
    const remoteCourse = { id: 202, shortname: "CT", fullname: "תורת הסיבוכיות", displayname: "  תורת   הסיבוכיות ", startdate: 0, enddate: 0, hidden: false, lastaccess: null };
    const id = linkNewCourse(store, SITE, remoteCourse);
    expect(store.course(id)!.name).toBe("תורת הסיבוכיות");
    expect(store.moodleLink(id)).toMatchObject({ site: SITE, remote_course_id: 202 });
    expect(linkNewCourse(store, SITE, remoteCourse)).toBe(id);
    expect(store.courses()).toHaveLength(2);
  });

  it("unlinking keeps the imported sources, and deleting the course removes everything", async () => {
    await refreshCourse(deps, courseId);
    await importFiles(deps, courseId, [row("1:/lecture1.pdf").id]);
    store.unlinkMoodle(courseId);
    expect(store.moodleLink(courseId)).toBeUndefined();
    expect(rows()).toEqual([]);
    expect(store.sources(courseId)).toHaveLength(1);

    store.linkMoodle(courseId, SITE, 101, "x");
    await refreshCourse(deps, courseId);
    store.deleteCourse(courseId);
    expect(store.all("SELECT * FROM moodle_links")).toEqual([]);
    expect(store.all("SELECT * FROM moodle_files")).toEqual([]);
  });
});

describe("shared rules", () => {
  it("reads an error's kind from whatever threw it", () => {
    expect(errorKindOf(Object.assign(new Error("x"), { kind: "blocked" }))).toBe("blocked");
    expect(errorKindOf(Object.assign(new Error("x"), { kind: "made-up" }))).toBe("other");
    expect(errorKindOf(new TypeError("fetch failed"))).toBe("network");
    expect(errorKindOf("boom")).toBe("other");
  });

  it("names files in the folder exactly as a manual upload would", () => {
    for (const name of ['הרצאה 1: מבוא?.pdf', "a/b\\c.pdf", "x".repeat(200) + ".pdf", 'q"uo<te>|.docx', "plain.pdf"]) expect(safeName(name)).toBe(safeFileName(name));
  });

  it("opens a database from before this feature", () => {
    const old = Store.open(SQL);
    old.run("DROP TABLE moodle_files");
    old.run("DROP TABLE moodle_links");
    old.run("UPDATE meta SET value='3' WHERE key='schema_version'");
    const reopened = Store.open(SQL, old.export());
    expect(reopened.moodleLinks()).toEqual([]);
    expect(reopened.get<{ value: string }>("SELECT value FROM meta WHERE key='schema_version'")!.value).toBe("4");
  });
});
