import { createHash } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readJson, writePrivate } from "../config.ts";
import { paths } from "../paths.ts";

/**
 * A Moodle connection: one owner-only (0600) file per site in ~/.tutorai/moodle. The token is the
 * student's mobile web-service token. It never goes to the browser, tutorai.db, the data folder or
 * the log, and is sent only to the site it belongs to (docs/rfc-moodle.md §6.1, §11).
 */
export const Connection = z.object({
  site: z.string(),
  host: z.string(),
  siteName: z.string(),
  institutionId: z.string().optional(),
  userId: z.number(),
  fullName: z.string(),
  token: z.string().min(8),
  connectedAt: z.string(),
  release: z.string(),
  downloadFiles: z.boolean(),
  /** Set when the site said the token is no longer valid. */
  expiredAt: z.string().optional(),
});
export type Connection = z.infer<typeof Connection>;

const dir = () => paths().moodle;
const fileFor = (site: string) => join(dir(), `${createHash("sha256").update(site).digest("hex").slice(0, 16)}.json`);

export async function readConnection(site: string): Promise<Connection | null> {
  const p = Connection.safeParse(await readJson<unknown>(fileFor(site)));
  // A file for another site under this name, or a damaged file, is ignored.
  return p.success && p.data.site === site ? p.data : null;
}

export async function writeConnection(c: Connection) {
  await writePrivate(fileFor(c.site), JSON.stringify(c, null, 2));
}

export async function removeConnection(site: string) {
  await rm(fileFor(site), { force: true });
}

export async function listConnections(): Promise<Connection[]> {
  let names: string[] = [];
  try {
    names = await readdir(dir());
  } catch {
    return [];
  }
  const out: Connection[] = [];
  for (const name of names) {
    if (!/^[a-f0-9]{16}\.json$/.test(name)) continue;
    const p = Connection.safeParse(await readJson<unknown>(join(dir(), name)));
    if (p.success) out.push(p.data);
  }
  return out.sort((a, b) => a.connectedAt.localeCompare(b.connectedAt));
}

export async function removeAllConnections() {
  for (const c of await listConnections()) await removeConnection(c.site);
}
