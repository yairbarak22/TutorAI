import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";

/**
 * A stand-in for an institution's Moodle, shaped like the real answers (Moodle 4.5): the public
 * configuration, the launch page, the REST endpoint for the three calls TutorAI uses, and the
 * token file endpoint. Tests point TutorAI at it with TUTORAI_TEST=1, TUTORAI_MOODLE_ALLOW_LOCAL=1
 * and TUTORAI_MOODLE_TEST_SITES. Nothing here is real course material.
 */
export interface MockFile {
  filename: string;
  filepath?: string;
  body: Buffer;
  modified?: number;
  /** Override the address Moodle reports for this file. */
  fileurl?: string;
  /** Claim this size and keep sending (for the size limit). */
  endless?: boolean;
  /** Send the first bytes and then nothing more (for interrupted downloads). */
  slow?: boolean;
}
export interface MockModule {
  id: number;
  modname: string;
  name: string;
  uservisible?: boolean;
  files?: MockFile[];
}
export interface MockCourse {
  id: number;
  shortname: string;
  fullname: string;
  sections: { name: string; modules: MockModule[] }[];
}

export type MockFault = "none" | "expired" | "maintenance" | "policy" | "challenge" | "429" | "redirectAway" | "fileJsonError" | "hugeFileError" | "nofunctions";

export interface MockMoodle {
  base: string;
  port: number;
  token: string;
  fullName: string;
  /** Replaces the public configuration (object), or serves this text instead of JSON (string). */
  config: Record<string, unknown> | string | null;
  fault: MockFault;
  courses: MockCourse[];
  requests: { method: string; path: string; query: string; body: string; userAgent: string }[];
  /** The link the launch page hands back for this passport. */
  launchLink(passport: string, opts?: { token?: string; scheme?: string }): string;
  close(): Promise<void>;
}

const md5 = (s: string) => createHash("md5").update(s).digest("hex");
export const FAKE_PDF = (label: string) => Buffer.from(`%PDF-1.4\n% ${label}\n`);

export const defaultCourses = (): MockCourse[] => [
  {
    id: 101,
    shortname: "CN-2027",
    fullname: "רשתות תקשורת מחשבים",
    sections: [
      {
        name: "שבוע 1",
        modules: [
          { id: 11, modname: "resource", name: "מצגת 1", files: [{ filename: "lecture1.pdf", body: FAKE_PDF("lecture 1"), modified: 1000 }] },
          {
            id: 12,
            modname: "folder",
            name: "תרגולים",
            files: [
              { filename: "tirgul1.pdf", filepath: "/week1/", body: FAKE_PDF("tirgul 1"), modified: 1000 },
              { filename: "data.zip", body: Buffer.from("PK\u0003\u0004zip"), modified: 1000 },
            ],
          },
          { id: 13, modname: "lti", name: "הקלטות" },
          { id: 14, modname: "page", name: "סילבוס" },
        ],
      },
    ],
  },
  { id: 102, shortname: "CT-2027", fullname: "תורת הסיבוכיות", sections: [{ name: "כללי", modules: [{ id: 21, modname: "forum", name: "הודעות" }] }] },
];

export async function startMockMoodle(port = 0, courses: () => MockCourse[] = defaultCourses): Promise<MockMoodle> {
  const initialCourses = courses;
  const mock: MockMoodle = {
    base: "",
    port: 0,
    token: "0123456789abcdef0123456789abcdef",
    fullName: "סטודנט לדוגמה",
    config: null,
    fault: "none",
    courses: courses(),
    requests: [],
    launchLink(passport, o = {}) {
      const payload = Buffer.from(`${md5(mock.base + passport)}:::${o.token ?? mock.token}`).toString("base64");
      return `${o.scheme ?? "moodlemobile"}://token=${payload}`;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
  let rateLimited = 0;

  const fileUrl = (courseId: number, mod: MockModule, f: MockFile) => f.fileurl ?? `${mock.base}/webservice/pluginfile.php/${courseId}/mod_${mod.modname}/content/${mod.id}${f.filepath ?? "/"}${encodeURIComponent(f.filename)}?forcedownload=1`;

  const publicConfig = () => ({
    wwwroot: mock.base,
    httpswwwroot: mock.base,
    sitename: "Mock Moodle",
    enablewebservices: 1,
    enablemobilewebservice: 1,
    maintenanceenabled: 0,
    typeoflogin: 3,
    launchurl: `${mock.base}/admin/tool/mobile/launch.php`,
    ...(typeof mock.config === "object" && mock.config ? mock.config : {}),
  });

  const rest = (params: URLSearchParams): unknown => {
    if (mock.fault === "maintenance") return { exception: "moodle_exception", errorcode: "sitemaintenance", message: "maintenance" };
    if (params.get("wstoken") !== mock.token) return { exception: "moodle_exception", errorcode: "invalidtoken", message: "Invalid token - token not found" };
    if (mock.fault === "expired") return { exception: "webservice_access_exception", errorcode: "accessexception", message: "Invalid token - token expired - check validuntil time for the token" };
    if (mock.fault === "policy") return { exception: "moodle_exception", errorcode: "sitepolicynotagreed", message: "policy" };
    const fn = params.get("wsfunction");
    if (fn === "core_webservice_get_site_info")
      return {
        sitename: "Mock Moodle",
        fullname: mock.fullName,
        userid: 7,
        release: "4.5.16 (Build: 20261112)",
        downloadfiles: 1,
        functions: (mock.fault === "nofunctions" ? ["core_webservice_get_site_info"] : ["core_webservice_get_site_info", "core_enrol_get_users_courses", "core_course_get_contents"]).map((name) => ({ name, version: "2024100700" })),
      };
    if (fn === "core_enrol_get_users_courses") {
      if (params.get("userid") !== "7") return [];
      return mock.courses.map((c) => ({ id: c.id, shortname: c.shortname, fullname: c.fullname, displayname: c.fullname, startdate: 1790000000, enddate: 0, hidden: false, lastaccess: 1795000000, visible: 1 }));
    }
    if (fn === "core_course_get_contents") {
      const course = mock.courses.find((c) => String(c.id) === params.get("courseid"));
      if (!course) return { exception: "moodle_exception", errorcode: "invalidrecord", message: "no course" };
      return course.sections.map((s, i) => ({
        id: i + 1,
        name: s.name,
        uservisible: true,
        modules: s.modules.map((m) => ({
          id: m.id,
          name: m.name,
          modname: m.modname,
          uservisible: m.uservisible ?? true,
          contents: (m.files ?? []).map((f) => ({ type: "file", filename: f.filename, filepath: f.filepath ?? "/", filesize: f.endless ? 70 * 1024 * 1024 : f.body.length, fileurl: fileUrl(course.id, m, f), timemodified: f.modified ?? 1, mimetype: "application/pdf" })),
        })),
      }));
    }
    return { exception: "moodle_exception", errorcode: "invalidrecord", message: `unknown function ${fn}` };
  };

  const findFile = (path: string): MockFile | undefined => {
    for (const c of mock.courses) for (const s of c.sections) for (const m of s.modules) for (const f of m.files ?? []) if (new URL(fileUrl(c.id, m, f), mock.base).pathname === path) return f;
    return undefined;
  };

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", mock.base);
      const body = Buffer.concat(chunks).toString("utf8");
      mock.requests.push({ method: req.method ?? "", path: url.pathname, query: url.search, body, userAgent: String(req.headers["user-agent"] ?? "") });
      const json = (data: unknown, status = 200) => {
        res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
        res.end(JSON.stringify(data));
      };
      const html = (text: string, status = 200) => {
        res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
        res.end(text);
      };

      if (url.pathname === "/__mock" && req.method === "POST") {
        // The E2E drives the mock from another process.
        const cmd = JSON.parse(body || "{}") as { reset?: boolean; fault?: MockFault; config?: MockMoodle["config"]; addFile?: { moduleId: number; filename: string; base64: string; modified?: number } };
        if (cmd.reset) {
          mock.fault = "none";
          mock.config = null;
          mock.courses = initialCourses();
        }
        if (cmd.fault) mock.fault = cmd.fault;
        if (cmd.config !== undefined) mock.config = cmd.config;
        if (cmd.addFile) {
          const target = mock.courses.flatMap((c) => c.sections.flatMap((s) => s.modules)).find((m) => m.id === cmd.addFile!.moduleId);
          target?.files?.push({ filename: cmd.addFile.filename, body: Buffer.from(cmd.addFile.base64, "base64"), modified: cmd.addFile.modified ?? 2000 });
        }
        return json({ ok: true });
      }
      if (mock.fault === "429" && url.pathname !== "/lib/ajax/service-nologin.php") {
        rateLimited++;
        res.writeHead(429);
        return res.end();
      }
      // A year path that falls through to the root site (as at one real institution): same answer, root wwwroot.
      if (url.pathname === "/lib/ajax/service-nologin.php" || url.pathname === "/2027/lib/ajax/service-nologin.php") {
        if (typeof mock.config === "string") return html(mock.config);
        return json([{ error: false, data: publicConfig() }]);
      }
      if (url.pathname === "/admin/tool/mobile/launch.php") {
        // Like launch.php?confirmed=1 after sign-in: a page with the link, clicked by script.
        const link = mock.launchLink(url.searchParams.get("passport") ?? "");
        return html(`<!doctype html><html lang="he" dir="rtl"><title>Mock Moodle</title><body><div class="box"><a id="launchapp" href="${link}">לחצו כאן להפעלת האפליקציה</a></div><script>window.name="opener:"+(window.opener===null?"none":"present")</script></body></html>`);
      }
      if (url.pathname === "/webservice/rest/server.php") {
        if (req.method !== "POST" || url.search) return json({ exception: "x", errorcode: "invalidparameter", message: "POST only" });
        if (mock.fault === "challenge") return html("<!doctype html><html><body>Checking your browser…</body></html>");
        return json(rest(new URLSearchParams(body)));
      }
      if (url.pathname.startsWith("/webservice/pluginfile.php/")) {
        if (url.searchParams.get("token") !== mock.token || mock.fault === "fileJsonError" || mock.fault === "expired") return json({ error: "Invalid token - token not found", errorcode: "invalidtoken" });
        if (mock.fault === "hugeFileError") {
          // An "error answer" that never ends: must be cut off, not buffered.
          res.writeHead(200, { "content-type": "application/json" });
          const chunk = Buffer.alloc(64 * 1024, 0x20);
          const pump = () => {
            while (!res.destroyed && res.write(chunk));
            if (!res.destroyed) res.once("drain", pump);
          };
          return pump();
        }
        if (mock.fault === "redirectAway") {
          res.writeHead(302, { location: "https://storage.example.org/file.pdf" });
          return res.end();
        }
        if (mock.fault === "challenge") return html("<!doctype html><html><body>Checking your browser…</body></html>");
        const file = findFile(url.pathname);
        if (!file) return json({ error: "File not found", errorcode: "filenotfound" }, 404);
        if (file.slow) {
          res.writeHead(200, { "content-type": "application/pdf" });
          return void res.write(file.body);
        }
        if (file.endless) {
          res.writeHead(200, { "content-type": "application/pdf", "content-length": String(70 * 1024 * 1024) });
          const chunk = Buffer.alloc(64 * 1024, 0x20);
          const pump = () => {
            while (!res.destroyed && res.write(chunk));
            if (!res.destroyed) res.once("drain", pump);
          };
          return pump();
        }
        res.writeHead(200, { "content-type": "application/pdf", "content-length": String(file.body.length) });
        return res.end(file.body);
      }
      res.writeHead(404, { "content-type": "text/html" });
      res.end("<html>not found</html>");
    });
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  mock.port = (server.address() as { port: number }).port;
  mock.base = `http://127.0.0.1:${mock.port}`;
  void rateLimited;
  return mock;
}
