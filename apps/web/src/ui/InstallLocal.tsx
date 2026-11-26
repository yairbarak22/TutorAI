import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { t } from "../i18n.tsx";

/**
 * "Install TutorAI on my computer": one command in Terminal / PowerShell. The installer is
 * served from this site, verifies the binary's checksum, and adds a TutorAI icon.
 */

const SITE = "https://yairbarak22.github.io/TutorAI";
export const INSTALL_SH = `curl -fsSL ${SITE}/install.sh | sh`;
export const INSTALL_PS1 = `irm ${SITE}/install.ps1 | iex`;

const isWindows = () => typeof navigator !== "undefined" && /Win/i.test(navigator.platform || navigator.userAgent);

function Command({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg bg-ink px-3 py-2.5 font-mono text-[12.5px] text-white" dir="ltr">
      <span className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap">{text}</span>
      <button
        type="button"
        className="flex cursor-pointer items-center gap-1 rounded-md bg-white/15 px-2 py-1 font-sans text-[12px] hover:bg-white/25"
        onClick={async () => {
          await navigator.clipboard.writeText(text).catch(() => {});
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
      >
        {done ? <Check size={13} /> : <Copy size={13} />} {done ? t("הועתק", "Copied") : t("העתקה", "Copy")}
      </button>
    </div>
  );
}

export function InstallLocal() {
  const [win, setWin] = useState(isWindows());
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted">
        {t(
          "גרסה למחשב מאפשרת להשתמש במנוי Claude (Pro/Max) או ChatGPT (Plus/Pro) שכבר יש לכם במקום מפתח API, ושומרת את הנתונים בתיקייה בכל דפדפן.",
          "The computer version lets you use the Claude (Pro/Max) or ChatGPT (Plus/Pro) plan you already have instead of an API key, and saves your data in a folder in any browser.",
        )}
      </p>
      <div className="flex gap-1.5 text-[12.5px]" role="group">
        {([
          [false, "Mac / Linux"],
          [true, "Windows"],
        ] as const).map(([w, label]) => (
          <button
            key={label}
            type="button"
            aria-pressed={win === w}
            onClick={() => setWin(w)}
            className={`h-7 cursor-pointer rounded-full border px-3 ${win === w ? "border-ink bg-ink text-white" : "border-black/10 bg-white"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <ol className="list-decimal space-y-2 ps-5 text-[13px] text-ink-2">
        <li>
          {win
            ? t("פתחו את PowerShell: לחצו על התחל, הקלידו PowerShell ולחצו Enter.", "Open PowerShell: press Start, type PowerShell and press Enter.")
            : t("פתחו את Terminal: ב-Mac לחצו ⌘+רווח, הקלידו Terminal ולחצו Enter.", "Open Terminal: on a Mac press ⌘+Space, type Terminal and press Enter.")}
        </li>
        <li>
          {t("העתיקו את השורה הזו, הדביקו אותה ולחצו Enter:", "Copy this line, paste it and press Enter:")}
          <div className="mt-1.5">
            <Command text={win ? INSTALL_PS1 : INSTALL_SH} />
          </div>
        </li>
        <li>
          {t(
            "תוך כחצי דקה TutorAI ייפתח בדפדפן, ויתווסף סמל TutorAI. מעכשיו פותחים מהסמל.",
            "In about half a minute TutorAI opens in your browser and a TutorAI icon is added. From now on, open it from the icon.",
          )}
        </li>
      </ol>
      <p className="text-[12px] text-muted">
        {t(
          "עוברים מהגרסה בדפדפן? ב-Chrome/Edge עם תיקייה: בחרו את אותה תיקייה בגרסה למחשב. אחרת: הורידו גיבוי בהגדרות ← נתונים, ושחזרו אותו בגרסה למחשב.",
          "Moving from the browser version? With a folder in Chrome/Edge: choose the same folder in the computer version. Otherwise: download a backup in Settings → Data and restore it in the computer version.",
        )}
      </p>
    </div>
  );
}
