import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Folder } from "lucide-react";
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
        desc={t("עוצר את TutorAI במחשב. הוא נסגר גם לבד אחרי שעה בלי שימוש. פותחים שוב מהסמל.", "Stops TutorAI on this computer. It also stops by itself after an hour without use. Open it again from its icon.")}
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              if (!confirm(t("לסגור את TutorAI?", "Quit TutorAI?"))) return;
              await localApi.quit().catch(() => {});
              const p = document.createElement("p");
              p.style.cssText = "font:16px system-ui;padding:40px;text-align:center";
              p.textContent = t("TutorAI נסגר. אפשר לסגור את הלשונית.", "TutorAI has stopped. You can close this tab.");
              document.body.replaceChildren(p);
            }}
          >
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
