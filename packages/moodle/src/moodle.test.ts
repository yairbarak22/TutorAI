import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  INSTITUTIONS,
  LINK_ARGUMENT,
  MAX_FILE_BYTES,
  MoodleClient,
  MoodleError,
  RawContents,
  buildLaunchUrl,
  candidateSites,
  classify,
  cleanCourseName,
  describePaste,
  errorKind,
  expectedSiteIds,
  findLaunchLink,
  flattenContents,
  fresh,
  hasNeededFunctions,
  isNew,
  isSafeLaunchUrl,
  looksLikeExam,
  parseAnswer,
  planSync,
  safeName,
  validateSite,
  type Institution,
  type KnownFile,
  type RemoteFile,
} from "./index.ts";

const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const RUNI = "https://moodle.runi.ac.il/2027";
/** Shaped like Reichman's public configuration (recorded 2026-11-27). */
const runiConfig = (over: Record<string, unknown> = {}) => ({
  wwwroot: RUNI,
  httpswwwroot: RUNI,
  sitename: "Moodle2027",
  enablewebservices: 1,
  enablemobilewebservice: 1,
  maintenanceenabled: 0,
  typeoflogin: 3,
  launchurl: `${RUNI}/admin/tool/mobile/launch.php`,
  ...over,
});

describe("institutions", () => {
  const inst = (sites: string[]): Institution => ({ id: "x", name: { he: "א", en: "A" }, sites, status: "config-checked" });
  const nov = new Date("2026-11-27T10:00:00");

  it("expands each template style for the academic years ending Y+1, Y, Y-1", () => {
    expect(candidateSites(inst(["https://moodle.runi.ac.il/{yyyy}"]), nov)).toEqual(["https://moodle.runi.ac.il/2027", "https://moodle.runi.ac.il/2026", "https://moodle.runi.ac.il/2025"]);
    expect(candidateSites(inst(["https://moodle{YY}.technion.ac.il"]), nov)).toEqual(["https://moodle26.technion.ac.il", "https://moodle25.technion.ac.il", "https://moodle24.technion.ac.il"]);
    expect(candidateSites(inst(["https://moodle.huji.ac.il/{YYYY}-{yy}"]), nov)[0]).toBe("https://moodle.huji.ac.il/2026-27");
    expect(candidateSites(inst(["https://mw{yy}.haifa.ac.il"]), nov)[0]).toBe("https://mw27.haifa.ac.il");
    expect(candidateSites(inst(["https://moodle.runi.ac.il/{yyyy}"]), new Date("2027-03-01T10:00:00"))[0]).toBe("https://moodle.runi.ac.il/2028");
  });

  it("gives one candidate for a fixed address and interleaves two templates, six at most", () => {
    expect(candidateSites(inst(["https://lemida.biu.ac.il/"]), nov)).toEqual(["https://lemida.biu.ac.il"]);
    const two = candidateSites(inst(["https://a{YY}.example.org", "https://a{yy}.example.org"]), nov);
    expect(two.slice(0, 2)).toEqual(["https://a26.example.org", "https://a27.example.org"]);
    expect(two.length).toBeLessThanOrEqual(6);
  });

  it("keeps the registry well-formed", () => {
    expect(new Set(INSTITUTIONS.map((i) => i.id)).size).toBe(INSTITUTIONS.length);
    for (const i of INSTITUTIONS) {
      expect(i.name.he && i.name.en).toBeTruthy();
      expect(i.sites.length).toBeGreaterThan(0);
      expect(i.sites.length).toBeLessThanOrEqual(2);
      for (const url of candidateSites(i, nov)) {
        const u = new URL(url);
        expect(u.protocol).toBe("https:");
        expect(u.port).toBe("");
        expect(url).not.toMatch(/[{}]/);
      }
    }
  });
});

describe("validateSite", () => {
  it("accepts a site that reports the address we probed, and builds the launch address from it", () => {
    const v = validateSite(RUNI, runiConfig())!;
    expect(v).toMatchObject({ site: RUNI, host: "moodle.runi.ac.il", siteName: "Moodle2027", launchUrl: `${RUNI}/admin/tool/mobile/launch.php`, wwwroots: [RUNI] });
    expect(classify(v)).toEqual({ login: "sso" });
    const launch = new URL(buildLaunchUrl(v.launchUrl!, "abc123"));
    expect(Object.fromEntries(launch.searchParams)).toEqual({ service: "moodle_mobile_app", passport: "abc123", urlscheme: "moodlemobile", confirmed: "1" });
  });

  it("accepts a root that is an ancestor of the probed address (a year path that falls through)", () => {
    const v = validateSite("https://moodle.tau.ac.il/2026", runiConfig({ wwwroot: "https://moodle.tau.ac.il", httpswwwroot: undefined, launchurl: "https://moodle.tau.ac.il/admin/tool/mobile/launch.php" }));
    expect(v?.site).toBe("https://moodle.tau.ac.il");
  });

  it("refuses a configuration that points anywhere else", () => {
    const bad = (over: Record<string, unknown>, candidate = RUNI) => expect(validateSite(candidate, runiConfig(over))).toBeNull();
    bad({ wwwroot: "https://evil.example/2027" });
    bad({ wwwroot: "http://moodle.runi.ac.il/2027" });
    bad({ wwwroot: "https://moodle.runi.ac.il:8443/2027" });
    bad({ wwwroot: "https://moodle.runi.ac.il/2027/deeper" });
    bad({ wwwroot: "https://moodle.runi.ac.il/20" }); // not on a segment boundary
    bad({ launchurl: "javascript:alert(1)" });
    bad({ launchurl: "http://moodle.runi.ac.il/2027/admin/tool/mobile/launch.php" });
    bad({ launchurl: "https://evil.example/2027/admin/tool/mobile/launch.php" });
    bad({ launchurl: "https://moodle.runi.ac.il:444/2027/admin/tool/mobile/launch.php" });
    bad({ launchurl: "https://user@moodle.runi.ac.il/2027/admin/tool/mobile/launch.php" });
    bad({ launchurl: `${RUNI}/admin/tool/mobile/launch.php?x=1` });
    bad({ launchurl: `${RUNI}/admin/tool/mobile/launch.php#x` });
    bad({ launchurl: "https://moodle.runi.ac.il/2026/admin/tool/mobile/launch.php" }); // outside this year's root
    bad({ launchurl: `${RUNI}/admin/tool/mobile/evil.php` });
    expect(validateSite(RUNI, "<html>")).toBeNull();
    expect(validateSite("http://127.0.0.1:4401", runiConfig({ wwwroot: "http://127.0.0.1:4401" }))).toBeNull();
  });

  it("allows the loopback mock only in test mode, and cuts a long site name", () => {
    const local = "http://127.0.0.1:4401";
    const v = validateSite(local, runiConfig({ wwwroot: local, httpswwwroot: local, launchurl: `${local}/admin/tool/mobile/launch.php`, sitename: "x".repeat(300) }), { allowLocal: true })!;
    expect(v.site).toBe(local);
    expect(v.siteName).toHaveLength(80);
  });

  it("classifies what the site offers", () => {
    const c = (over: Record<string, unknown>) => classify(validateSite(RUNI, runiConfig(over))!);
    expect(c({ enablemobilewebservice: 0 })).toEqual({ login: "unavailable", reason: "mobile_off" });
    expect(c({ enablewebservices: 0 })).toEqual({ login: "unavailable", reason: "mobile_off" });
    expect(c({ maintenanceenabled: 1 })).toEqual({ login: "unavailable", reason: "maintenance" });
    expect(c({ typeoflogin: 1 })).toEqual({ login: "unavailable", reason: "password_only" });
    expect(c({ typeoflogin: 2 })).toEqual({ login: "sso" });
    expect(c({ launchurl: undefined })).toEqual({ login: "unavailable", reason: "password_only" });
  });

  it("opens only https launch addresses (loopback http in test mode)", () => {
    expect(isSafeLaunchUrl(`${RUNI}/admin/tool/mobile/launch.php?service=x`)).toBe(true);
    for (const u of ["javascript:alert(1)", "http://moodle.runi.ac.il/x", "https://a:b@moodle.runi.ac.il/x", "https://moodle.runi.ac.il:444/x", "data:text/html,x", "nope"]) expect(isSafeLaunchUrl(u)).toBe(false);
    expect(isSafeLaunchUrl("http://127.0.0.1:4401/admin/tool/mobile/launch.php")).toBe(false);
    expect(isSafeLaunchUrl("http://127.0.0.1:4401/admin/tool/mobile/launch.php", true)).toBe(true);
    expect(isSafeLaunchUrl("http://10.0.0.1/x", true)).toBe(false);
  });
});

describe("launch link", () => {
  const passport = "f00dfeed";
  const token = "a".repeat(32);
  const payload = (extra = "") => Buffer.from(`${md5(RUNI + passport)}:::${token}${extra}`).toString("base64");

  it("finds the link plain, percent-encoded, inside other text, and with a private token", () => {
    const want = { scheme: "moodlemobile", siteId: md5(RUNI + passport), token };
    expect(findLaunchLink(`moodlemobile://token=${payload()}`)).toEqual(want);
    expect(findLaunchLink(encodeURIComponent(`moodlemobile://token=${payload()}`))).toEqual(want);
    expect(findLaunchLink(`click here moodlemobile://token=${payload()}/ thanks`)).toEqual(want);
    expect(findLaunchLink(`moodlemobile://token=${payload(`:::${"p".repeat(64)}`)}#`)).toEqual(want);
    expect(findLaunchLink(`web+tutorai://token=${payload()}`)?.scheme).toBe("web+tutorai");
  });

  it("rejects everything else", () => {
    for (const t of ["", "hello", `${RUNI}/admin/tool/mobile/launch.php?passport=1`, "moodlemobile://token=!!!", `moodlemobile://token=${Buffer.from("nothex:::tok").toString("base64")}`, `moodlemobile://token=${Buffer.from(md5("x")).toString("base64")}`])
      expect(findLaunchLink(t)).toBeNull();
  });

  it("checks the site-and-passport hash", () => {
    const link = findLaunchLink(`moodlemobile://token=${payload()}`)!;
    expect(expectedSiteIds([RUNI], passport, md5)).toContain(link.siteId);
    expect(expectedSiteIds([RUNI], "another-passport", md5)).not.toContain(link.siteId);
    expect(expectedSiteIds(["https://evil.example"], passport, md5)).not.toContain(link.siteId);
  });

  it("accepts exactly one well-formed link as the command argument", () => {
    expect(LINK_ARGUMENT.test(`moodlemobile://token=${payload()}`)).toBe(true);
    expect(LINK_ARGUMENT.test(`moodlemobile://token=${payload().replace(/=/g, "%3D")}/`)).toBe(true);
    for (const bad of [`web+tutorai://token=${payload()}`, `moodlemobile://token=${payload()} --config /tmp`, `moodlemobile://token=a"b`, "moodlemobile://token=", `x moodlemobile://token=${payload()}`]) expect(LINK_ARGUMENT.test(bad)).toBe(false);
  });

  it("describes a wrong paste by a code only", () => {
    expect(describePaste(`${RUNI}/admin/tool/mobile/launch.php?service=x&passport=secret`, RUNI)).toBe("page_address");
    expect(describePaste("https://auth.runi.ac.il/saml/sso?SAMLRequest=abc", RUNI)).toBe("signin_address");
    expect(describePaste(`${RUNI}/my/`, RUNI)).toBe("other_moodle_page");
    expect(describePaste("just some text", RUNI)).toBe("not_a_link");
    expect(describePaste("moodlemobile://nothing", RUNI)).toBe("not_a_link");
  });
});

describe("client", () => {
  const answer = (body: unknown, status = 200, contentType = "application/json") => ({ status, contentType, text: typeof body === "string" ? body : JSON.stringify(body) });

  it("maps Moodle's errors, in both shapes, to kinds", () => {
    const kindOf = (body: unknown, status = 200) => {
      try {
        parseAnswer(answer(body, status));
        return "ok";
      } catch (e) {
        return (e as MoodleError).kind;
      }
    };
    expect(kindOf({ exception: "moodle_exception", errorcode: "invalidtoken", message: "Invalid token" })).toBe("auth");
    expect(kindOf({ exception: "webservice_access_exception", errorcode: "accessexception", message: "Invalid token - token expired" })).toBe("auth");
    expect(kindOf({ exception: "x", errorcode: "accessexception", message: "Access control exception" })).toBe("forbidden");
    expect(kindOf({ error: "Invalid token", errorcode: "invalidtoken" })).toBe("auth"); // pluginfile.php / token.php shape
    expect(kindOf({ exception: "x", errorcode: "sitepolicynotagreed" })).toBe("policy");
    expect(kindOf({ exception: "x", errorcode: "sitemaintenance" })).toBe("unavailable");
    expect(kindOf({ exception: "x", errorcode: "nopermissions" })).toBe("forbidden");
    expect(kindOf({ exception: "x", errorcode: "somethingnew" })).toBe("other");
    expect(kindOf("<!doctype html><html>challenge</html>")).toBe("blocked");
    expect(kindOf("not json")).toBe("unsupported");
    expect(kindOf("gateway", 502)).toBe("unavailable");
    expect(kindOf([{ id: 1 }])).toBe("ok");
    expect(errorKind("usernotfullysetup")).toBe("policy");
  });

  it("sends the token in the body with the language settings, and reads lenient answers", async () => {
    const sent: { url: string; body: URLSearchParams }[] = [];
    const client = new MoodleClient({
      site: RUNI,
      token: "tok",
      lang: "he",
      fetch: async (url, init) => {
        const body = new URLSearchParams(init.body);
        sent.push({ url, body });
        const fn = body.get("wsfunction");
        if (fn === "core_webservice_get_site_info") return answer({ userid: 7, fullname: "S", sitename: "M", release: "4.5", functions: [{ name: "core_webservice_get_site_info", version: "x" }], downloadfiles: 1, extra: true });
        if (fn === "core_enrol_get_users_courses") return answer([{ id: 3, shortname: "CN", fullname: "Computer Networks", extraField: 1 }]);
        return answer([{ name: "Week 1", modules: [{ id: 9, modname: "resource", name: "Slides", contents: [{ type: "file", filename: "a.pdf", filesize: 10, fileurl: `${RUNI}/webservice/pluginfile.php/1/mod_resource/content/2/a.pdf`, timemodified: 5 }] }] }]);
      },
    });
    const info = await client.siteInfo();
    expect(info.userid).toBe(7);
    expect(hasNeededFunctions(info)).toBe(false);
    expect(await client.courses(7)).toEqual([{ id: 3, shortname: "CN", fullname: "Computer Networks", displayname: "Computer Networks", startdate: 0, enddate: 0, hidden: false, lastaccess: null }]);
    expect((await client.contents(3))[0].modules[0].contents[0].filename).toBe("a.pdf");
    expect(sent[0].url).toBe(`${RUNI}/webservice/rest/server.php`);
    expect(sent[0].url).not.toContain("tok");
    expect(Object.fromEntries(sent[1].body)).toMatchObject({ wstoken: "tok", moodlewsrestformat: "json", moodlewssettingfilter: "true", moodlewssettinglang: "he", userid: "7", returnusercount: "0" });
    expect(sent[2].body.get("courseid")).toBe("3");
  });

  it("reports an unexpected shape as unsupported", async () => {
    const client = new MoodleClient({ site: RUNI, token: "t", lang: "en", fetch: async () => answer({ nope: true }) });
    await expect(client.siteInfo()).rejects.toMatchObject({ kind: "unsupported" });
  });
});

describe("flattenContents", () => {
  const file = (name: string, over: Record<string, unknown> = {}) => ({ type: "file", filename: name, filepath: "/", filesize: 1000, fileurl: `${RUNI}/webservice/pluginfile.php/55/mod_folder/content/3/${name}`, timemodified: 100, ...over });
  /** Shaped like a Reichman course: folders, resources, H5P, external tools, pages. */
  const sections = [
    {
      name: "שבוע 1",
      modules: [
        { id: 10, modname: "resource", name: "מצגת 1", contents: [file("lecture1.pdf")] },
        { id: 11, modname: "folder", name: "תרגולים", contents: [file("t1.pdf", { filepath: "/week1/" }), file("t1.pdf", { filepath: "/week2/" }), file("data.zip")] },
        { id: 12, modname: "hvp", name: "Video" },
        { id: 13, modname: "lti", name: "Zoom" },
        { id: 14, modname: "lti", name: "Recordings" },
        { id: 15, modname: "page", name: "Syllabus", contents: [file("index.html")] },
        { id: 16, modname: "url", name: "Link", contents: [{ type: "url", filename: "x", fileurl: "https://example.org" }] },
        { id: 17, modname: "resource", name: "Hidden", uservisible: false, contents: [file("hidden.pdf")] },
        { id: 18, modname: "resource", name: "Elsewhere", contents: [file("ext.pdf", { fileurl: "https://cdn.example.org/ext.pdf" }), file("http.pdf", { fileurl: "http://moodle.runi.ac.il/2027/webservice/pluginfile.php/1/a/http.pdf" }), file("other-year.pdf", { fileurl: "https://moodle.runi.ac.il/2026/webservice/pluginfile.php/1/a/b.pdf" }), file("plain.pdf", { fileurl: `${RUNI}/pluginfile.php/1/a/plain.pdf` })] },
        { id: 19, modname: "resource", name: "Long", contents: [file("long.pdf", { filepath: `/${"d".repeat(700)}/` })] },
      ],
    },
    { name: "Hidden week", uservisible: false, modules: [{ id: 30, modname: "resource", name: "x", contents: [file("nope.pdf")] }] },
  ];

  it("lists the site's own files, counts the rest, and keeps addresses apart", () => {
    const flat = flattenContents(RawContents.parse(sections), RUNI);
    expect(flat.files.map((f) => f.key)).toEqual(["10:/lecture1.pdf", "11:/week1/t1.pdf", "11:/week2/t1.pdf", "11:/data.zip"]);
    expect(flat.files[0]).toEqual({ key: "10:/lecture1.pdf", cmid: 10, modname: "resource", section: "שבוע 1", activity: "מצגת 1", filename: "lecture1.pdf", filepath: "/", size: 1000, modified: 100 });
    expect(flat.other).toEqual({ textPages: 1, links: 1, external: 4, notImportable: { hvp: 1, lti: 2, resource: 1 } });
    expect(flat.urls.get("10:/lecture1.pdf")).toContain("/webservice/pluginfile.php/");
    expect(JSON.stringify(flat.files)).not.toContain("pluginfile");
  });

  it("gives the same key when only the revision inside the address changes", () => {
    const a = flattenContents(RawContents.parse([{ name: "s", modules: [{ id: 1, modname: "resource", name: "n", contents: [file("a.pdf")] }] }]), RUNI);
    const b = flattenContents(RawContents.parse([{ name: "s", modules: [{ id: 1, modname: "resource", name: "n", contents: [file("a.pdf", { fileurl: `${RUNI}/webservice/pluginfile.php/55/mod_folder/content/9/a.pdf` })] }] }]), RUNI);
    expect(a.files[0].key).toBe(b.files[0].key);
  });
});

describe("planSync", () => {
  const remote = (key: string, over: Partial<RemoteFile> = {}): RemoteFile => ({ key, cmid: 1, modname: "resource", section: "s", activity: "a", filename: key.split("/").pop()!, filepath: "/", size: 100, modified: 10, ...over });
  let nextId = 1;
  const known = (key: string, state: KnownFile["state"], over: Partial<KnownFile> = {}): KnownFile => ({ id: nextId++, remote_key: key, size: 100, remote_modified: 10, state, present: true, changed: false, source_id: state === "imported" ? 5 : null, ...over });

  it("gives a first-sight state by type and size", () => {
    expect(fresh({ filename: "a.PDF", size: 1 })).toBe("new");
    expect(fresh({ filename: "notes.markdown", size: 1 })).toBe("new");
    expect(fresh({ filename: "a.zip", size: 1 })).toBe("unsupported");
    expect(fresh({ filename: "noextension", size: 1 })).toBe("unsupported");
    expect(fresh({ filename: "a.pdf", size: MAX_FILE_BYTES + 1 })).toBe("too_large");
    const plan = planSync([remote("1:/a.pdf"), remote("1:/b.zip")], []);
    expect(plan.inserts.map((i) => [i.remote_key, i.state])).toEqual([["1:/a.pdf", "new"], ["1:/b.zip", "unsupported"]]);
    expect(plan.updates).toEqual([]);
  });

  it("leaves unchanged rows alone", () => {
    const rows = [known("1:/a.pdf", "new"), known("1:/b.pdf", "imported"), known("1:/c.pdf", "skipped"), known("1:/d.pdf", "failed")];
    expect(planSync(rows.map((r) => remote(r.remote_key)), rows)).toEqual({ inserts: [], updates: [] });
  });

  it("marks rows Moodle no longer lists, and brings them back", () => {
    const gone = known("1:/a.pdf", "imported");
    expect(planSync([], [gone]).updates).toEqual([{ id: gone.id, present: false }]);
    const back = known("1:/a.pdf", "imported", { present: false });
    expect(planSync([remote("1:/a.pdf")], [back]).updates).toEqual([{ id: back.id, present: true }]);
  });

  it("handles a changed file by its state", () => {
    const changed = (state: KnownFile["state"], over: Partial<KnownFile> = {}) => {
      const row = known("1:/a.pdf", state, over);
      return planSync([remote("1:/a.pdf", { size: 200, modified: 20 })], [row]).updates[0];
    };
    expect(changed("imported")).toMatchObject({ size: 200, remote_modified: 20, changed: true });
    expect(changed("imported").state).toBeUndefined();
    expect(changed("skipped")).toMatchObject({ state: "new" });
    expect(changed("failed")).toMatchObject({ state: "new" });
    expect(changed("too_large")).toMatchObject({ state: "new" });
    expect(changed("imported", { source_id: null })).toMatchObject({ state: "new" });
    const grew = known("1:/a.pdf", "new");
    expect(planSync([remote("1:/a.pdf", { size: MAX_FILE_BYTES + 1 })], [grew]).updates[0]).toMatchObject({ state: "too_large" });
  });

  it("stops offering a file whose imported source the student deleted", () => {
    const row = known("1:/a.pdf", "imported", { source_id: null });
    expect(planSync([remote("1:/a.pdf")], [row]).updates).toEqual([{ id: row.id, state: "skipped" }]);
    const goneToo = known("1:/b.pdf", "imported", { source_id: null });
    expect(planSync([], [goneToo]).updates).toEqual([{ id: goneToo.id, present: false, state: "skipped" }]);
  });

  it("counts what is new for the notice", () => {
    expect(isNew({ state: "new", present: true, changed: false })).toBe(true);
    expect(isNew({ state: "imported", present: true, changed: true })).toBe(true);
    expect(isNew({ state: "imported", present: true, changed: false })).toBe(false);
    expect(isNew({ state: "new", present: false, changed: false })).toBe(false);
    expect(isNew({ state: "failed", present: true, changed: false })).toBe(false);
  });
});

describe("names", () => {
  it("cleans names and spots exams", () => {
    expect(safeName('a/b:c*?"<>|.pdf')).toBe("a_b_c______.pdf");
    expect(cleanCourseName("  Computer   Networks \n")).toBe("Computer Networks");
    expect(cleanCourseName("   ")).toBe("Moodle");
    expect(looksLikeExam("lecture1.pdf", "שבוע 1", "מבחנים משנים קודמות")).toBe(true);
    expect(looksLikeExam("Exam 2024 moed A.pdf")).toBe(true);
    expect(looksLikeExam("lecture1.pdf", "Slides")).toBe(false);
  });
});
