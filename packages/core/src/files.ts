/**
 * Where source files live. In the browser this is the student's chosen folder
 * (File System Access API) or OPFS; in tests it's memory; in Electron it would be fs.
 * Paths are always relative, POSIX-style: "courses/3/sources/12-lecture.pdf".
 */
export interface FileStore {
  write(path: string, data: Uint8Array | Blob): Promise<void>;
  read(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  /** Human-readable location, e.g. "~/Documents/TutorAI" or "browser storage". */
  label: string;
  kind: "folder" | "browser" | "memory";
}

export class MemoryFileStore implements FileStore {
  files = new Map<string, Uint8Array>();
  label = "memory";
  kind = "memory" as const;
  async write(path: string, data: Uint8Array | Blob) {
    this.files.set(path, data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer()));
  }
  async read(path: string) {
    const f = this.files.get(path);
    if (!f) throw new Error(`File not found: ${path}`);
    return f;
  }
  async exists(path: string) {
    return this.files.has(path);
  }
  async remove(path: string) {
    this.files.delete(path);
  }
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", data as unknown as ArrayBuffer);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120);
}
