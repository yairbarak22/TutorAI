import { z } from "zod";

/** Why a Moodle step failed. The page turns a kind into a sentence; the server never sends sentences. */
export const MoodleErrorKind = z.enum([
  "auth",
  "unavailable",
  "policy",
  "forbidden",
  "blocked",
  "network",
  "unsupported",
  "too_large",
  "wrong_type",
  "not_listed",
  "other",
]);
export type MoodleErrorKind = z.infer<typeof MoodleErrorKind>;

/** A course as the student's Moodle lists it. */
export const RemoteCourse = z.object({
  id: z.number(),
  shortname: z.string(),
  fullname: z.string(),
  displayname: z.string(),
  startdate: z.number(),
  enddate: z.number(),
  hidden: z.boolean(),
  lastaccess: z.number().nullable(),
});
export type RemoteCourse = z.infer<typeof RemoteCourse>;

export const MAX_KEY_LENGTH = 600;

/** One importable file in a course. `key` identifies it across refreshes; its address stays on the server. */
export const RemoteFile = z.object({
  key: z.string().max(MAX_KEY_LENGTH),
  cmid: z.number(),
  modname: z.string(),
  section: z.string(),
  activity: z.string(),
  filename: z.string(),
  filepath: z.string(),
  size: z.number(),
  modified: z.number(),
});
export type RemoteFile = z.infer<typeof RemoteFile>;

/* ---------------- What Moodle answers (only the fields we read; everything else is ignored) ---------------- */

const flag = z.union([z.boolean(), z.number(), z.string()]).transform((v) => v === true || v === 1 || v === "1");

/** `tool_mobile_get_public_config`: what a site says about itself without login. Untrusted until validated. */
export const PublicConfig = z.object({
  wwwroot: z.string().max(300),
  httpswwwroot: z.string().max(300).optional(),
  sitename: z.string().optional().default(""),
  enablewebservices: flag.optional().default(false),
  enablemobilewebservice: flag.optional().default(false),
  maintenanceenabled: flag.optional().default(false),
  typeoflogin: z.coerce.number().optional().default(1),
  launchurl: z.string().max(600).optional(),
});
export type PublicConfig = z.infer<typeof PublicConfig>;

export const SiteInfo = z.object({
  userid: z.number(),
  fullname: z.string().optional().default(""),
  sitename: z.string().optional().default(""),
  release: z.string().optional().default(""),
  functions: z.array(z.object({ name: z.string() })).optional().default([]),
  downloadfiles: flag.optional().default(false),
});
export type SiteInfo = z.infer<typeof SiteInfo>;

export const RawCourse = z.object({
  id: z.number(),
  shortname: z.string().optional().default(""),
  fullname: z.string().optional().default(""),
  displayname: z.string().optional(),
  startdate: z.number().optional().default(0),
  enddate: z.number().optional().default(0),
  hidden: flag.optional().default(false),
  lastaccess: z.number().nullable().optional(),
});

const RawContent = z.object({
  type: z.string(),
  filename: z.string().optional().default(""),
  filepath: z.string().nullable().optional(),
  filesize: z.number().nullable().optional(),
  fileurl: z.string().nullable().optional(),
  timemodified: z.number().nullable().optional(),
});
const RawModule = z.object({
  id: z.number(),
  name: z.string().optional().default(""),
  modname: z.string(),
  uservisible: flag.optional().default(true),
  contents: z.array(RawContent).optional().default([]),
});
export const RawSection = z.object({
  name: z.string().optional().default(""),
  uservisible: flag.optional().default(true),
  modules: z.array(RawModule).optional().default([]),
});
export const RawContents = z.array(RawSection);
export type RawContents = z.infer<typeof RawContents>;
