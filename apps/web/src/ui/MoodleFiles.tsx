import { useEffect, useMemo, useRef, useState } from "react";
import { GraduationCap, RefreshCw } from "lucide-react";
import type { MoodleFileRow, Source } from "@tutorai/core";
import type { MoodleContents } from "@tutorai/local-api";
import { isNew } from "@tutorai/moodle";
import { useEngine } from "../engine.ts";
import { fmtDate, fmtTime, t } from "../i18n.tsx";
import { dismissNew, errorKindOf, guessKind, refreshCourse, shouldRefresh, type ImportOutcome } from "../moodle/sync.ts";
import { moodleAvailable } from "../platform/moodle.ts";
import { Alert, Badge, Button, Card, ProgressBar, Spinner } from "./components.tsx";
import { MoodleFlow, liveConnection, moodleProblem, useMoodleStatus } from "./Moodle.tsx";
import { Select } from "./Select.tsx";

/**
 * The Moodle strip on a course's Materials tab (docs/rfc-moodle.md §10): link the course, see what
 * is new in Moodle, and import the files you pick. Listing is automatic; importing is your choice.
 */

const mb = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`);
/** A file the student can tick: never imported, updated in Moodle, or failed last time. */
const selectable = (r: MoodleFileRow) => r.present && (r.state === "new" || r.state === "failed" || r.state === "skipped" || (r.state === "imported" && r.changed));

function otherLine(other: MoodleContents["other"]): string | null {
  const parts: string[] = [];
  const tools = Object.values(other.notImportable).reduce((a, n) => a + n, 0);
  if (tools) parts.push(t(tools === 1 ? "פעילות אחת שאינה קובץ (כלי חיצוני, הקלטה, בוחן)" : `${tools} פעילויות שאינן קבצים (כלים חיצוניים, הקלטות, בחנים)`, `${tools} ${tools === 1 ? "activity that isn't a file" : "activities that aren't files"} (external tools, recordings, quizzes)`));
  if (other.textPages) parts.push(t(other.textPages === 1 ? "דף טקסט אחד" : `${other.textPages} דפי טקסט`, `${other.textPages} text ${other.textPages === 1 ? "page" : "pages"}`));
  if (other.links) parts.push(t(other.links === 1 ? "קישור אחד" : `${other.links} קישורים`, `${other.links} ${other.links === 1 ? "link" : "links"}`));
  if (other.external) parts.push(t(other.external === 1 ? "קובץ אחד שמאוחסן מחוץ ל-Moodle" : `${other.external} קבצים שמאוחסנים מחוץ ל-Moodle`, `${other.external} ${other.external === 1 ? "file" : "files"} stored outside Moodle`));
  return parts.length ? t(`נמצאו גם, ואי אפשר לייבא: ${parts.join(", ")}.`, `Also found, and can't be imported: ${parts.join(", ")}.`) : null;
}

export function MoodleStrip({ courseId }: { courseId: number }) {
  const engine = useEngine();
  const link = engine.store.moodleLink(courseId);
  const { status, reload } = useMoodleStatus(moodleAvailable());
  const [flow, setFlow] = useState<"link" | "signin" | null>(null);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [other, setOther] = useState<MoodleContents["other"] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [kinds, setKinds] = useState<Map<number, Source["kind"]>>(new Map());
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  // Kept by the engine, so an import started before a tab switch is still shown as running.
  const progress = engine.moodleImports.get(courseId);
  const importing = !!progress;

  const rows = link ? engine.store.moodleFiles(courseId) : [];
  const fresh = rows.filter(isNew);
  const connected = !!link && !!liveConnection(status, link.site);
  const needsSignIn = !!link && !!status && !connected;

  const check = async (auto = false) => {
    setChecking(true);
    setProblem(null);
    try {
      const contents = await refreshCourse(engine.moodleSync, courseId, true);
      setOther(contents.other);
      const now = engine.store.moodleFiles(courseId);
      // First look at a course: open the list with every importable file ticked.
      if (now.some(isNew)) {
        setOpen(true);
        setSelected(new Set(now.filter(isNew).map((r) => r.id)));
      } else if (!auto) setOpen(true);
    } catch (e) {
      const kind = errorKindOf(e);
      if (kind === "auth") void reload();
      else setProblem(moodleProblem(kind));
    } finally {
      setChecking(false);
    }
  };

  // Look at Moodle when the tab opens, if the last look is older than six hours. Never downloads.
  useEffect(() => {
    if (link && connected && shouldRefresh(link)) void check(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, connected, link?.site, link?.remote_course_id]);

  const visible = useMemo(() => (showAll ? rows.filter((r) => r.present) : rows.filter((r) => selectable(r) && r.state !== "skipped")), [rows, showAll]);
  const sections = useMemo(() => {
    const map = new Map<string, MoodleFileRow[]>();
    for (const r of visible) map.set(r.section, [...(map.get(r.section) ?? []), r]);
    return [...map];
  }, [visible]);

  if (!moodleAvailable()) return null;

  if (!link)
    return (
      <>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-black/[0.08] bg-white px-4 py-3" data-testid="moodle-strip">
          <span className="flex items-center gap-2 text-sm text-ink-2">
            <GraduationCap size={16} /> {t("הקורס הזה קיים ב-Moodle? אפשר לקשר אותו ולייבא את הקבצים משם.", "Is this course in Moodle? Link it and import its files from there.")}
          </span>
          <Button size="sm" variant="secondary" onClick={() => setFlow("link")}>
            {t("קישור לקורס ב-Moodle", "Link to a Moodle course")}
          </Button>
        </div>
        <MoodleFlow open={flow === "link"} linkCourseId={courseId} onClose={() => setFlow(null)} />
      </>
    );

  const chosen = visible.filter((r) => selected.has(r.id) && selectable(r));
  const total = chosen.reduce((a, r) => a + r.size, 0);
  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  /** Ticks or clears every importable file in `list` (all of them, or one section). */
  const setMany = (list: MoodleFileRow[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      for (const r of list) if (selectable(r)) (on ? n.add(r.id) : n.delete(r.id));
      return n;
    });
  const tickState = (list: MoodleFileRow[]) => {
    const can = list.filter(selectable);
    const on = can.filter((r) => selected.has(r.id)).length;
    return { can: can.length, on, all: can.length > 0 && on === can.length, some: on > 0 && on < can.length };
  };
  const everything = tickState(visible);

  const runImport = async () => {
    setOutcome(null);
    setProblem(null);
    try {
      const result = await engine.importFromMoodle(courseId, chosen.map((r) => r.id), kinds);
      if (!result) return;
      setOutcome(result);
      setSelected(new Set());
      if (result.stopped === "auth") void reload();
      else if (result.stopped) setProblem(moodleProblem(result.stopped));
    } catch (e) {
      setProblem(moodleProblem(errorKindOf(e)));
    }
  };

  const stateBadge = (r: MoodleFileRow) => {
    if (r.state === "imported" && r.changed) return <Badge color="blue">{t("עודכן ב-Moodle", "Updated in Moodle")}</Badge>;
    if (r.state === "imported") return <Badge color="green">{t("יובא", "Imported")}</Badge>;
    if (r.state === "unsupported") return <Badge>{t("סוג קובץ לא נתמך", "Unsupported file type")}</Badge>;
    if (r.state === "too_large") return <Badge>{t("גדול מדי (מעל 60MB)", "Too large (over 60MB)")}</Badge>;
    if (r.state === "skipped") return <Badge>{t("דילגתם", "Skipped")}</Badge>;
    if (r.state === "failed") return <Badge color="red">{t("נכשל", "Failed")}</Badge>;
    return null;
  };

  return (
    <Card className="space-y-3 p-4" data-testid="moodle-strip">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-sm">
          <span className="flex items-center gap-2 font-medium">
            <GraduationCap size={16} /> Moodle · <span dir="auto" className="truncate">{link.remote_name}</span>
          </span>
          <span className="text-xs text-muted">
            {link.last_sync ? t(`נבדק לאחרונה ${fmtDate(link.last_sync)} ${fmtTime(new Date(link.last_sync))}`, `Last checked ${fmtDate(link.last_sync)} ${fmtTime(new Date(link.last_sync))}`) : t("עוד לא נבדק", "Not checked yet")}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {connected && (
            <Button size="sm" variant="secondary" onClick={() => void check()} disabled={checking || importing}>
              {checking ? <Spinner label={t("בודק…", "Checking…")} /> : (<><RefreshCw size={13} /> {t("בדיקה ב-Moodle עכשיו", "Check Moodle now")}</>)}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={importing}
            onClick={() => confirm(t("לבטל את הקישור ל-Moodle? הקבצים שכבר יובאו נשארים בקורס.", "Unlink from Moodle? Files you already imported stay in the course.")) && engine.store.unlinkMoodle(courseId)}
          >
            {t("ביטול הקישור", "Unlink")}
          </Button>
        </div>
      </div>

      {needsSignIn && (
        <Alert kind="warn">
          {moodleProblem("auth")}{" "}
          <button type="button" className="cursor-pointer font-semibold underline" onClick={() => setFlow("signin")}>
            {t("התחברות מחדש", "Sign in again")}
          </button>
        </Alert>
      )}
      {problem && <Alert kind="warn">{problem}</Alert>}
      {outcome && (
        <Alert kind={outcome.failed ? "warn" : "success"}>
          {t(
            `${outcome.imported === 0 ? "לא יובאו קבצים" : outcome.imported === 1 ? "יובא קובץ אחד" : `יובאו ${outcome.imported} קבצים`}${outcome.duplicates ? `, ${outcome.duplicates} כבר היו בקורס` : ""}${outcome.failed ? `, ${outcome.failed} נכשלו` : ""}.`,
            `${outcome.imported === 0 ? "No files were imported" : `Imported ${outcome.imported} ${outcome.imported === 1 ? "file" : "files"}`}${outcome.duplicates ? `, ${outcome.duplicates} already in the course` : ""}${outcome.failed ? `, ${outcome.failed} failed` : ""}.`,
          )}
          {outcome.imported > 0 && ` ${t(outcome.imported === 1 ? "הניתוח שלו מתחיל ברשימה למטה." : "הניתוח שלהם מתחיל ברשימה למטה.", outcome.imported === 1 ? "Its analysis starts in the list below." : "Their analysis starts in the list below.")}`}
        </Alert>
      )}

      {fresh.length > 0 && !open && (
        <button type="button" className="w-full cursor-pointer rounded-xl bg-sky-50 px-4 py-2.5 text-start text-sm font-medium text-sky-800 hover:bg-sky-100" onClick={() => (setOpen(true), setSelected(new Set(fresh.map((r) => r.id))))}>
          {t(fresh.length === 1 ? "קובץ חדש אחד ב-Moodle" : `${fresh.length} קבצים חדשים ב-Moodle`, `${fresh.length} new ${fresh.length === 1 ? "file" : "files"} in Moodle`)}
        </button>
      )}
      {rows.length > 0 && fresh.length === 0 && !open && (
        <button type="button" className="cursor-pointer text-[13px] text-muted underline" onClick={() => (setOpen(true), setShowAll(true))}>
          {t("הצגת כל הקבצים שב-Moodle", "Show all files in Moodle")}
        </button>
      )}

      {open && (
        <div className="space-y-3" data-testid="moodle-files">
          {sections.length === 0 && <p className="text-sm text-muted">{t("אין קבצים חדשים לייבוא.", "There are no new files to import.")}</p>}
          {everything.can > 1 && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-black/[0.03] px-3 py-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                <TriCheck
                  checked={everything.all}
                  indeterminate={everything.some}
                  disabled={importing}
                  onChange={() => setMany(visible, !everything.all)}
                  label={t("סימון כל הקבצים", "Select all files")}
                />
                {t("סימון הכל", "Select all")}
              </label>
              <span className="text-xs text-muted">{t(`נבחרו ${everything.on} מתוך ${everything.can}`, `${everything.on} of ${everything.can} selected`)}</span>
              {everything.on > 0 && (
                <button type="button" className="ms-auto cursor-pointer text-[13px] text-muted underline hover:text-ink" disabled={importing} onClick={() => setMany(visible, false)}>
                  {t("ניקוי הבחירה", "Clear selection")}
                </button>
              )}
            </div>
          )}
          {sections.map(([section, list]) => (
            <div key={section}>
              {section && (() => {
                const st = tickState(list);
                return st.can > 1 ? (
                  <label className="mb-1 flex w-fit cursor-pointer items-center gap-2 text-xs font-semibold text-muted">
                    <TriCheck
                      checked={st.all}
                      indeterminate={st.some}
                      disabled={importing}
                      onChange={() => setMany(list, !st.all)}
                      label={t(`סימון כל הקבצים ב${section}`, `Select all files in ${section}`)}
                    />
                    <span dir="auto">{section}</span>
                  </label>
                ) : (
                  <div className="mb-1 text-xs font-semibold text-muted" dir="auto">{section}</div>
                );
              })()}
              <ul className="divide-y divide-slate-100 rounded-xl border border-black/[0.06]">
                {list.map((r) => {
                  const can = selectable(r);
                  const pct = progress?.get(r.id);
                  return (
                    <li key={r.id} className={`flex flex-wrap items-center gap-3 px-3 py-2 ${can ? "" : "opacity-60"}`} data-testid="moodle-file">
                      {/* The whole name is clickable, not just the small box. */}
                      <label className={`flex min-w-0 flex-1 items-center gap-3 ${can && !importing ? "cursor-pointer" : ""}`}>
                        <input type="checkbox" aria-label={r.filename} checked={selected.has(r.id) && can} disabled={!can || importing} onChange={() => toggle(r.id)} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm" dir="auto">{r.filename}</div>
                          <div className="truncate text-xs text-muted" dir="auto">
                            {r.activity} · {mb(r.size)}
                            {r.state === "failed" && r.error ? ` · ${moodleProblem(r.error)}` : ""}
                          </div>
                          {pct !== undefined && <ProgressBar value={pct} className="mt-1" />}
                        </div>
                      </label>
                      {stateBadge(r)}
                      {can && (
                        <div className="w-36">
                          <Select
                            size="sm"
                            aria-label={t(`סוג הקובץ ${r.filename}`, `Type of ${r.filename}`)}
                            value={kinds.get(r.id) ?? guessKind(r)}
                            onChange={(v) => setKinds((k) => new Map(k).set(r.id, v as Source["kind"]))}
                            options={[
                              { value: "material", label: t("חומר לימוד", "Study material") },
                              { value: "sample_exam", label: t("מבחן לדוגמה", "Sample exam") },
                            ]}
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {other && otherLine(other) && <p className="text-xs text-muted">{otherLine(other)}</p>}
          {chosen.length > 0 && !engine.demo && (
            <p className="text-xs text-muted">{t("ניתוח הקבצים משתמש במודל שחיברתם (מפתח או מנוי), כמו בהעלאה ידנית.", "Analyzing the files uses the model you connected (key or plan), as with a manual upload.")}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {/* Shown only while there is something to tick; with nothing ticked it says so instead of "0 files". */}
            {(importing || visible.some(selectable)) && (
              <Button onClick={() => void runImport()} disabled={!chosen.length || importing || !connected}>
                {importing ? (
                  <Spinner label={t("מייבא…", "Importing…")} />
                ) : chosen.length === 0 ? (
                  t("בחרו קבצים לייבוא", "Choose files to import")
                ) : (
                  t(chosen.length === 1 ? `ייבוא קובץ אחד (${mb(total)})` : `ייבוא ${chosen.length} קבצים (${mb(total)})`, `Import ${chosen.length} ${chosen.length === 1 ? "file" : "files"} (${mb(total)})`)
                )}
              </Button>
            )}
            {fresh.length > 0 && (
              <Button variant="ghost" size="sm" disabled={importing} onClick={() => (dismissNew(engine.store, courseId), setSelected(new Set()))}>
                {t("אל תציגו את אלה שוב", "Don't show these again")}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
              {showAll ? t("רק חדשים", "Only new") : t("כל הקבצים", "All files")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t("סגירה", "Close")}
            </Button>
          </div>
        </div>
      )}

      <MoodleFlow
        open={flow === "signin"}
        signInFirst
        onClose={() => {
          setFlow(null);
          void reload();
        }}
      />
    </Card>
  );
}

/** A checkbox that can also show "some ticked" (for select all / a whole section). */
function TriCheck({ checked, indeterminate, disabled, onChange, label }: { checked: boolean; indeterminate: boolean; disabled?: boolean; onChange: () => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return <input ref={ref} type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={onChange} />;
}
