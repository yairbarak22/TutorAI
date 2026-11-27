import { safeMimeFor, type MoodleFileRow, type MoodleLink, type Source, type Store } from "@tutorai/core";
import type { MoodleContents, MoodleDownloadEvent, MoodleDownloadRequest } from "@tutorai/local-api";
import { cleanCourseName, isNew, looksLikeExam, planSync, type MoodleErrorKind, type RemoteCourse } from "@tutorai/moodle";

/**
 * What the page does with a linked Moodle course (docs/rfc-moodle.md §7.4): refresh the list of
 * files (automatic, never downloads) and import the ones the student picked (always a choice).
 * The database is the page's; the server only lists and downloads.
 */

export type Lang = "he" | "en";

export interface SyncDeps {
  store: Store;
  contents(site: string, remoteCourseId: number, lang: Lang, fresh: boolean): Promise<MoodleContents>;
  download(req: MoodleDownloadRequest): AsyncIterable<MoodleDownloadEvent>;
  /** Starts analysis of a new source (the existing ingestion queue). */
  enqueue(sourceId: number): void;
  /** Saves the database now. Returns an error message when saving failed. */
  flush(): Promise<string | null>;
  /** Removes a file from the data folder (a download that turned out to be a copy). */
  removeFile?(path: string): Promise<void>;
  lang(): Lang;
  now?(): Date;
}

/** The kind of a failure, whatever threw it. */
export function errorKindOf(e: unknown): MoodleErrorKind {
  const kind = (e as { kind?: string } | null)?.kind;
  const known: MoodleErrorKind[] = ["auth", "unavailable", "policy", "forbidden", "blocked", "network", "unsupported", "too_large", "wrong_type", "not_listed", "other"];
  if (kind && (known as string[]).includes(kind)) return kind as MoodleErrorKind;
  return e instanceof TypeError ? "network" : "other";
}

export const REFRESH_AFTER_MS = 6 * 3600_000;

/** A linked course is checked again when its list is older than six hours. */
export function shouldRefresh(link: MoodleLink, now = new Date()): boolean {
  return !link.last_sync || now.getTime() - Date.parse(link.last_sync) > REFRESH_AFTER_MS;
}

/** Rows the "N new files in Moodle" notice counts. */
export const newFiles = (store: Store, courseId: number): MoodleFileRow[] => store.moodleFiles(courseId).filter(isNew);

/**
 * Asks Moodle what the course holds now and records what changed. Never downloads.
 * On failure the rows stay as they were and the error kind is kept on the link.
 */
export async function refreshCourse(deps: SyncDeps, courseId: number, fresh = true): Promise<MoodleContents> {
  const link = deps.store.moodleLink(courseId);
  if (!link) throw Object.assign(new Error("not linked"), { kind: "not_listed" });
  try {
    const contents = await deps.contents(link.site, link.remote_course_id, deps.lang(), fresh);
    deps.store.applyMoodleChanges(courseId, planSync(contents.files, deps.store.moodleFiles(courseId)));
    deps.store.setMoodleSync(courseId, (deps.now?.() ?? new Date()).toISOString(), null);
    return contents;
  } catch (e) {
    deps.store.setMoodleSync(courseId, null, errorKindOf(e));
    throw e;
  }
}

export interface ImportOutcome {
  imported: number;
  duplicates: number;
  failed: number;
  /** Why the batch stopped early, if it did. "save": the database could not be written. */
  stopped?: MoodleErrorKind | "save";
}

/** Sample exam when the file, its activity or its section says so. */
export const guessKind = (row: Pick<MoodleFileRow, "filename" | "activity" | "section">): Source["kind"] => (looksLikeExam(row.filename, row.activity, row.section) ? "sample_exam" : "material");

/**
 * Downloads the chosen files one by one and hands each to the normal ingestion pipeline.
 * A sign-in problem or a site that is limiting us stops the batch; other failures don't.
 */
export async function importFiles(
  deps: SyncDeps,
  courseId: number,
  rowIds: number[],
  kinds: Map<number, Source["kind"]> = new Map(),
  onProgress?: (rowId: number, received: number, total: number | null) => void,
): Promise<ImportOutcome> {
  const out: ImportOutcome = { imported: 0, duplicates: 0, failed: 0 };
  const link = deps.store.moodleLink(courseId);
  if (!link) return { ...out, stopped: "not_listed" };

  for (const rowId of rowIds) {
    const row = deps.store.moodleFiles(courseId).find((r) => r.id === rowId);
    if (!row) continue;
    let final: MoodleDownloadEvent | null = null;
    try {
      const request: MoodleDownloadRequest = { site: link.site, remoteCourseId: link.remote_course_id, key: row.remote_key, courseId, knownHashes: deps.store.sources(courseId).map((s) => s.hash) };
      for await (const e of deps.download(request)) {
        if (e.type === "progress") onProgress?.(rowId, e.received, e.total);
        else final = e;
      }
    } catch (e) {
      final = { type: "error", kind: errorKindOf(e) };
    }
    // A stream that ended without saying how is a lost connection to TutorAI on this computer.
    final ??= { type: "error", kind: "network" };

    // The course may have gained this very file while it was downloading (another import running).
    const already = final.type === "done" ? deps.store.sourceByHash(courseId, final.hash) : undefined;
    if (final.type === "done" && already) {
      if (already.path !== final.path) await deps.removeFile?.(final.path).catch(() => {});
      deps.store.setMoodleFile(rowId, { state: "imported", source_id: already.id, changed: false, error: null });
      out.duplicates++;
    } else if (final.type === "done") {
      const sourceId = deps.store.addSource({ course_id: courseId, name: final.name, kind: kinds.get(rowId) ?? guessKind(row), mime: safeMimeFor(final.name), path: final.path, hash: final.hash, size: final.size });
      deps.store.setMoodleFile(rowId, { state: "imported", source_id: sourceId, changed: false, error: null });
      // The file is already in the folder: make sure the saved database knows it before going on.
      const saveError = await deps.flush();
      deps.enqueue(sourceId);
      out.imported++;
      if (saveError) return { ...out, stopped: "save" };
    } else if (final.type === "duplicate") {
      const existing = deps.store.sourceByHash(courseId, final.hash);
      deps.store.setMoodleFile(rowId, { state: "imported", source_id: existing?.id ?? null, changed: false, error: null });
      out.duplicates++;
    } else {
      if (final.kind === "too_large") deps.store.setMoodleFile(rowId, { state: "too_large", error: null });
      else deps.store.setMoodleFile(rowId, { state: "failed", error: final.kind });
      out.failed++;
      if (final.kind === "auth" || final.kind === "blocked") return { ...out, stopped: final.kind };
    }
  }
  return out;
}

/** "Don't show these again": new files are skipped, updated ones stop being flagged. */
export function dismissNew(store: Store, courseId: number) {
  for (const row of newFiles(store, courseId)) store.setMoodleFile(row.id, row.state === "new" ? { state: "skipped" } : { changed: false });
}

/** Creates a TutorAI course for a Moodle course (or reuses the one already linked to it). */
export function linkNewCourse(store: Store, site: string, course: RemoteCourse): number {
  const existing = store.moodleLinkFor(site, course.id);
  if (existing) return existing.course_id;
  const id = store.createCourse(cleanCourseName(course.displayname));
  store.linkMoodle(id, site, course.id, cleanCourseName(course.displayname));
  return id;
}
