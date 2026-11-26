import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Folder, Laptop, Power } from "lucide-react";
import type { Browse, UpdateStatus } from "@tutorai/local-api";
import { localApi, localServer } from "../platform/local-server.ts";
import { Alert, Button, Modal, Row, errorMessage } from "./components.tsx";
import { t } from "../i18n.tsx";

/** Picks a folder on this computer through the local server (a web page can't hand a real path to it). */
export function FolderChooser({ open, onClose, onChosen }: { open: boolean; onClose: () => void; onChosen: (label: string) => void }) {
  const [dir, setDir] = useState<Browse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const go = async (path?: string) => {
    try {
      setDir(await localApi.browse(path));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  useEffect(() => {
    if (open) void localApi.folder().then((f) => go(f.path), () => go());
  }, [open]);
  const Back = document.dir === "rtl" ? ChevronRight : ChevronLeft;
  return (
    <Modal open={open} onClose={onClose} title={t("בחירת תיקייה לנתונים", "Choose a folder for your data")}>
      {error && <Alert kind="error">{error}</Alert>}
      {dir && (
        <div>
          <div className="flex items-center gap-2 text-[13px]" dir="ltr">
            {dir.parent && (
              <button className="cursor-pointer rounded p-1 hover:bg-hover" onClick={() => void go(dir.parent!)} aria-label={t("למעלה", "Up")}>
                <Back size={16} />
              </button>
            )}
            <span className="truncate font-mono text-[12.5px]">{dir.path}</span>
          </div>
          <ul className="mt-2 max-h-64 overflow-auto rounded-lg border border-black/10">
            {dir.dirs.length === 0 && <li className="px-3 py-2 text-[13px] text-muted">{t("אין תיקיות כאן", "No folders here")}</li>}
            {dir.dirs.map((d) => (
              <li key={d}>
                <button className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-start text-[13.5px] hover:bg-hover" onClick={() => void go(`${dir.path}/${d}`)} dir="auto">
                  <Folder size={14} className="text-muted" /> {d}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <input
              className="h-8 min-w-0 flex-1 rounded-lg border border-black/10 px-2 text-[13px]"
              placeholder={t("תיקייה חדשה כאן (לא חובה)", "New folder here (optional)")}
              value={newName}
              onChange={(e) => setNewName(e.target.value.replace(/[\\/]/g, ""))}
            />
            <Button
              size="sm"
              onClick={async () => {
                try {
                  const target = newName.trim() ? `${dir.path}/${newName.trim()}` : dir.path;
                  const f = await localApi.setFolder(target);
                  onChosen(f.label);
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            >
              {t("שמירה בתיקייה הזו", "Use this folder")}
            </Button>
          </div>
          <p className="mt-2 text-[12px] text-muted">
            {t("התיקייה החדשה תתחיל ריקה. כדי להעביר נתונים, הורידו גיבוי ושחזרו אותו אחרי ההחלפה.", "The new folder starts empty. To move your data, download a backup and restore it after switching.")}
          </p>
        </div>
      )}
    </Modal>
  );
}

const isMac = () => typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);
const isWindows = () => typeof navigator !== "undefined" && /Win/i.test(navigator.platform || navigator.userAgent);

/** Stops the server and replaces the page with a short note. */
export async function quitNow() {
  if (!confirm(t("לסגור את TutorAI?", "Quit TutorAI?"))) return;
  await localApi.quit().catch(() => {});
  const p = document.createElement("p");
  p.style.cssText = "font:16px system-ui;padding:40px;text-align:center;line-height:1.6";
  p.textContent = t(
    "TutorAI נסגר. אפשר לסגור את הלשונית. כדי לחזור, פתחו את TutorAI מהסמל שלו.",
    "TutorAI has stopped. You can close this tab. To come back, open TutorAI from its icon.",
  );
  document.body.replaceChildren(p);
}

/** How to come back to TutorAI later, for this computer. */
export function reopenHint() {
  if (isMac())
    return t(
      "לחצו ⌘+רווח, הקלידו TutorAI ולחצו Enter. אפשר גם מ-Launchpad או מתיקיית האפליקציות (Applications).",
      "Press ⌘+Space, type TutorAI and press Enter. Or open it from Launchpad or the Applications folder.",
    );
  if (isWindows()) return t("לחצו על סמל TutorAI בשולחן העבודה או בתפריט התחל.", "Click the TutorAI icon on your Desktop or in the Start menu.");
  return t("פתחו את TutorAI מתפריט היישומים, או הריצו tutorai בטרמינל.", "Open TutorAI from your applications menu, or run tutorai in a terminal.");
}

const TIP_KEY = "tutorai.localTipSeen";

/**
 * Sidebar: "TutorAI on this computer". Opens a short explanation of how to close and reopen it,
 * automatically the first time TutorAI Local is used.
 */
export function LocalStatus() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(TIP_KEY) !== "1";
    } catch {
      return false;
    }
  });
  if (!localServer()) return null;
  const close = () => {
    try {
      localStorage.setItem(TIP_KEY, "1");
    } catch {
      /* fine */
    }
    setOpen(false);
  };
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-start text-[12.5px] text-muted transition hover:bg-hover hover:text-ink"
      >
        <Laptop size={14} /> {t("TutorAI במחשב · סגירה ופתיחה", "TutorAI on this computer · close & reopen")}
      </button>
      <Modal open={open} onClose={close} title={t("TutorAI רץ במחשב שלכם", "TutorAI runs on your computer")}>
        <div className="space-y-4 text-[14px] leading-relaxed text-ink-2">
          <div>
            <div className="font-semibold text-ink">{t("סיימתם לעבוד?", "Done for now?")}</div>
            <p>{t("פשוט סגרו את הדפדפן. TutorAI נסגר לבד אחרי רבע שעה בלי שימוש. הכול כבר שמור.", "Just close the browser. TutorAI stops by itself after 15 minutes without use. Everything is already saved.")}</p>
          </div>
          <div>
            <div className="font-semibold text-ink">{t("רוצים לחזור?", "Coming back?")}</div>
            <p>{reopenHint()}</p>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button onClick={close}>{t("הבנתי", "Got it")}</Button>
            <Button variant="secondary" onClick={() => void quitNow()}>
              <Power size={14} /> {t("לסגור את TutorAI עכשיו", "Quit TutorAI now")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/** Settings → Data: TutorAI on this computer (version, updates, data folder, quit, uninstall). */
export function LocalComputerRows({ folderLabel }: { folderLabel: string }) {
  const hello = localServer();
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    void localApi.update().then(setUpdate, () => {});
  }, []);
  if (!hello) return null;
  const waitAndReload = async () => {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await localApi.ping()) return location.reload();
    }
    location.reload();
  };
  return (
    <>
      {msg && (
        <div className="mt-4">
          <Alert kind="success">{msg}</Alert>
        </div>
      )}
      <Row
        title={t("תיקיית הנתונים", "Data folder")}
        desc={<b className="font-medium text-ink-2" dir="ltr">{folderLabel}</b>}
        action={
          <Button variant="secondary" size="sm" onClick={() => setChoosing(true)}>
            {t("החלפה", "Change")}
          </Button>
        }
      />
      <Row
        title={t("TutorAI במחשב הזה", "TutorAI on this computer")}
        desc={
          update?.staged
            ? t(`גרסה ${update.current}. עדכון לגרסה ${update.latest} מוכן.`, `Version ${update.current}. An update to ${update.latest} is ready.`)
            : t(`גרסה ${hello.version}. עדכונים מותקנים אוטומטית.`, `Version ${hello.version}. Updates install automatically.`)
        }
        action={
          update?.staged ? (
            <Button
              size="sm"
              onClick={async () => {
                await localApi.restart();
                await waitAndReload();
              }}
            >
              {t("הפעלה מחדש לעדכון", "Restart to update")}
            </Button>
          ) : undefined
        }
      />
      <Row
        title={t("עדכונים אוטומטיים", "Automatic updates")}
        desc={t("בודק פעם ביום אם יש גרסה חדשה ב-GitHub.", "Checks GitHub for a new version once a day.")}
        action={
          update && (
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                await localApi.saveSettings({ autoUpdate: !update.auto });
                setUpdate({ ...update, auto: !update.auto });
              }}
            >
              {update.auto ? t("כיבוי", "Turn off") : t("הפעלה", "Turn on")}
            </Button>
          )
        }
      />
      <Row
        title={t("סגירת TutorAI", "Quit TutorAI")}
        desc={t("אפשר פשוט לסגור את הדפדפן: TutorAI נסגר לבד אחרי רבע שעה בלי שימוש. כאן סוגרים אותו מיד.", "You can just close the browser: TutorAI stops by itself after 15 minutes without use. This stops it right away.")}
        action={
          <Button variant="secondary" size="sm" onClick={() => void quitNow()}>
            {t("סגירה", "Quit")}
          </Button>
        }
      />
      <Row
        title={t("הסרה", "Uninstall")}
        desc={
          <>
            {t("הריצו בטרמינל:", "Run in Terminal:")} <code dir="ltr">tutorai uninstall</code>.{" "}
            {t("תיקיית הנתונים לא תימחק.", "Your data folder is kept.")}
          </>
        }
      />
      <FolderChooser
        open={choosing}
        onClose={() => setChoosing(false)}
        onChosen={(label) => {
          setChoosing(false);
          setMsg(t(`התיקייה הוחלפה ל-${label}. טוען מחדש…`, `Folder changed to ${label}. Reloading…`));
          setTimeout(() => location.reload(), 900);
        }}
      />
    </>
  );
}
