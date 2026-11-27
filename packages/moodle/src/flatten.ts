import { MAX_KEY_LENGTH, type RawContents, type RemoteFile } from "./schemas.ts";

/** What a course holds that TutorAI can't import, as counts for the screen. */
export interface OtherContent {
  textPages: number;
  links: number;
  external: number;
  notImportable: Record<string, number>;
}

export interface FlatContents {
  files: RemoteFile[];
  /** key → address. Kept on the server; never sent to the page. */
  urls: Map<string, string>;
  other: OtherContent;
}

const FILE_MODULES = new Set(["resource", "folder"]);
const TEXT_MODULES = new Set(["page", "book", "label"]);

/** A file address is ours to fetch only on the site's own token file endpoint. */
export function isSiteFileUrl(fileurl: string, site: string): boolean {
  let u: URL;
  let root: URL;
  try {
    u = new URL(fileurl);
    root = new URL(site);
  } catch {
    return false;
  }
  if (u.origin !== root.origin || u.username || u.password) return false;
  const base = root.pathname.replace(/\/+$/, "");
  return u.pathname.startsWith(`${base}/webservice/pluginfile.php/`);
}

/** Course contents → the files a student can import, plus counts of everything else. */
export function flattenContents(sections: RawContents, site: string): FlatContents {
  const files: RemoteFile[] = [];
  const urls = new Map<string, string>();
  const other: OtherContent = { textPages: 0, links: 0, external: 0, notImportable: {} };
  const skip = (modname: string) => (other.notImportable[modname] = (other.notImportable[modname] ?? 0) + 1);

  for (const section of sections) {
    if (!section.uservisible) continue;
    for (const mod of section.modules) {
      if (!mod.uservisible) continue;
      if (TEXT_MODULES.has(mod.modname)) {
        other.textPages++;
        continue;
      }
      if (mod.modname === "url") {
        other.links++;
        continue;
      }
      if (!FILE_MODULES.has(mod.modname)) {
        skip(mod.modname);
        continue;
      }
      for (const c of mod.contents) {
        if (c.type !== "file" || !c.fileurl || !c.filename) continue;
        if (!isSiteFileUrl(c.fileurl, site)) {
          other.external++;
          continue;
        }
        const filepath = c.filepath || "/";
        const key = `${mod.id}:${filepath}${c.filename}`;
        if (key.length > MAX_KEY_LENGTH) {
          skip(mod.modname);
          continue;
        }
        if (urls.has(key)) continue;
        urls.set(key, c.fileurl);
        files.push({
          key,
          cmid: mod.id,
          modname: mod.modname,
          section: section.name,
          activity: mod.name,
          filename: c.filename,
          filepath,
          size: c.filesize ?? 0,
          modified: c.timemodified ?? 0,
        });
      }
    }
  }
  return { files, urls, other };
}
