import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, GraduationCap } from "lucide-react";
import type { MoodleCandidate, MoodleConnection, MoodleInstitutions, MoodleStart, MoodleStatus } from "@tutorai/local-api";
import { isSafeLaunchUrl, type RemoteCourse } from "@tutorai/moodle";
import { useEngine } from "../engine.ts";
import { fmtDate, getLanguage, t } from "../i18n.tsx";
import { errorKindOf, linkNewCourse } from "../moodle/sync.ts";
import { localServer } from "../platform/local-server.ts";
import { moodleApi, moodleAvailable, moodleTestMode } from "../platform/moodle.ts";
import { go, href } from "../router.ts";
import { Alert, Badge, Button, Field, Modal, Row, Spinner, inputClass } from "./components.tsx";
import { InstallLocal } from "./InstallLocal.tsx";
import { Select } from "./Select.tsx";

/**
 * Connecting to Moodle (docs/rfc-moodle.md §10): pick the institution, sign in on its own page,
 * come back connected. The token never reaches this page; it stays with TutorAI on this computer.
 */

const lang = () => (getLanguage() === "en" ? "en" : "he");

/** A failure kind from the server, in words. */
export function moodleProblem(kind: string | undefined, about: "file" | "signin" = "file"): string {
  if (kind === "not_listed" && about === "signin") return t("ההתחברות הזו כבר לא בתוקף. נסו שוב.", "That sign-in is no longer valid. Try again.");
  switch (kind) {
    case "auth":
      return t("החיבור ל-Moodle הסתיים. מוסדות מגבילים אותו לכ-12 שבועות, וייתכן שהוא התחיל לפני שהתחברתם כאן. התחברו שוב.", "Your Moodle connection ended. Institutions limit it to about 12 weeks, and it may have started before you connected here. Sign in again.");
    case "unavailable":
      return t("ה-Moodle של המוסד לא זמין כרגע. נסו שוב מאוחר יותר; אפשר גם להעלות קבצים ידנית.", "Your institution's Moodle isn't available right now. Try again later; you can also upload files by hand.");
    case "policy":
      return t("Moodle צריך מכם משהו קודם (למשל אישור תקנון). היכנסו ל-Moodle, השלימו את הנדרש ונסו שוב.", "Moodle needs something from you first (for example agreeing to a policy). Open Moodle, finish it and try again.");
    case "forbidden":
      return t("ל-Moodle אין הרשאה לתת את זה לחשבון שלכם.", "Moodle doesn't let your account have this.");
    case "blocked":
      return t("האתר של המוסד מגביל כרגע הורדות אוטומטיות. נסו שוב מאוחר יותר.", "Your institution's site is limiting automatic downloads right now. Try again later.");
    case "network":
      return t("לא הצלחנו להגיע ל-Moodle. בדקו את החיבור לאינטרנט ונסו שוב.", "We couldn't reach Moodle. Check your internet connection and try again.");
    case "unsupported":
      return t("גרסת ה-Moodle הזו עדיין לא נתמכת.", "This Moodle version isn't supported yet.");
    case "too_large":
      return t("הקובץ גדול מדי (מעל 60MB).", "The file is too large (over 60MB).");
    case "wrong_type":
      return t("התוכן שהתקבל אינו הקובץ שציפינו לו.", "What came back isn't the file we expected.");
    case "not_listed":
      return t("הקובץ כבר לא מופיע ב-Moodle. בדקו שוב את הרשימה.", "This file is no longer listed in Moodle. Check the list again.");
    case "save":
      return t("לא הצלחנו לשמור את הנתונים, אז עצרנו את הייבוא. בדקו את תיקיית הנתונים ונסו שוב.", "We couldn't save your data, so the import stopped. Check your data folder and try again.");
    default:
      return t("משהו השתבש מול Moodle. נסו שוב.", "Something went wrong with Moodle. Try again.");
  }
}

const reasonText = (c: MoodleCandidate): string => {
  switch (c.reason) {
    case "mobile_off":
      return t(
        "ה-Moodle של המוסד הזה לא מאפשר חיבור של אפליקציות, ולכן אי אפשר לחבר אותו. אפשר להעלות קבצים ידנית, ואפשר לבקש ממחלקת המחשוב להפעיל את \"שירות המובייל\" של Moodle.",
        "This institution's Moodle doesn't allow apps to connect, so it can't be connected. You can upload files by hand, and you can ask your IT department to turn on Moodle's \"mobile service\".",
      );
    case "maintenance":
      return t("האתר בתחזוקה כרגע. נסו שוב מאוחר יותר.", "The site is under maintenance. Try again later.");
    case "disabled":
      return t("החיבור למוסד הזה כבוי כרגע.", "Connecting to this institution is turned off for now.");
    default:
      return t("המוסד הזה מתחבר בשם משתמש וסיסמה בתוך האפליקציה, וזה עדיין לא נתמך.", "This institution signs in with a username and password inside the app, which isn't supported yet.");
  }
};

const resolveProblem = (problem: string | undefined): string => {
  switch (problem) {
    case "offline":
      return t("לא הצלחנו להגיע לאתר ה-Moodle. בדקו את החיבור לאינטרנט.", "We couldn't reach the Moodle site. Check your internet connection.");
    case "timeout":
      return t("אתר ה-Moodle לא ענה בזמן. נסו שוב.", "The Moodle site didn't answer in time. Try again.");
    case "not_moodle":
      return t("הכתובת ענתה, אבל לא כאתר Moodle.", "The address answered, but not as a Moodle site.");
    default:
      return t("האתר החזיר פרטים שלא תואמים את הכתובת שלו, ולכן לא התחברנו אליו.", "The site returned details that don't match its address, so we didn't connect to it.");
  }
};

const hintText = (hint: string | undefined, kind: string): string => {
  if (kind === "expired") return t("ההתחברות הזו הסתיימה. התחילו שוב.", "That sign-in ended. Start again.");
  if (kind === "wrong_site") return t("הקישור הזה שייך להתחברות אחרת. העתיקו את הקישור מהדף שנפתח עכשיו.", "This link belongs to another sign-in. Copy the link from the page that just opened.");
  switch (hint) {
    case "page_address":
      return t("זו כתובת הדף עצמו. צריך את הקישור שבתוך הדף: לחיצה ימנית עליו ו\"העתק כתובת קישור\".", "That's the address of the page itself. We need the link inside the page: right-click it and choose \"Copy Link Address\".");
    case "signin_address":
      return t("זו כתובת של דף ההתחברות, כלומר ההתחברות עוד לא הסתיימה.", "That's the sign-in page's address, so the sign-in hasn't finished yet.");
    case "other_moodle_page":
      return t("זה דף אחר ב-Moodle. לחצו שוב על \"התחברות ל-Moodle\" למעלה.", "That's another Moodle page. Press \"Sign in to Moodle\" above again.");
    default:
      return t("זה לא הקישור. הוא מתחיל ב-moodlemobile://", "That's not the link. It starts with moodlemobile://");
  }
};

/** The connections TutorAI on this computer holds (never the tokens). */
export function useMoodleStatus(active = true) {
  const [status, setStatus] = useState<MoodleStatus | null>(null);
  const reload = useCallback(async () => {
    if (!moodleAvailable()) return null;
    const s = await moodleApi.status().catch(() => null);
    if (s) setStatus(s);
    return s;
  }, []);
  useEffect(() => {
    if (active) void reload();
  }, [active, reload]);
  return { status, reload };
}

/** A working connection: the given site's, or else the one made most recently. */
export const liveConnection = (status: MoodleStatus | null, site?: string): MoodleConnection | undefined =>
  [...(status?.connections ?? [])].sort((a, b) => b.connectedAt.localeCompare(a.connectedAt)).find((c) => !c.expired && (!site || c.site === site));

const HELP_AFTER_MS = 8000;

/** `onConnected` is called from the last step; the parent closes the dialog. */
export function MoodleConnect({ open, onClose, onConnected, institutionId }: { open: boolean; onClose: () => void; onConnected: (site: string) => void; institutionId?: string }) {
  const [institutions, setInstitutions] = useState<MoodleInstitutions["institutions"]>([]);
  const [chosen, setChosen] = useState("");
  const [choices, setChoices] = useState<MoodleCandidate[]>([]);
  const [site, setSite] = useState("");
  const [started, setStarted] = useState<MoodleStart | null>(null);
  const [step, setStep] = useState<"pick" | "signin" | "waiting" | "done">("pick");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pasteProblem, setPasteProblem] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [connection, setConnection] = useState<MoodleConnection | null>(null);
  const before = useRef<string | undefined>(undefined);
  /** The sign-in the server is holding for this dialog, if any (to cancel it when the dialog goes away). */
  const pendingId = useRef<string | null>(null);
  const shown = useRef(false);
  const cancelPending = () => {
    if (pendingId.current) void moodleApi.cancel(pendingId.current).catch(() => {});
    pendingId.current = null;
  };
  useEffect(() => {
    shown.current = open;
    if (!open) cancelPending();
    return () => {
      shown.current = false;
      cancelPending();
    };
  }, [open]);

  const reset = () => {
    setChoices([]);
    setSite("");
    setStarted(null);
    setStep("pick");
    setProblem(null);
    setPasteProblem(null);
    setPasted("");
    setShowHelp(false);
    setConnection(null);
  };

  useEffect(() => {
    if (!open) return;
    reset();
    void moodleApi.institutions().then(
      (r) => {
        setInstitutions(r.institutions);
        setChosen((c) => c || institutionId || r.institutions[0]?.id || "");
      },
      (e) => setProblem(moodleProblem(errorKindOf(e))),
    );
  }, [open, institutionId]);

  const begin = async (target: string) => {
    const status = await moodleApi.status().catch(() => null);
    before.current = status?.connections.find((c) => c.site === target)?.connectedAt;
    const s = await moodleApi.start(target);
    pendingId.current = s.pendingId;
    // The dialog was closed while the server was preparing, or the address is not one we open.
    if (!shown.current) return cancelPending();
    if (!isSafeLaunchUrl(s.launchUrl, moodleTestMode())) {
      cancelPending();
      throw Object.assign(new Error("unsafe"), { kind: "forbidden" });
    }
    setSite(target);
    setStarted(s);
    setShowHelp(s.mode === "manual");
    setStep("signin");
  };

  const next = async () => {
    setBusy(true);
    setProblem(null);
    try {
      if (choices.length > 1 && site) {
        try {
          return await begin(site);
        } catch (e) {
          // The list of sites is short-lived on the server: look the institution up again.
          if (errorKindOf(e) !== "not_listed") throw e;
          setChoices([]);
        }
      }
      const r = await moodleApi.resolve(chosen);
      if (!r.candidates.length) return setProblem(resolveProblem(r.problem));
      const sso = r.candidates.filter((c) => c.login === "sso");
      if (!sso.length) return setProblem(reasonText(r.candidates[0]));
      if (sso.length > 1) {
        setChoices(sso);
        setSite(sso[0].site);
        return;
      }
      await begin(sso[0].site);
    } catch (e) {
      setProblem(moodleProblem(errorKindOf(e), "signin"));
    } finally {
      setBusy(false);
    }
  };

  // While waiting: ask TutorAI on this computer what happened.
  useEffect(() => {
    if (!open || step !== "waiting" || !started) return;
    const help = setTimeout(() => setShowHelp(true), HELP_AFTER_MS);
    let stop = false;
    const tick = async () => {
      const s = await moodleApi.status().catch(() => null);
      if (stop || !s) return;
      const c = s.connections.find((x) => x.site === site && !x.expired);
      if (c && c.connectedAt !== before.current) {
        pendingId.current = null;
        setConnection(c);
        return setStep("done");
      }
      if (s.pending?.id === started.pendingId) {
        if (s.pending.state === "failed") {
          cancelPending();
          setProblem(moodleProblem(s.pending.error, "signin"));
          setStep("pick");
        }
        return;
      }
      pendingId.current = null;
      setProblem(t("ההתחברות הזו הסתיימה. נסו שוב.", "That sign-in ended. Try again."));
      setStep("pick");
    };
    const timer = setInterval(() => void tick(), 1500);
    return () => {
      stop = true;
      clearInterval(timer);
      clearTimeout(help);
    };
  }, [open, step, started, site]);

  const close = () => {
    cancelPending();
    onClose();
  };

  const submitPaste = async (text: string) => {
    if (!started || !text.trim()) return;
    setPasteProblem(null);
    // The link is a key to the student's Moodle: don't leave it on the clipboard.
    if (text.includes("://token=")) void navigator.clipboard?.writeText("").catch(() => {});
    setPasted("");
    try {
      const r = await moodleApi.paste(started.pendingId, text);
      if (!r.ok) setPasteProblem(hintText(r.hint, r.kind));
    } catch (e) {
      setPasteProblem(moodleProblem(errorKindOf(e)));
    }
  };

  const name = (id: string) => {
    const i = institutions.find((x) => x.id === id);
    return i ? (lang() === "en" ? i.name.en : i.name.he) : id;
  };
  const picked = institutions.find((i) => i.id === chosen);

  return (
    <Modal open={open} onClose={close} title={t("חיבור ל-Moodle", "Connect to Moodle")}>
      <div className="space-y-4" data-testid="moodle-connect">
        {problem && <Alert kind="warn">{problem}</Alert>}

        {step === "pick" && (
          <>
            <Field label={t("המוסד שלכם", "Your institution")}>
              <Select aria-label={t("המוסד שלכם", "Your institution")} value={chosen} onChange={(v) => (setChosen(v), setChoices([]), setProblem(null))} options={institutions.map((i) => ({ value: i.id, label: name(i.id) }))} />
            </Field>
            {choices.length > 1 && (
              <Field label={t("איזו שנה?", "Which year?")} help={t("נמצאו שני אתרי Moodle פתוחים. אם באחד אין קורסים, נסו את השני.", "Two Moodle sites are open. If one has no courses, try the other.")}>
                <Select aria-label={t("איזו שנה?", "Which year?")} value={site} onChange={setSite} options={choices.map((c) => ({ value: c.site, label: c.siteName || c.host, hint: c.site.replace(/^https?:\/\//, "") }))} />
              </Field>
            )}
            {picked?.status === "config-checked" && (
              <p className="text-[13px] text-muted">{t("החיבור עוד לא נבדק במוסד שלכם. הוא אמור לעבוד; ספרו לנו איך הלך.", "Not checked at your institution yet. It should work; tell us how it went.")}</p>
            )}
            <Button className="w-full" onClick={() => void next()} disabled={busy || !chosen}>
              {busy ? <Spinner label={t("בודק את האתר…", "Checking the site…")} /> : t("המשך", "Continue")}
            </Button>
          </>
        )}

        {step === "signin" && started && (
          <>
            <p className="text-sm text-ink-2">
              {t(
                "ייפתח דף ההתחברות הרגיל של המוסד. אחרי ההתחברות TutorAI יקבל גישת קריאה לקורסים שלכם ולקבצים שבהם, עם החשבון שלכם. שום דבר לא משתנה ב-Moodle, והסיסמה לא מגיעה ל-TutorAI.",
                "Your institution's normal sign-in page opens. After you sign in, TutorAI gets read access to your courses and their files, with your own account. Nothing is changed in Moodle, and TutorAI never sees your password.",
              )}
            </p>
            <a
              href={started.launchUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setStep("waiting")}
              onAuxClick={() => setStep("waiting")}
              onContextMenu={() => setStep("waiting")}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-ink px-5 text-[14.5px] font-medium text-white transition-colors hover:bg-black/80"
            >
              <ExternalLink size={15} /> {t("התחברות ל-Moodle", "Sign in to Moodle")}
            </a>
          </>
        )}

        {step === "waiting" && started && (
          <>
            <div className="flex items-start gap-3 text-sm text-ink-2">
              <Spinner />
              <p>
                {started.mode === "auto"
                  ? t("התחברו בלשונית שנפתחה. כשהדפדפן ישאל אם לפתוח את TutorAI, אשרו.", "Sign in in the tab that opened. When your browser asks to open TutorAI, allow it.")
                  : t("התחברו בלשונית שנפתחה, ואז העתיקו לכאן את הקישור שמופיע בדף.", "Sign in in the tab that opened, then copy the link from that page here.")}
              </p>
            </div>
            {showHelp && (
              <div className="space-y-2 rounded-xl border border-black/[0.08] bg-sidebar p-3">
                <p className="text-[13px] text-ink-2">
                  {started.mode === "auto" && <b className="font-medium">{t("לא חזרתם לכאן אוטומטית? ", "Didn't come back here by itself? ")}</b>}
                  {t(
                    "אחרי ההתחברות מופיע דף של Moodle עם קישור אחד בתיבה. לחצו עליו בכפתור ימני, בחרו \"העתק כתובת קישור\" והדביקו כאן.",
                    "After signing in you see a Moodle page with one link in a box. Right-click it, choose \"Copy Link Address\", and paste it here.",
                  )}
                </p>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitPaste(pasted);
                  }}
                >
                  <input
                    className={inputClass}
                    dir="ltr"
                    type="password"
                    autoComplete="off"
                    aria-label={t("הקישור מהדף של Moodle", "The link from the Moodle page")}
                    placeholder="moodlemobile://token=…"
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    onPaste={(e) => {
                      const text = e.clipboardData.getData("text");
                      if (text.includes("://token=")) {
                        e.preventDefault();
                        void submitPaste(text);
                      }
                    }}
                  />
                  <Button type="submit" variant="secondary" disabled={!pasted.trim()}>
                    {t("חיבור", "Connect")}
                  </Button>
                </form>
                {pasteProblem && <p className="text-[13px] text-amber-800">{pasteProblem}</p>}
              </div>
            )}
            <a href={started.launchUrl} target="_blank" rel="noopener noreferrer" className="block text-[13px] text-muted underline">
              {t("לפתוח שוב את דף ההתחברות", "Open the sign-in page again")}
            </a>
          </>
        )}

        {step === "done" && connection && (
          <>
            <Alert kind="success">
              {t(`מחוברים בתור ${connection.fullName} ב-${connection.siteName}. אפשר לסגור את הלשונית של Moodle.`, `Connected as ${connection.fullName} at ${connection.siteName}. You can close the Moodle tab.`)}
            </Alert>
            <Button
              className="w-full"
              onClick={() => onConnected(connection.site)}
            >
              {t("לבחירת קורסים", "Choose courses")}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}

/** The student's Moodle courses: pick which to bring in, or one to link to an existing course. */
export function MoodleCourses({ open, onClose, site, siteName, linkCourseId, onNeedSignIn }: { open: boolean; onClose: () => void; site: string; siteName?: string; linkCourseId?: number; onNeedSignIn: () => void }) {
  const engine = useEngine();
  const [courses, setCourses] = useState<RemoteCourse[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const [needSignIn, setNeedSignIn] = useState(false);

  useEffect(() => {
    if (!open || !site) return;
    setCourses(null);
    setPicked(new Set());
    setProblem(null);
    setNeedSignIn(false);
    void moodleApi.courses(site, lang()).then(
      (list) => setCourses([...list].sort((a, b) => Number(a.hidden) - Number(b.hidden) || (b.lastaccess ?? 0) - (a.lastaccess ?? 0))),
      (e) => {
        const kind = errorKindOf(e);
        setNeedSignIn(kind === "auth");
        setProblem(moodleProblem(kind));
      },
    );
  }, [open, site]);

  const toggle = (id: number) =>
    setPicked((p) => {
      const n = new Set(linkCourseId ? [] : p);
      if (p.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const confirm = () => {
    const chosen = (courses ?? []).filter((c) => picked.has(c.id));
    if (!chosen.length) return;
    let first: number;
    if (linkCourseId) {
      engine.store.linkMoodle(linkCourseId, site, chosen[0].id, chosen[0].displayname);
      first = linkCourseId;
    } else first = chosen.map((c) => linkNewCourse(engine.store, site, c))[0];
    onClose();
    go(href.course(first, "materials"));
  };

  return (
    <Modal open={open} onClose={onClose} title={linkCourseId ? t("קישור לקורס ב-Moodle", "Link to a Moodle course") : t("ייבוא קורסים מ-Moodle", "Import courses from Moodle")}>
      <div className="space-y-4" data-testid="moodle-courses">
        {problem && <Alert kind="warn">{problem}</Alert>}
        {needSignIn && (
          <Button className="w-full" onClick={onNeedSignIn}>
            {t("התחברות מחדש ל-Moodle", "Sign in to Moodle again")}
          </Button>
        )}
        {!courses && !problem && <Spinner label={t("טוען את הקורסים שלכם…", "Loading your courses…")} />}
        {courses && courses.length === 0 && <p className="text-sm text-muted">{t("לא נמצאו קורסים בחשבון הזה. אם זו תחילת שנה, ייתכן שהקורסים נמצאים באתר של השנה הקודמת או הבאה.", "No courses were found for this account. Around the start of a year, your courses may be on last year's or next year's site.")}</p>}
        {courses && courses.length > 0 && (
          <>
            <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
              {courses.map((c) => {
                const linked = engine.store.moodleLinkFor(site, c.id);
                return (
                  <li key={c.id}>
                    <label className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 hover:bg-hover ${c.hidden ? "opacity-60" : ""}`}>
                      <input type={linkCourseId ? "radio" : "checkbox"} name="moodle-course" checked={picked.has(c.id)} disabled={!!linked} onChange={() => toggle(c.id)} />
                      <span className="min-w-0 flex-1 truncate text-sm" dir="auto">
                        {c.displayname}
                      </span>
                      {linked && <Badge color="green">{t("כבר מקושר", "Already linked")}</Badge>}
                    </label>
                  </li>
                );
              })}
            </ul>
            <Button className="w-full" onClick={confirm} disabled={picked.size === 0}>
              {linkCourseId ? t("קישור", "Link") : t(picked.size === 1 ? "ייבוא קורס אחד" : `ייבוא ${picked.size} קורסים`, `Import ${picked.size} ${picked.size === 1 ? "course" : "courses"}`)}
            </Button>
            {!linkCourseId && <p className="text-xs text-muted">{t("בשלב הבא תבחרו אילו קבצים לייבא מכל קורס.", "Next you choose which files to import from each course.")}</p>}
          </>
        )}
        {courses && (
          <p className="text-xs text-muted">
            {siteName ? t(`הקורסים מ-${siteName}. `, `Courses from ${siteName}. `) : ""}
            <button type="button" className="cursor-pointer underline" onClick={onNeedSignIn}>
              {t("הקורסים באתר של שנה אחרת? חיבור לאתר אחר", "Are your courses on another year's site? Connect another site")}
            </button>
          </p>
        )}
      </div>
    </Modal>
  );
}

/**
 * One entry point for both dialogs: connect if needed, then pick courses. `linkCourseId` links an
 * existing course instead of creating new ones.
 */
export function MoodleFlow({ open, onClose, linkCourseId, signInFirst }: { open: boolean; onClose: () => void; linkCourseId?: number; signInFirst?: boolean }) {
  const [site, setSite] = useState<string | null>(null);
  const [siteName, setSiteName] = useState<string | undefined>(undefined);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSite(null);
    setConnecting(false);
    if (signInFirst) return setConnecting(true);
    void moodleApi.status().then(
      (s) => {
        const live = liveConnection(s);
        if (live) {
          setSite(live.site);
          setSiteName(live.siteName);
        } else setConnecting(true);
      },
      () => setConnecting(true),
    );
  }, [open, signInFirst]);

  if (!open) return null;
  return (
    <>
      <MoodleConnect
        open={connecting}
        onClose={() => {
          setConnecting(false);
          if (!site) onClose();
        }}
        onConnected={(s) => {
          if (signInFirst) return onClose();
          setSite(s);
          setSiteName(undefined);
          setConnecting(false);
        }}
      />
      <MoodleCourses
        open={!!site && !connecting}
        site={site ?? ""}
        siteName={siteName}
        linkCourseId={linkCourseId}
        onClose={onClose}
        onNeedSignIn={() => {
          setSite(null);
          setConnecting(true);
        }}
      />
    </>
  );
}

/** Home: "Import from Moodle". On the website it explains that this needs TutorAI on the computer. */
export function MoodleHomeButton() {
  const [open, setOpen] = useState(false);
  const local = localServer();
  if (local && !moodleAvailable()) return null;
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <GraduationCap size={14} /> {t("ייבוא מ-Moodle", "Import from Moodle")}
      </Button>
      {local ? (
        <MoodleFlow open={open} onClose={() => setOpen(false)} />
      ) : (
        <Modal open={open} onClose={() => setOpen(false)} title={t("ייבוא מ-Moodle", "Import from Moodle")}>
          <div className="space-y-4">
            <p className="text-sm text-ink-2">
              {t(
                "TutorAI יכול להתחבר ל-Moodle של המוסד שלכם, להציג את הקורסים ולייבא את הקבצים שתבחרו. כדי לשמור את החיבור אצלכם בלבד, זה עובד ב-TutorAI שמותקן במחשב ולא באתר.",
                "TutorAI can connect to your institution's Moodle, list your courses and import the files you choose. To keep that connection on your computer only, it works in TutorAI installed on your computer, not on the website.",
              )}
            </p>
            <InstallLocal />
          </div>
        </Modal>
      )}
    </>
  );
}

/** Settings: the Moodle connections on this computer. */
export function MoodleSettingsRows() {
  const { status, reload } = useMoodleStatus(moodleAvailable());
  const [signIn, setSignIn] = useState(false);
  if (!moodleAvailable() || !status) return null;
  const disconnect = async (c: MoodleConnection) => {
    const ok = confirm(
      t(
        `לנתק את ${c.siteName}? הקורסים והקבצים שכבר יובאו נשארים. החיבור עצמו משותף לאפליקציית Moodle בטלפון, ולכן אנחנו רק מוחקים אותו מהמחשב הזה ולא מבטלים אותו ב-Moodle.`,
        `Disconnect ${c.siteName}? Courses and files you already imported stay. The connection itself is shared with the Moodle app on your phone, so we only delete it from this computer and don't cancel it in Moodle.`,
      ),
    );
    if (!ok) return;
    await moodleApi.disconnect(c.site).catch(() => {});
    void reload();
  };
  return (
    <>
      {status.connections.length === 0 && (
        <Row
          title="Moodle"
          desc={t("חברו את ה-Moodle של המוסד כדי לייבא חומרי קורס.", "Connect your institution's Moodle to import course materials.")}
          action={
            <Button variant="secondary" size="sm" onClick={() => setSignIn(true)}>
              {t("חיבור", "Connect")}
            </Button>
          }
        />
      )}
      {status.connections.map((c) => (
        <Row
          key={c.site}
          title={
            <span className="flex flex-wrap items-center gap-2">
              Moodle · {c.siteName} {c.expired && <Badge color="amber">{t("החיבור הסתיים", "Connection ended")}</Badge>}
            </span>
          }
          desc={
            <>
              {t(`מחוברים בתור ${c.fullName} מאז ${fmtDate(c.connectedAt)}.`, `Connected as ${c.fullName} since ${fmtDate(c.connectedAt)}.`)}{" "}
              <span dir="ltr">{c.host}</span>.{" "}
              {c.site.startsWith("https://") && (
                <a className="underline" href={`${c.site}/user/managetoken.php`} target="_blank" rel="noopener noreferrer">
                  {t("ביטול החיבור גם ב-Moodle (מפתחות אבטחה)", "Cancel it in Moodle too (Security keys)")}
                </a>
              )}
            </>
          }
          action={
            <>
              {c.expired && (
                <Button size="sm" onClick={() => setSignIn(true)}>
                  {t("התחברות מחדש", "Sign in again")}
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => void disconnect(c)}>
                {t("ניתוק", "Disconnect")}
              </Button>
            </>
          }
        />
      ))}
      {status.connections.length > 0 && (
        <div className="py-3">
          <button type="button" className="cursor-pointer text-[13px] text-muted underline" onClick={() => setSignIn(true)}>
            {t("חיבור אתר Moodle נוסף (למשל של שנה אחרת)", "Connect another Moodle site (for example another year's)")}
          </button>
        </div>
      )}
      <MoodleFlow
        open={signIn}
        signInFirst
        onClose={() => {
          setSignIn(false);
          void reload();
        }}
      />
    </>
  );
}
