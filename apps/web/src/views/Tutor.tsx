import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Check, Copy, GraduationCap, History, SquarePen, Trash2, User } from "lucide-react";
import { extractInlineCitations, type ChatTurn } from "@tutorai/sdk";
import type { ChatSummary } from "@tutorai/core";
import { getTool } from "@tutorai/plugins";
import { useEngine } from "../engine.ts";
import { Alert, Modal, errorMessage } from "../ui/components.tsx";
import { Markdown } from "../ui/Markdown.tsx";
import { CitationChips } from "../ui/Citations.tsx";
import { Thinking } from "../ui/LongTask.tsx";
import { Select } from "../ui/Select.tsx";
import { t, toolText } from "../i18n.tsx";

const modeInput = () => getTool("tutor").manifest.inputs.find((i) => i.name === "mode");
const starters = () => [
  t("תסביר לי את המושג הכי חשוב בקורס", "Explain the most important concept in the course"),
  t("על מה כדאי לי לחזור לקראת המבחן?", "What should I review before the exam?"),
  t("תבחן אותי על החומר", "Quiz me on the material"),
  t("לא הבנתי את השיעור האחרון", "I didn't understand the last lesson"),
];

/**
 * The private tutor: a conversation in one reading column (no bubbles), with the course's past
 * conversations beside it. A new conversation is saved only once it has a first exchange.
 */
export function Tutor({ courseId }: { courseId: number }) {
  const engine = useEngine();
  const [chatId, setChatId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const modes = modeInput()?.options ?? [];
  const [mode, setMode] = useState<string>(() => String(modeInput()?.default ?? modes[0] ?? ""));
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const chats = engine.store.chats(courseId);
  const bottom = useRef<HTMLDivElement>(null);
  const busy = streaming !== null;

  useEffect(() => {
    if (messages.length) bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, streaming]);

  const open = (id: number | null) => {
    if (busy) return;
    setError(null);
    setHistoryOpen(false);
    setChatId(id);
    setMessages(id === null ? [] : (engine.store.chatById(id)?.messages ?? []));
    window.scrollTo({ top: 0 });
  };

  const remove = (c: ChatSummary) => {
    if (!confirm(t(`למחוק את השיחה "${c.title}"?`, `Delete the conversation "${c.title}"?`))) return;
    engine.store.deleteChat(c.id);
    if (c.id === chatId) open(null);
  };

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setError(null);
    setInput("");
    const history = messages.slice(-20);
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setStreaming("");
    try {
      const reply = await engine.chat(courseId, text, history, mode, (d) => setStreaming((s) => (s ?? "") + d));
      const done = [...next, { role: "assistant" as const, content: reply.text }];
      setMessages(done);
      if (chatId === null) setChatId(engine.store.createChat(courseId, done));
      else engine.store.saveChat(chatId, done);
    } catch (e) {
      setError(errorMessage(e));
      setMessages(messages);
      setInput(text);
    } finally {
      setStreaming(null);
    }
  };

  // A question typed in the Home prompt box. It is handed over through sessionStorage (same tab,
  // set only by our own form), never through the URL, so an outside link can't make the tutor
  // spend the student's API key.
  const handed = useRef(false);
  useEffect(() => {
    if (handed.current) return;
    handed.current = true;
    let q: string | null = null;
    try {
      q = sessionStorage.getItem(`tutorai.ask.${courseId}`);
      sessionStorage.removeItem(`tutorai.ask.${courseId}`);
    } catch {
      /* ignore */
    }
    if (q) void send(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasMaterial = engine.store.sources(courseId).some((s) => s.status === "ready");
  const empty = messages.length === 0 && !busy;
  const composer = (
    <Composer
      value={input}
      onChange={setInput}
      onSend={() => void send(input)}
      busy={busy}
      autoFocus={empty}
      mode={mode}
      onMode={setMode}
      modes={modes}
    />
  );
  const historyList = <ChatHistory chats={chats} current={chatId} disabled={busy} onOpen={open} onDelete={remove} />;

  return (
    <div className="flex gap-8">
      <aside className="sticky top-4 hidden max-h-[calc(100vh-6rem)] w-60 shrink-0 self-start overflow-y-auto lg:block" aria-label={t("שיחות קודמות", "Past conversations")}>
        {historyList}
      </aside>

      <div className="mx-auto flex min-h-[calc(100vh-14rem)] w-full max-w-[760px] min-w-0 flex-col">
        <div className="mb-2 flex items-center gap-1 lg:hidden">
          <button type="button" onClick={() => setHistoryOpen(true)} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-ink-2 hover:bg-hover">
            <History size={15} /> {t("שיחות קודמות", "Past conversations")}
          </button>
          {!empty && (
            <button type="button" onClick={() => open(null)} disabled={busy} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-ink-2 hover:bg-hover disabled:opacity-40">
              <SquarePen size={15} /> {t("שיחה חדשה", "New chat")}
            </button>
          )}
        </div>
        <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title={t("שיחות קודמות", "Past conversations")}>
          {historyList}
        </Modal>

        {empty ? (
          <div className="flex flex-1 flex-col justify-center py-10">
            <h2 className="text-center text-[26px] font-semibold tracking-tight">{t("על מה נלמד היום?", "What shall we learn today?")}</h2>
            <p className="mt-2 mb-6 text-center text-sm text-muted">
              {t("המורה הפרטי עונה מתוך החומרים של הקורס, עם הפניה לעמוד או לשקף.", "The tutor answers from your course materials, citing the page or slide.")}
            </p>
            {!hasMaterial && (
              <div className="mb-4">
                <Alert kind="info">{t("עוד אין חומר מעובד בקורס. העלו קבצים כדי לקבל תשובות עם ציטוטים.", "No processed material yet. Upload files to get answers with citations.")}</Alert>
              </div>
            )}
            {error && (
              <div className="mb-4">
                <Alert kind="error">{error}</Alert>
              </div>
            )}
            {composer}
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {starters().map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="cursor-pointer rounded-xl border border-black/[0.08] px-4 py-3 text-start text-[13.5px] text-ink-2 transition hover:border-black/20 hover:bg-hover"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 divide-y divide-black/[0.05]" aria-live="polite">
              {messages.map((m, i) => (
                <Message key={i} turn={m} />
              ))}
              {busy && (streaming ? <Message turn={{ role: "assistant", content: streaming }} streaming /> : <Message thinking turn={{ role: "assistant", content: "" }} />)}
            </div>
            <div ref={bottom} />
            <div className="sticky bottom-0 bg-gradient-to-t from-white via-white to-transparent pt-6 pb-3">
              {error && (
                <div className="mb-3">
                  <Alert kind="error">{error}</Alert>
                </div>
              )}
              {composer}
              <p className="mt-2 text-center text-[11.5px] text-muted">
                {t("התשובות מבוססות על חומרי הקורס ועלולות לטעות. כדאי לבדוק את המקורות.", "Answers are based on your course materials and can be wrong. Check the cited sources.")}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */

function Message({ turn, streaming, thinking }: { turn: ChatTurn; streaming?: boolean; thinking?: boolean }) {
  const mine = turn.role === "user";
  const [copied, setCopied] = useState(false);
  return (
    <article className="group py-6 first:pt-2" data-testid={mine ? "msg-user" : "msg-assistant"}>
      <header className="mb-2 flex items-center gap-2.5 text-[13px] font-semibold text-ink">
        {mine ? (
          <span className="grid h-7 w-7 place-items-center rounded-full bg-black/[0.06] text-ink-2">
            <User size={15} />
          </span>
        ) : (
          <span className="tile-grad-1 grid h-7 w-7 place-items-center rounded-full text-ink/80">
            <GraduationCap size={15} />
          </span>
        )}
        {mine ? t("אתם", "You") : t("המורה הפרטי", "Tutor")}
      </header>
      <div className="ps-[38px] text-[15px] leading-7">
        {thinking ? (
          <TutorThinking />
        ) : mine ? (
          <p className="whitespace-pre-wrap text-ink" dir="auto">
            {turn.content}
          </p>
        ) : (
          <>
            <Markdown text={turn.content} />
            {!streaming && <CitationChips ids={extractInlineCitations(turn.content)} />}
            {!streaming && (
              <div className="mt-2 flex opacity-0 transition group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(turn.content);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs text-muted hover:bg-hover hover:text-ink"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? t("הועתק", "Copied") : t("העתקה", "Copy")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
}

function Composer({
  value,
  onChange,
  onSend,
  busy,
  autoFocus,
  mode,
  onMode,
  modes,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  autoFocus?: boolean;
  mode: string;
  onMode: (m: string) => void;
  modes: string[];
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const manifest = getTool("tutor").manifest;
  // Grow with the text (up to a limit), and re-measure when the width changes.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "0px";
      el.style.height = `${Math.min(Math.max(el.scrollHeight, 40), 220)}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [value]);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  const canSend = value.trim().length > 0 && !busy;
  return (
    <form
      className="rounded-[26px] border border-black/10 bg-white p-2 shadow-[0_2px_14px_rgba(0,0,0,0.06)] transition focus-within:border-black/25"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSend();
      }}
    >
      <textarea
        ref={ref}
        rows={1}
        dir="auto"
        className="block max-h-[220px] w-full resize-none bg-transparent px-3 py-2 text-[15px] leading-6 placeholder:text-slate-400"
        style={{ outline: "none" }}
        placeholder={t("שאלו כל דבר על החומר…", "Ask anything about the material…")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canSend) onSend();
          }
        }}
        aria-label={t("הודעה למורה הפרטי", "Message to the tutor")}
      />
      <div className="flex items-center justify-between gap-2 ps-1">
        <div className="w-48">
          <Select
            size="sm"
            aria-label={t("מצב המורה", "Tutor mode")}
            value={mode}
            onChange={onMode}
            options={modes.map((m) => ({ value: m, label: toolText(manifest).option("mode", m) }))}
            className="border-transparent bg-transparent hover:bg-hover"
          />
        </div>
        <button
          type="submit"
          disabled={!canSend}
          aria-label={t("שליחה", "Send")}
          className="grid h-9 w-9 cursor-pointer place-items-center rounded-full bg-ink text-white transition hover:bg-black/80 disabled:cursor-not-allowed disabled:bg-black/10 disabled:text-black/30"
        >
          <ArrowUp size={18} />
        </button>
      </div>
    </form>
  );
}

function ChatHistory({
  chats,
  current,
  disabled,
  onOpen,
  onDelete,
}: {
  chats: ChatSummary[];
  current: number | null;
  disabled: boolean;
  onOpen: (id: number | null) => void;
  onDelete: (c: ChatSummary) => void;
}) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const groups: { label: string; items: ChatSummary[] }[] = [
    { label: t("היום", "Today"), items: [] },
    { label: t("7 הימים האחרונים", "Previous 7 days"), items: [] },
    { label: t("קודם לכן", "Older"), items: [] },
  ];
  for (const c of chats) {
    const at = Date.parse(c.updatedAt);
    groups[at >= startOfToday ? 0 : at >= startOfToday - 7 * 86_400_000 ? 1 : 2].items.push(c);
  }
  return (
    <nav className="space-y-4">
      <button
        type="button"
        onClick={() => onOpen(null)}
        disabled={disabled}
        className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40 ${current === null ? "bg-hover" : ""}`}
      >
        <SquarePen size={15} /> {t("שיחה חדשה", "New chat")}
      </button>
      {chats.length === 0 && <p className="px-2.5 text-xs leading-5 text-muted">{t("השיחות שלכם יישמרו כאן.", "Your conversations will be saved here.")}</p>}
      {groups
        .filter((g) => g.items.length)
        .map((g) => (
          <div key={g.label}>
            <div className="mb-1 px-2.5 text-[11.5px] font-medium text-muted">{g.label}</div>
            <ul>
              {g.items.map((c) => (
                <li key={c.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => onOpen(c.id)}
                    disabled={disabled}
                    aria-current={c.id === current ? "true" : undefined}
                    title={c.title}
                    className={`block w-full cursor-pointer truncate rounded-lg py-2 ps-2.5 pe-9 text-start text-[13.5px] text-ink-2 transition hover:bg-hover disabled:cursor-not-allowed ${
                      c.id === current ? "bg-hover font-medium text-ink" : ""
                    }`}
                  >
                    {c.title || t("שיחה", "Conversation")}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(c)}
                    aria-label={t(`מחיקת השיחה ${c.title}`, `Delete conversation ${c.title}`)}
                    className="absolute end-1 top-1/2 grid h-7 w-7 -translate-y-1/2 cursor-pointer place-items-center rounded-md text-slate-400 opacity-0 transition group-hover:opacity-100 hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </nav>
  );
}

/** Before the first word arrives: say what the tutor is doing, not just "thinking". */
function TutorThinking() {
  const [t0] = useState(() => Date.now());
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  const s = (Date.now() - t0) / 1000;
  const label =
    s < 2
      ? t("מחפש בחומר של הקורס", "Searching the course material")
      : s < 6
        ? t("קורא את הקטעים הרלוונטיים", "Reading the relevant passages")
        : s < 15
          ? t("מנסח תשובה עם ציטוטים", "Writing an answer with citations")
          : t("עוד רגע, התשובה כמעט מוכנה", "One moment, the answer is almost ready");
  return <Thinking label={label} />;
}
