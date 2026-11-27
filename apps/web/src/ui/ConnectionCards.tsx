import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import type { Connections, Settings } from "@tutorai/local-api";
import { localApi, localServer } from "../platform/local-server.ts";
import { Alert, Badge, Button, Modal, errorMessage } from "./components.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import { t } from "../i18n.tsx";

/**
 * TutorAI Local: connect the student's own Claude plan (through the official Claude Code)
 * or ChatGPT plan (through Sign in with ChatGPT). Used in onboarding and in Settings.
 */

const ANTHROPIC_TERMS = "https://code.claude.com/docs/en/legal-and-compliance";
const CHATGPT_USAGE = "https://chatgpt.com/settings/usage";
const GIT_FOR_WINDOWS = "https://git-scm.com/download/win";
const CLAUDE_CODE_DOCS = "https://code.claude.com/docs/en/setup";

function useConnections() {
  const [c, setC] = useState<Connections | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = async (fresh = false) => {
    try {
      setC(await localApi.connections(fresh));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  return { c, error, refresh };
}

/** Polls until check() is true or the time runs out. */
function usePoll() {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => void (timer.current && clearInterval(timer.current)), []);
  return (check: () => Promise<boolean>, everyMs: number, maxMs: number, onTimeout?: () => void) => {
    if (timer.current) clearInterval(timer.current);
    const until = Date.now() + maxMs;
    timer.current = setInterval(async () => {
      if (await check().catch(() => false)) {
        clearInterval(timer.current!);
        timer.current = null;
      } else if (Date.now() > until) {
        clearInterval(timer.current!);
        timer.current = null;
        onTimeout?.();
      }
    }, everyMs);
  };
}

function CopyLine({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2 font-mono text-[12.5px]" dir="ltr">
      <span className="min-w-0 flex-1 truncate">{text}</span>
      <button
        type="button"
        className="cursor-pointer text-muted hover:text-ink"
        aria-label={t("העתקה", "Copy")}
        onClick={async () => {
          await navigator.clipboard.writeText(text).catch(() => {});
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
      >
        {done ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

function Step({ done, busy, title, children }: { done: boolean; busy?: boolean; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${done ? "bg-ink text-white" : "border border-black/20 text-muted"}`}>
        {done ? <Check size={12} /> : busy ? <Loader2 size={12} className="animate-spin" /> : null}
      </span>
      <div className="min-w-0 flex-1">
        <div className={`text-[13.5px] ${done ? "text-muted" : "font-medium text-ink"}`}>{title}</div>
        {!done && children}
      </div>
    </li>
  );
}

/* ---------------- Claude plan ---------------- */

export function ClaudePlanCard({ onReady, active, bare }: { onReady: () => void; active?: boolean; bare?: boolean }) {
  const { c, error, refresh } = useConnections();
  const poll = usePoll();
  const [consent, setConsent] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [installError, setInstallError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [manual, setManual] = useState<string | null>(null);
  const cc = c?.claudeCode;
  const ready = !!cc?.installed && cc.versionOk && cc.loggedIn;

  const install = async () => {
    setInstalling(true);
    setInstallError(null);
    setInstallLog([]);
    try {
      await localApi.installClaudeCode((e) => {
        if (e.type === "log") setInstallLog((l) => [...l.slice(-200), e.line]);
        else if (!e.ok) setInstallError(e.error ?? "failed");
      });
    } catch (e) {
      setInstallError(errorMessage(e));
    }
    setInstalling(false);
    await refresh(true);
  };

  const signIn = async () => {
    setSigningIn(true);
    try {
      const r = await localApi.claudeLogin();
      if (!r.started) setManual(r.manualCommand);
    } catch (e) {
      setInstallError(errorMessage(e));
    }
    poll(
      async () => {
        const next = await localApi.connections(true);
        if (next.claudeCode.loggedIn) {
          await refresh();
          setSigningIn(false);
          return true;
        }
        return false;
      },
      2000,
      5 * 60_000,
      () => {
        setSigningIn(false);
        setManual("claude auth login");
      },
    );
  };

  return (
    <div className={bare ? "" : "rounded-2xl border border-black/10 bg-white p-5"}>
      {!bare && (
        <div className="mb-1.5 flex items-center gap-2">
          <h3 className="text-[15px] font-semibold">{t("יש לי מנוי Claude", "I have a Claude plan")}</h3>
          <Badge>Pro / Max</Badge>
          {active && ready && <Badge color="green">{t("פעיל", "Active")}</Badge>}
        </div>
      )}
      <p className="text-[13px] text-muted">
        {t(
          "TutorAI משתמש ב-Claude Code הרשמי של Anthropic, שמחובר לחשבון שלכם. השימוש נספר במגבלות המנוי שלכם, והשימוש שלכם ב-Claude Code כפוף ל",
          "TutorAI uses Anthropic's official Claude Code, signed in to your account. Usage counts against your plan's limits, and your use of Claude Code is subject to ",
        )}
        <a className="underline" href={ANTHROPIC_TERMS} target="_blank" rel="noreferrer">
          {t("תנאים של Anthropic", "Anthropic's terms")}
        </a>
        .
      </p>
      {error && (
        <div className="mt-3">
          <Alert kind="error">{error}</Alert>
        </div>
      )}
      {!c ? (
        <div className="mt-4 text-[13px] text-muted">{t("בודק…", "Checking…")}</div>
      ) : (
        <ol className="mt-4 space-y-3">
          <Step done={!!cc?.installed && cc.versionOk} busy={installing} title={t("Claude Code מותקן", "Claude Code is installed")}>
            {cc?.needsGitBash ? (
              <p className="mt-1 text-[12.5px] text-muted">
                {t("ב-Windows צריך קודם את Git for Windows. ", "On Windows, Claude Code needs Git for Windows first. ")}
                <a className="underline" href={GIT_FOR_WINDOWS} target="_blank" rel="noreferrer">
                  {t("להורדה", "Download it")}
                </a>
                {t(", התקינו ולחצו כאן:", ", install it, then press:")}{" "}
                <button className="cursor-pointer underline" onClick={() => void refresh(true)}>
                  {t("בדיקה חוזרת", "Check again")}
                </button>
              </p>
            ) : cc?.installed && !cc.versionOk ? (
              <p className="mt-1 text-[12.5px] text-muted">
                {t(`הגרסה המותקנת (${cc.version ?? "?"}) ישנה. עדכנו אותה:`, `The installed version (${cc.version ?? "?"}) is too old. Update it:`)}
                <CopyLine text="claude update" />
              </p>
            ) : (
              <div className="mt-1.5 space-y-2">
                {cc?.hint === "reinstall-official" && (
                  <p className="text-[12.5px] text-muted">{t("נמצאה התקנה דרך npm. TutorAI צריך את המתקין הרשמי.", "Found an npm install. TutorAI needs the official installer.")}</p>
                )}
                <label className="flex items-start gap-2 text-[12.5px] text-muted">
                  <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span>
                    {t("להריץ את המתקין הרשמי של Anthropic:", "Run Anthropic's official installer:")}
                    <code className="ms-1 rounded bg-black/5 px-1" dir="ltr">
                      {localServer()?.platform === "win32" ? "irm https://claude.ai/install.ps1 | iex" : "curl -fsSL https://claude.ai/install.sh | bash"}
                    </code>
                  </span>
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" disabled={!consent || installing} onClick={() => void install()}>
                    {installing ? t("מתקין…", "Installing…") : t("התקנת Claude Code", "Install Claude Code")}
                  </Button>
                  <a className="text-[12.5px] text-muted underline" href={CLAUDE_CODE_DOCS} target="_blank" rel="noreferrer">
                    {t("להתקין בעצמי", "Install it myself")}
                  </a>
                  <button className="cursor-pointer text-[12.5px] text-muted underline" onClick={() => void refresh(true)}>
                    {t("בדיקה חוזרת", "Check again")}
                  </button>
                </div>
                {installLog.length > 0 && (
                  <pre className="max-h-40 overflow-auto rounded-lg bg-black/[0.04] p-2 text-[11.5px] leading-snug" dir="ltr">
                    {installLog.join("\n")}
                  </pre>
                )}
                {installError && <Alert kind="error">{installError === "git-for-windows" ? t("צריך קודם את Git for Windows.", "Git for Windows is needed first.") : installError}</Alert>}
              </div>
            )}
          </Step>
          <Step done={!!cc?.loggedIn} busy={signingIn} title={t("מחוברים לחשבון Claude", "Signed in to your Claude account")}>
            {cc?.installed && cc.versionOk && (
              <div className="mt-1.5 space-y-2">
                {signingIn ? (
                  <p className="text-[12.5px] text-muted">{t("סיימו את ההתחברות בדפדפן (דף של Anthropic). הדף הזה יתעדכן לבד.", "Finish signing in in your browser (an Anthropic page). This page updates by itself.")}</p>
                ) : (
                  <Button size="sm" onClick={() => void signIn()}>
                    {t("התחברות לחשבון Claude", "Sign in with your Claude account")}
                  </Button>
                )}
                {manual && (
                  <div className="text-[12.5px] text-muted">
                    {t("אם לא נפתח דף התחברות, הריצו בטרמינל:", "If no sign-in page opened, run this in Terminal:")}
                    <CopyLine text={manual} />
                  </div>
                )}
              </div>
            )}
          </Step>
          <Step done={false} title={ready ? t("מוכן", "Ready") : t("מוכן לשימוש", "Ready to use")}>
            {ready && (
              <div className="mt-2">
                <ModelPicker kind="claude-code" />
              </div>
            )}
            {ready && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={onReady}>
                  {active ? t("בשימוש", "In use") : t("שימוש במנוי Claude", "Use my Claude plan")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await localApi.claudeLogout();
                    await refresh(true);
                  }}
                >
                  {t("התנתקות", "Sign out")}
                </Button>
              </div>
            )}
          </Step>
        </ol>
      )}
    </div>
  );
}

/* ---------------- ChatGPT plan ---------------- */

export function ChatGptPlanCard({ onReady, active, bare }: { onReady: () => void; active?: boolean; bare?: boolean }) {
  const { c, error, refresh } = useConnections();
  const poll = usePoll();
  const [waiting, setWaiting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [welcome, setWelcome] = useState(false);
  const signedIn = !!c?.chatgpt.signedIn;

  const start = async () => {
    setProblem(null);
    // Open the tab inside the click, then point it at OpenAI (popup blockers allow this).
    const tab = window.open("about:blank", "_blank");
    try {
      const { authorizeUrl } = await localApi.chatgptStart();
      if (tab) tab.location.href = authorizeUrl;
      else window.location.assign(authorizeUrl);
    } catch (e) {
      tab?.close();
      setProblem(errorMessage(e));
      return;
    }
    setWaiting(true);
    poll(
      async () => {
        const next = await localApi.connections();
        if (!next.chatgpt.signedIn) return false;
        await refresh();
        setWaiting(false);
        const s: Settings = await localApi.settings();
        if (!s.chatgptWelcomeShown) setWelcome(true);
        return true;
      },
      2000,
      10 * 60_000,
      () => setWaiting(false),
    );
  };

  return (
    <div className={bare ? "" : "rounded-2xl border border-black/10 bg-white p-5"}>
      {!bare && (
        <div className="mb-1.5 flex items-center gap-2">
          <h3 className="text-[15px] font-semibold">{t("יש לי מנוי ChatGPT", "I have a ChatGPT plan")}</h3>
          <Badge>Plus / Pro</Badge>
          {active && signedIn && <Badge color="green">{t("פעיל", "Active")}</Badge>}
        </div>
      )}
      <p className="text-[13px] text-muted">
        {t(
          "התחברות דרך OpenAI. בקשות ה-AI ב-TutorAI ישתמשו במנוי ChatGPT שלכם. ב-Plus מגבלת 5 השעות משותפת לכל האפליקציות.",
          "Sign in through OpenAI. AI requests in TutorAI will use your ChatGPT plan. On Plus, the 5-hour limit is shared across all apps.",
        )}
      </p>
      {(error || problem) && (
        <div className="mt-3">
          <Alert kind="error">{error ?? problem}</Alert>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!c ? (
          <span className="text-[13px] text-muted">{t("בודק…", "Checking…")}</span>
        ) : signedIn ? (
          <>
            <span className="text-[13px] text-ink-2">{t("מחוברים", "Signed in")}{c.chatgpt.email ? ` · ${c.chatgpt.email}` : ""}</span>
            <Button size="sm" onClick={onReady}>
              {active ? t("בשימוש", "In use") : t("שימוש במנוי ChatGPT", "Use my ChatGPT plan")}
            </Button>
            <a className="inline-flex items-center gap-1 text-[12.5px] text-muted underline" href={CHATGPT_USAGE} target="_blank" rel="noreferrer">
              {t("שימוש במנוי", "Plan usage")} <ExternalLink size={12} />
            </a>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const r = await localApi.chatgptLogout();
                if (!r.revoked) setProblem(t("התנתקתם כאן, אבל לא הצלחנו לבטל את הגישה מול OpenAI. אפשר לנתק את TutorAI בהגדרות של ChatGPT.", "Signed out here, but revoking access at OpenAI wasn't confirmed. You can disconnect TutorAI in ChatGPT settings."));
                await refresh();
              }}
            >
              {t("התנתקות", "Sign out")}
            </Button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void start()}
              disabled={waiting}
              className="inline-flex h-9 cursor-pointer items-center rounded-full bg-black px-4 text-[13.5px] font-medium text-white disabled:opacity-60"
            >
              Continue with ChatGPT
            </button>
            {waiting && <span className="text-[12.5px] text-muted">{t("סיימו את ההתחברות בלשונית החדשה…", "Finish signing in in the new tab…")}</span>}
          </>
        )}
      </div>
      <Modal
        open={welcome}
        onClose={async () => {
          setWelcome(false);
          await localApi.saveSettings({ chatgptWelcomeShown: true }).catch(() => {});
        }}
        title={t("אתם משתמשים במנוי ChatGPT שלכם", "You're using your ChatGPT plan")}
      >
        <p className="text-[14px] text-ink-2">
          {t(
            "בקשות ה-AI ב-TutorAI ישתמשו במנוי ChatGPT שלכם או ביתרת הקרדיטים. אפשר לראות ולנהל את השימוש בהגדרות של ChatGPT.",
            "Eligible AI requests in TutorAI will use your ChatGPT plan or credits. You can review and manage usage in ChatGPT settings.",
          )}
        </p>
        <div className="mt-4 flex gap-2">
          <Button
            onClick={async () => {
              setWelcome(false);
              await localApi.saveSettings({ chatgptWelcomeShown: true }).catch(() => {});
            }}
          >
            {t("הבנתי", "Got it")}
          </Button>
          <a href={CHATGPT_USAGE} target="_blank" rel="noreferrer">
            <Button variant="secondary">{t("שימוש במנוי", "Plan usage")}</Button>
          </a>
        </div>
      </Modal>
    </div>
  );
}
