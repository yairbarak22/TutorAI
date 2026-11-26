import { useState, type ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { localServer } from "../platform/local-server.ts";
import { secrets, type Provider } from "../platform/secrets.ts";
import { ApiKeyForm } from "./ApiKey.tsx";
import { ChatGptPlanCard, ClaudePlanCard } from "./ConnectionCards.tsx";
import { InstallLocal } from "./InstallLocal.tsx";
import { LocalModelSetup } from "./LocalModelSetup.tsx";
import { Select, type SelectOption } from "./Select.tsx";
import { Badge, Button } from "./components.tsx";
import { t } from "../i18n.tsx";

/**
 * "Which AI do you have?" — one dropdown, then only the setup for that choice.
 * Used in onboarding (choose and start) and in Settings (switch; the current choice is marked).
 */

export type Choice = Provider | "demo";

export function ConnectionPicker({
  mode,
  active,
  onChosen,
}: {
  mode: "onboarding" | "settings";
  /** Settings: what the app uses now. */
  active?: Choice;
  /** The choice is connected and should become the app's provider. */
  onChosen: (c: Choice) => void;
}) {
  const local = localServer();
  const [choice, setChoice] = useState<Choice | "">(mode === "settings" ? (active ?? "") : "");
  const inUse = (c: Choice) => (mode === "settings" && active === c ? ` · ${t("בשימוש עכשיו", "in use now")}` : "");

  const options: SelectOption[] = [
    { value: "chatgpt", label: t("מנוי ChatGPT", "ChatGPT plan") + inUse("chatgpt"), hint: t("Plus או Pro · התחברות דרך OpenAI", "Plus or Pro · sign in through OpenAI") },
    ...(!local || local.features.claudeCode
      ? [{ value: "claude-code", label: t("מנוי Claude", "Claude plan") + inUse("claude-code"), hint: t("Pro או Max · דרך Claude Code הרשמי", "Pro or Max · through the official Claude Code") }]
      : []),
    { value: "claude", label: t("מפתח API של Claude", "Claude API key") + inUse("claude"), hint: t("תשלום לפי שימוש · console.anthropic.com", "Pay as you go · console.anthropic.com") },
    { value: "local", label: t("מודל חינמי על המחשב", "Free model on this computer") + inUse("local"), hint: t("Ollama או LM Studio · בלי עלות, חלש יותר בעברית", "Ollama or LM Studio · no cost, weaker in Hebrew") },
    ...(mode === "settings"
      ? [{ value: "hybrid", label: t("היברידי", "Hybrid") + inUse("hybrid"), hint: t("מודל מקומי לעבודה המהירה, Claude להסברים ולמבחנים", "A local model for fast work, Claude for explanations and exams") }]
      : [{ value: "demo", label: t("רק לנסות", "Just try it"), hint: t("מצב הדגמה · תשובות מוקלטות, בלי חיבור", "Demo mode · prerecorded answers, nothing to connect") }]),
  ];

  const startLabel = mode === "onboarding" ? t("סיום והתחלה", "Finish and start") : t("שמירה", "Save");

  let panel: ReactNode = null;
  if (choice === "chatgpt" || choice === "claude-code") {
    if (!local) {
      panel = (
        <>
          <p className="mb-3 text-[13px] font-medium text-ink">
            {t("מנוי עובד דרך TutorAI במחשב שלכם. מתקינים פעם אחת:", "A plan works through TutorAI on your computer. Install it once:")}
          </p>
          <InstallLocal />
        </>
      );
    } else if (choice === "chatgpt") {
      panel = <ChatGptPlanCard bare active={active === "chatgpt"} onReady={() => onChosen("chatgpt")} />;
    } else {
      panel = <ClaudePlanCard bare active={active === "claude-code"} onReady={() => onChosen("claude-code")} />;
    }
  } else if (choice === "claude") {
    const hasKey = !!secrets.getApiKey();
    panel = (
      <>
        <p className="mb-3 text-[13px] text-muted">
          {t("צרו מפתח ב-", "Create a key at ")}
          <a className="font-medium text-ink underline underline-offset-2" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
            console.anthropic.com
          </a>{" "}
          {t("והדביקו אותו כאן. המפתח נשמר רק בדפדפן הזה.", "and paste it here. The key is stored only in this browser.")}
        </p>
        {mode === "settings" && hasKey ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-ink-2">{t("יש מפתח שמור.", "A key is saved.")}</span>
            {active !== "claude" && (
              <Button size="sm" onClick={() => onChosen("claude")}>
                {t("שימוש במפתח", "Use the key")}
              </Button>
            )}
            <span className="text-[12.5px] text-muted">{t("להחלפה או מחיקה: למטה.", "To replace or delete it: below.")}</span>
          </div>
        ) : (
          <ApiKeyForm large={mode === "onboarding"} submitLabel={startLabel} onSaved={() => onChosen("claude")} />
        )}
      </>
    );
  } else if (choice === "local" || choice === "hybrid") {
    panel = (
      <>
        {choice === "hybrid" && (
          <p className="mb-3 text-[13px] text-muted">
            {t("ניתוח קבצים, מושגים וכרטיסיות רצים מקומית (רוב השימוש); הסברים, מבחנים ובדיקה לפי מחוון עוברים ל-Claude. צריך גם מפתח API.", "File analysis, concepts and flashcards run locally (most of the usage); explanations, exams and rubric grading go to Claude. Needs an API key too.")}
          </p>
        )}
        <LocalModelSetup saveLabel={startLabel} onSaved={() => onChosen(choice)} />
      </>
    );
  } else if (choice === "demo") {
    panel = (
      <>
        <p className="mb-3 text-[13px] text-muted">
          {t("במצב הדגמה התשובות מוקלטות מראש ולא מבוססות על החומר שלכם. אפשר לחבר AI אמיתי בכל רגע בהגדרות.", "In demo mode, answers are prerecorded and not based on your material. You can connect a real AI any time in Settings.")}
        </p>
        <Button size="lg" className="w-full" onClick={() => onChosen("demo")}>
          <Sparkles size={16} /> {t("כניסה במצב הדגמה", "Start in demo mode")}
        </Button>
      </>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1.5 block text-[13px] font-medium text-ink-2">{t("איזה חשבון AI יש לכם?", "Which AI account do you have?")}</label>
        <Select
          value={choice}
          onChange={(v) => setChoice(v as Choice)}
          options={options}
          placeholder={t("בחרו…", "Choose…")}
          searchable={false}
          aria-label={t("איזה חשבון AI יש לכם?", "Which AI account do you have?")}
        />
      </div>
      {panel && (
        <div className="rounded-2xl border border-black/10 bg-white p-4 sm:p-5">
          {mode === "settings" && choice && active === choice && (
            <div className="mb-3">
              <Badge color="green">{t("בשימוש עכשיו", "In use now")}</Badge>
            </div>
          )}
          {panel}
        </div>
      )}
    </div>
  );
}
