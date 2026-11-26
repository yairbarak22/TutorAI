import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { verifyApiKey } from "@tutorai/core";
import { secrets } from "../platform/secrets.ts";
import { Alert, Button, Spinner, inputClass } from "./components.tsx";
import { t } from "../i18n.tsx";

/**
 * Paste a Claude API key: verify it, then keep it in this browser or only for this tab.
 * Shows how the key is protected, so students can decide with the facts in front of them.
 */
export function ApiKeyForm({
  submitLabel,
  onSaved,
  defaultRemember = true,
  large,
}: {
  submitLabel: string;
  onSaved: () => void;
  defaultRemember?: boolean;
  large?: boolean;
}) {
  const [key, setKey] = useState("");
  const [remember, setRemember] = useState(defaultRemember);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setChecking(true);
    setError(null);
    const ok = await verifyApiKey(key.trim());
    setChecking(false);
    if (ok !== true) return setError(ok);
    secrets.setApiKey(key.trim(), remember);
    setKey("");
    onSaved();
  };

  return (
    <div className="space-y-3">
      <div className={large ? "space-y-3" : "flex flex-wrap gap-2"}>
        <input
          type="password"
          dir="ltr"
          autoComplete="off"
          placeholder="sk-ant-..."
          className={`${inputClass} ${large ? "h-11" : "max-w-sm flex-1"}`}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && key.trim() && !checking && void save()}
          aria-label={t("מפתח API", "API key")}
        />
        <Button size={large ? "lg" : "md"} className={large ? "w-full" : ""} disabled={!key.trim() || checking} onClick={save}>
          {checking ? <Spinner label={t("בודק את המפתח…", "Checking the key…")} /> : submitLabel}
        </Button>
      </div>
      <label className="flex items-start gap-2 text-[13px] text-ink-2">
        <input type="checkbox" className="mt-0.5" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span>
          {t("לזכור את המפתח בדפדפן הזה", "Remember the key in this browser")}
          <span className="block text-xs text-muted">
            {remember
              ? t("כבוי: המפתח יימחק כשתסגרו את הלשונית, ותדביקו אותו שוב בפעם הבאה.", "Off: the key is forgotten when you close the tab, and you paste it again next time.")
              : t("המפתח יימחק כשתסגרו את הלשונית.", "The key will be forgotten when you close the tab.")}
          </span>
        </span>
      </label>
      {error && <Alert kind="error">{error}</Alert>}
      <KeyProtection />
    </div>
  );
}

/** The facts about where the key goes, plus the one step that limits the damage if it ever leaks. */
export function KeyProtection() {
  return (
    <details className="rounded-xl border border-black/[0.08] bg-black/[0.015] px-4 py-3 text-[13px] leading-6 text-ink-2">
      <summary className="flex cursor-pointer items-center gap-2 font-medium text-ink">
        <ShieldCheck size={15} /> {t("איך המפתח שלכם מוגן", "How your key is protected")}
      </summary>
      <ul className="mt-2 list-disc space-y-1.5 ps-5">
        <li>{t("הוא נשמר רק בדפדפן הזה (או רק עד שתסגרו את הלשונית), לא בתיקיית הנתונים ולא בשום שרת.", "It's stored only in this browser (or only until you close the tab), not in your data folder and not on any server.")}</li>
        <li>{t("הוא נשלח רק ל-Anthropic, ישירות מהדפדפן. ל-TutorAI אין שרת.", "It's sent only to Anthropic, directly from your browser. TutorAI has no server.")}</li>
        <li>
          {t(
            "מדיניות אבטחה בדף חוסמת בקשות של האפליקציה לכל כתובת חוץ מ-Anthropic ומהמודל המקומי שלכם.",
            "A security policy in the page blocks the app's requests to any address other than Anthropic and your local model.",
          )}
        </li>
        <li>
          {t("הקוד פתוח, ואפשר לבדוק את כל זה בעצמכם: ", "The code is open, so you can check all of this yourself: ")}
          <a className="underline" href="https://github.com/yairbarak22/TutorAI/blob/main/SECURITY.md" target="_blank" rel="noreferrer">
            SECURITY.md
          </a>
          .
        </li>
      </ul>
      <p className="mt-3 rounded-lg bg-white px-3 py-2 ring-1 ring-black/[0.06]">
        <b>{t("מומלץ:", "Recommended:")}</b>{" "}
        {t(
          "צרו מפתח נפרד רק ל-TutorAI, ב-workspace עם מגבלת הוצאה חודשית נמוכה. כך גם במקרה הגרוע ההוצאה מוגבלת, ואפשר לבטל את המפתח בכל רגע ב-",
          "Create a separate key just for TutorAI, in a workspace with a low monthly spend limit. Even in the worst case the spend is capped, and you can revoke the key at any time in the ",
        )}
        <a className="underline" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
          Anthropic Console
        </a>
        .
      </p>
    </details>
  );
}
