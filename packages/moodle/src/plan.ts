import type { RemoteFile } from "./schemas.ts";

/**
 * Compares what Moodle lists now with what we already know (docs/rfc-moodle.md §7.3).
 * Pure: the page applies the result to tutorai.db.
 */

export type FileState = "new" | "imported" | "skipped" | "unsupported" | "too_large" | "failed";

/** The same limit as a manual upload (Engine.addFiles). */
export const MAX_FILE_BYTES = 60 * 1024 * 1024;
/** What the ingestion pipeline can read (detectKind in @tutorai/core). */
export const SUPPORTED_EXTENSIONS = ["pdf", "pptx", "docx", "txt", "md", "markdown"];

export const extensionOf = (filename: string) => (filename.includes(".") ? filename.toLowerCase().split(".").pop()! : "");

/** The state of a file seen for the first time, or seen again after it changed. */
export function fresh(file: Pick<RemoteFile, "filename" | "size">): FileState {
  if (!SUPPORTED_EXTENSIONS.includes(extensionOf(file.filename))) return "unsupported";
  if (file.size > MAX_FILE_BYTES) return "too_large";
  return "new";
}

/** A row of moodle_files, as far as planning needs it. */
export interface KnownFile {
  id: number;
  remote_key: string;
  size: number;
  remote_modified: number;
  state: FileState;
  present: boolean;
  changed: boolean;
  source_id: number | null;
}

export interface FileInsert {
  remote_key: string;
  cmid: number;
  modname: string;
  section: string;
  activity: string;
  filename: string;
  size: number;
  remote_modified: number;
  state: FileState;
}
export interface FileUpdate {
  id: number;
  size?: number;
  remote_modified?: number;
  state?: FileState;
  present?: boolean;
  changed?: boolean;
  section?: string;
  activity?: string;
}
export interface SyncPlan {
  inserts: FileInsert[];
  updates: FileUpdate[];
}

export function planSync(remote: RemoteFile[], known: KnownFile[]): SyncPlan {
  const plan: SyncPlan = { inserts: [], updates: [] };
  const byKey = new Map(known.map((k) => [k.remote_key, k]));
  const listed = new Set<string>();

  for (const f of remote) {
    listed.add(f.key);
    const row = byKey.get(f.key);
    if (!row) {
      plan.inserts.push({ remote_key: f.key, cmid: f.cmid, modname: f.modname, section: f.section, activity: f.activity, filename: f.filename, size: f.size, remote_modified: f.modified, state: fresh(f) });
      continue;
    }
    const isChanged = row.size !== f.size || row.remote_modified !== f.modified;
    // "Imported" whose source the student deleted: don't offer it again unless it changes.
    const orphaned = row.state === "imported" && row.source_id === null;
    const u: FileUpdate = { id: row.id };
    if (!row.present) u.present = true;
    if (isChanged) {
      u.size = f.size;
      u.remote_modified = f.modified;
      if (row.state === "imported" && !orphaned) u.changed = true;
      else u.state = fresh(f);
    } else if (orphaned) u.state = "skipped";
    if (Object.keys(u).length > 1) plan.updates.push(u);
  }

  for (const row of known) {
    if (listed.has(row.remote_key)) continue;
    const u: FileUpdate = { id: row.id };
    if (row.present) u.present = false;
    if (row.state === "imported" && row.source_id === null) u.state = "skipped";
    if (Object.keys(u).length > 1) plan.updates.push(u);
  }
  return plan;
}

/** Rows the "N new files in Moodle" notice counts. */
export const isNew = (row: Pick<KnownFile, "state" | "present" | "changed">) => row.present && (row.state === "new" || (row.state === "imported" && row.changed));
