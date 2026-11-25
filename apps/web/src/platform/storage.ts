import JSZip from "jszip";
import type { FileStore } from "@ruecai/core";

/**
 * Where the student's data lives.
 *
 *  folder  — a real folder the student picked (File System Access API, Chrome/Edge).
 *            ruecai.db + courses/… are ordinary files: visible, backed up, syncable via Drive/OneDrive.
 *  browser — IndexedDB inside the browser (Safari/Firefox fallback). Backed up via .ruecai export.
 */

export const DB_FILE = "ruecai.db";
const LOCK_FILE = ".ruecai-lock";

/* ------------------------------ tiny IndexedDB KV ------------------------------ */

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("ruecai", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("kv");
      req.result.createObjectStore("files");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx<T>(store: "kv" | "files", mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
  });
}
export const kv = {
  get: <T>(k: string) => tx<T>("kv", "readonly", (s) => s.get(k) as IDBRequest<T>),
  set: (k: string, v: unknown) => tx("kv", "readwrite", (s) => s.put(v, k)),
  del: (k: string) => tx("kv", "readwrite", (s) => s.delete(k)),
};

/* ------------------------------ folder (File System Access) ------------------------------ */

type DirHandle = FileSystemDirectoryHandle & {
  queryPermission(o: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(o: { mode: "readwrite" }): Promise<PermissionState>;
};

export const folderSupported = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

class FolderFileStore implements FileStore {
  kind = "folder" as const;
  constructor(private root: FileSystemDirectoryHandle) {}
  get label() {
    return this.root.name;
  }
  private async dir(parts: string[], create: boolean) {
    let d = this.root;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create });
    return d;
  }
  private split(path: string) {
    const parts = path.split("/").filter(Boolean);
    return { dirs: parts.slice(0, -1), name: parts.at(-1)! };
  }
  async write(path: string, data: Uint8Array | Blob) {
    const { dirs, name } = this.split(path);
    const fh = await (await this.dir(dirs, true)).getFileHandle(name, { create: true });
    // createWritable writes to a swap file and swaps on close → atomic replace.
    const w = await fh.createWritable();
    await w.write(data as FileSystemWriteChunkType);
    await w.close();
  }
  async read(path: string) {
    const { dirs, name } = this.split(path);
    const fh = await (await this.dir(dirs, false)).getFileHandle(name);
    return new Uint8Array(await (await fh.getFile()).arrayBuffer());
  }
  async exists(path: string) {
    try {
      await this.read(path);
      return true;
    } catch {
      return false;
    }
  }
  async remove(path: string) {
    const { dirs, name } = this.split(path);
    try {
      await (await this.dir(dirs, false)).removeEntry(name);
    } catch {
      /* already gone */
    }
  }
}

/* ------------------------------ browser (IndexedDB) ------------------------------ */

class BrowserFileStore implements FileStore {
  kind = "browser" as const;
  label = "אחסון הדפדפן";
  async write(path: string, data: Uint8Array | Blob) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
    await tx("files", "readwrite", (s) => s.put(bytes, path));
  }
  async read(path: string) {
    const v = await tx<Uint8Array | undefined>("files", "readonly", (s) => s.get(path) as IDBRequest<Uint8Array | undefined>);
    if (!v) throw new Error(`File not found: ${path}`);
    return v;
  }
  async exists(path: string) {
    return (await tx<number>("files", "readonly", (s) => s.count(path))) > 0;
  }
  async remove(path: string) {
    await tx("files", "readwrite", (s) => s.delete(path));
  }
  async allPaths(): Promise<string[]> {
    return (await tx<IDBValidKey[]>("files", "readonly", (s) => s.getAllKeys())).map(String);
  }
}

/* ------------------------------ data root ------------------------------ */

export type StorageMode = "folder" | "browser";

export interface DataRoot {
  mode: StorageMode;
  files: FileStore;
}

/** Ask the student to pick (or create) their RuecAI folder. Must be called from a click. */
export async function pickFolder(): Promise<DataRoot> {
  const handle = (await (window as unknown as { showDirectoryPicker: (o: object) => Promise<DirHandle> }).showDirectoryPicker({
    id: "ruecai",
    mode: "readwrite",
    startIn: "documents",
  })) as DirHandle;
  await kv.set("folderHandle", handle);
  await kv.set("storageMode", "folder");
  return { mode: "folder", files: new FolderFileStore(handle) };
}

export async function useBrowserStorage(): Promise<DataRoot> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* best effort */
  }
  await kv.set("storageMode", "browser");
  return { mode: "browser", files: new BrowserFileStore() };
}

export type RestoreResult =
  | { status: "ready"; root: DataRoot }
  | { status: "needs-permission"; folderName: string; grant: () => Promise<DataRoot | null> }
  | { status: "none" };

/** Reopens the previous storage choice. Folder access may need one click to re-grant. */
export async function restoreStorage(): Promise<RestoreResult> {
  let mode: StorageMode | undefined;
  try {
    mode = await kv.get<StorageMode>("storageMode");
  } catch {
    return { status: "none" };
  }
  if (mode === "browser") return { status: "ready", root: { mode: "browser", files: new BrowserFileStore() } };
  if (mode !== "folder") return { status: "none" };
  const handle = await kv.get<DirHandle>("folderHandle");
  if (!handle) return { status: "none" };
  const perm = await handle.queryPermission({ mode: "readwrite" });
  if (perm === "granted") return { status: "ready", root: { mode: "folder", files: new FolderFileStore(handle) } };
  return {
    status: "needs-permission",
    folderName: handle.name,
    grant: async () =>
      (await handle.requestPermission({ mode: "readwrite" })) === "granted" ? { mode: "folder", files: new FolderFileStore(handle) } : null,
  };
}

export async function forgetStorage() {
  await kv.del("storageMode");
  await kv.del("folderHandle");
}

/* ------------------------------ autosave + lock ------------------------------ */

export class Persistence {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> = Promise.resolve();
  private dirty = false;
  /** Stable per browser tab (survives reloads), so a reload is not mistaken for another device. */
  readonly sessionId = tabSessionId();
  lastSaved: Date | null = null;
  lastError: string | null = null;
  onStatus?: () => void;

  constructor(
    private root: DataRoot,
    private exportDb: () => Uint8Array,
  ) {}

  markDirty() {
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 700);
  }

  async flush() {
    if (!this.dirty) return this.saving;
    this.dirty = false;
    const bytes = this.exportDb();
    this.saving = this.saving.then(async () => {
      try {
        await this.root.files.write(DB_FILE, bytes);
        this.lastSaved = new Date();
        this.lastError = null;
      } catch (e) {
        this.lastError = (e as Error).message;
        this.dirty = true;
      }
      this.onStatus?.();
    });
    return this.saving;
  }

  /** Returns a warning if another window/computer used this folder in the last 90s. */
  async checkLock(): Promise<string | null> {
    try {
      const raw = new TextDecoder().decode(await this.root.files.read(LOCK_FILE));
      const lock = JSON.parse(raw) as { session: string; at: number; device: string };
      if (lock.session !== this.sessionId && Date.now() - lock.at < 90_000)
        return `נראה שהנתונים פתוחים כרגע בחלון או מחשב אחר (${lock.device}). עבודה בו-זמנית משני מקומות עלולה לדרוס שינויים.`;
    } catch {
      /* no lock */
    }
    return null;
  }

  startHeartbeat() {
    const beat = () =>
      this.root.files
        .write(LOCK_FILE, new TextEncoder().encode(JSON.stringify({ session: this.sessionId, at: Date.now(), device: navigator.platform || "device" })))
        .catch(() => {});
    void beat();
    setInterval(beat, 30_000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void this.flush();
    });
    window.addEventListener("pagehide", () => {
      void this.flush();
      // release the lock so the next opener doesn't see a stale warning
      void this.root.files.write(LOCK_FILE, new TextEncoder().encode(JSON.stringify({ session: this.sessionId, at: 0, device: "" }))).catch(() => {});
    });
  }
}

function tabSessionId(): string {
  try {
    const existing = sessionStorage.getItem("ruecai.session");
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem("ruecai.session", id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

/* ------------------------------ backup ------------------------------ */

/** Builds a .ruecai backup (zip): ruecai.db + every source file it references. */
export async function exportBackup(root: DataRoot, dbBytes: Uint8Array, paths: string[]): Promise<Blob> {
  const zip = new JSZip();
  zip.file(DB_FILE, dbBytes);
  for (const p of paths) {
    try {
      zip.file(p, await root.files.read(p));
    } catch {
      /* missing file — skip */
    }
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

export async function importBackup(root: DataRoot, file: Blob): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(file);
  const db = await zip.file(DB_FILE)?.async("uint8array");
  if (!db) throw new Error("קובץ הגיבוי לא תקין (חסר ruecai.db)");
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || path === DB_FILE) continue;
    // Only source files in the exact layout we write; anything else in the archive is ignored.
    if (!/^courses\/\d+\/sources\/[^/\\]+$/.test(path) || path.includes("..")) continue;
    await root.files.write(path, await entry.async("uint8array"));
  }
  return db;
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
