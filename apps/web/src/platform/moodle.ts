import {
  MoodleContents,
  MoodleCourses,
  MoodleDownloadEvent,
  MoodleInstitutions,
  MoodlePasteResult,
  MoodleResolve,
  MoodleStart,
  MoodleStatus,
  type MoodleDownloadRequest,
} from "@tutorai/local-api";
import { call, getJson, jsonInit, localServer, ndjson } from "./local-server.ts";

/**
 * The Moodle connection lives in TutorAI Local: the server holds the token and makes every request
 * to Moodle; this page only asks it for lists and tells it which file to import
 * (docs/rfc-moodle.md). On the website none of this is used and no request is made.
 */

/** True when this page is served by a TutorAI Local that has the Moodle connection turned on. */
export const moodleAvailable = () => !!localServer()?.features.moodle;
export const moodleTestMode = () => !!localServer()?.testMode;

export type Lang = "he" | "en";
const q = (params: Record<string, string | number | undefined>) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");

export const moodleApi = {
  institutions: () => getJson(MoodleInstitutions, "/api/moodle/institutions"),
  resolve: (institutionId: string) => getJson(MoodleResolve, "/api/moodle/resolve", jsonInit("POST", { institutionId })),
  status: () => getJson(MoodleStatus, "/api/moodle/status"),
  start: (site: string) => getJson(MoodleStart, "/api/moodle/connect/start", jsonInit("POST", { site })),
  paste: (pendingId: string, text: string) => getJson(MoodlePasteResult, "/api/moodle/connect/paste", jsonInit("POST", { pendingId, text })),
  cancel: (pendingId: string) => call("/api/moodle/connect/cancel", jsonInit("POST", { pendingId })),
  disconnect: (site: string) => call("/api/moodle/disconnect", jsonInit("POST", { site })),
  courses: async (site: string, lang: Lang) => (await getJson(MoodleCourses, `/api/moodle/courses?${q({ site, lang })}`)).courses,
  contents: (site: string, course: number, lang: Lang, fresh = false) => getJson(MoodleContents, `/api/moodle/contents?${q({ site, course, lang, fresh: fresh ? 1 : undefined })}`),
  /** Downloads one file into the data folder. Yields progress and ends with done, duplicate or error. */
  async *download(req: MoodleDownloadRequest): AsyncGenerator<MoodleDownloadEvent> {
    const r = await call("/api/moodle/download", jsonInit("POST", req));
    yield* ndjson(MoodleDownloadEvent, r);
  },
};
export type MoodleApi = typeof moodleApi;
