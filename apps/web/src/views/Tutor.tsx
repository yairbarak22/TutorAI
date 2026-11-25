import { useEffect, useRef, useState } from "react";
import { Thinking } from "../ui/LongTask.tsx";
import { MessagesSquare, SquarePen } from "lucide-react";
import { extractInlineCitations, type ChatTurn } from "@ruecai/sdk";
import { useEngine } from "../engine.ts";
import { Alert, Button, Card, Spinner, errorMessage, inputClass } from "../ui/components.tsx";
import { Markdown } from "../ui/Markdown.tsx";
import { CitationChips } from "../ui/Citations.tsx";
import { getTool } from "@ruecai/plugins";
import { t, toolText } from "../i18n.tsx";

const modeInput = () => getTool("tutor").manifest.inputs.find((i) => i.name === "mode");
const starters = () => [
  t("תסביר לי את המושג הכי חשוב בקורס", "Explain the most important concept in the course"),
  t("על מה כדאי לי לחזור לקראת המבחן?", "What should I review before the exam?"),
  t("תבחן אותי על החומר", "Quiz me on the material"),
  t("לא הבנתי את השיעור האחרון", "I didn't understand the last lesson"),
];

export function Tutor({ courseId }: { courseId: number }) {
  const engine = useEngine();
  const chat = engine.store.chat(courseId);
  const [messages, setMessages] = useState<ChatTurn[]>(chat.messages);
  const [input, setInput] = useState("");
  const tutorManifest = getTool("tutor").manifest;
  const modes = modeInput()?.options ?? [];
  const [mode, setMode] = useState<string>(() => String(modeInput()?.default ?? modes[0] ?? ""));
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, streaming]);

  const send = async (text: string) => {
    if (!text.trim() || streaming !== null) return;
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
      engine.store.saveChat(chat.id, done);
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
      q = sessionStorage.getItem(`ruecai.ask.${courseId}`);
      sessionStorage.removeItem(`ruecai.ask.${courseId}`);
    } catch {
      /* ignore */
    }
    if (q) void send(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasMaterial = engine.store.sources(courseId).some((s) => s.status === "ready");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-600">{t("מצב:", "Mode:")}</span>
        {modes.map((m) => (
          <button key={m} onClick={() => setMode(m)} className={`rounded-full px-3 py-1 text-sm ${mode === m ? "bg-brand-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"}`}>
            {toolText(tutorManifest).option("mode", m)}
          </button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          className="ms-auto"
          onClick={() => {
            engine.store.newChat(courseId);
            setMessages([]);
          }}
        >
          <SquarePen size={14} /> {t("שיחה חדשה", "New chat")}
        </Button>
      </div>

      {!hasMaterial && <Alert kind="info">{t("המורה הפרטי עונה מתוך החומרים שלכם. העלו קבצים כדי לקבל תשובות עם ציטוטים.", "The tutor answers from your materials. Upload files to get answers with citations.")}</Alert>}

      <div className="space-y-3" aria-live="polite">
        {messages.length === 0 && streaming === null && (
          <Card className="p-6 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl tile-grad-1 text-ink/80"><MessagesSquare size={26} strokeWidth={1.7} /></div>
            <p className="mt-2 font-semibold">{t("על מה נלמד היום?", "What shall we learn today?")}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {starters().map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full bg-brand-50 px-3 py-1.5 text-sm text-brand-700 hover:bg-brand-100">
                  {s}
                </button>
              ))}
            </div>
          </Card>
        )}
        {messages.map((m, i) => (
          <Bubble key={i} turn={m} />
        ))}
        {streaming !== null && (streaming ? <Bubble turn={{ role: "assistant", content: streaming }} /> : <TutorThinking />)}
        <div ref={bottom} />
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <form
        className="sticky bottom-3 flex gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          rows={1}
          className={`${inputClass} resize-none border-0 focus:ring-0`}
          placeholder={t("שאלו כל דבר על החומר…", "Ask anything about the material…")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          aria-label={t("הודעה למורה הפרטי", "Message to the tutor")}
        />
        <Button type="submit" disabled={!input.trim() || streaming !== null}>
          {t("שליחה", "Send")}
        </Button>
      </form>
    </div>
  );
}

function Bubble({ turn }: { turn: ChatTurn }) {
  const mine = turn.role === "user";
  return (
    <div className={`flex ${mine ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${mine ? "bg-brand-600 text-white" : "border border-slate-200 bg-white"}`} data-testid={mine ? "msg-user" : "msg-assistant"}>
        {mine ? <p className="whitespace-pre-wrap" dir="auto">{turn.content}</p> : <Markdown text={turn.content} />}
        {!mine && <CitationChips ids={extractInlineCitations(turn.content)} />}
      </div>
    </div>
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
  return (
    <div className="rounded-2xl bg-[#f7f7f7] px-4 py-3">
      <Thinking label={label} />
    </div>
  );
}
