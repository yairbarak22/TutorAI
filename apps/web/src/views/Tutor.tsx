import { useEffect, useRef, useState } from "react";
import { MessagesSquare, SquarePen } from "lucide-react";
import { extractInlineCitations, type ChatTurn } from "@ruecai/sdk";
import { useEngine } from "../engine.ts";
import { Alert, Button, Card, Spinner, errorMessage, inputClass } from "../ui/components.tsx";
import { Markdown } from "../ui/Markdown.tsx";
import { CitationChips } from "../ui/Citations.tsx";

const MODES = ["סוקרטי", "הסבר ישיר", "בוחן אותי", "פשוט כמו לילד בן 12"];
const STARTERS = ["תסביר לי את המושג הכי חשוב בקורס", "על מה כדאי לי לחזור לקראת המבחן?", "תבחן אותי על החומר", "לא הבנתי את השיעור האחרון"];

export function Tutor({ courseId }: { courseId: number }) {
  const engine = useEngine();
  const chat = engine.store.chat(courseId);
  const [messages, setMessages] = useState<ChatTurn[]>(chat.messages);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState(MODES[0]);
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

  const hasMaterial = engine.store.sources(courseId).some((s) => s.status === "ready");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-600">מצב:</span>
        {MODES.map((m) => (
          <button key={m} onClick={() => setMode(m)} className={`rounded-full px-3 py-1 text-sm ${mode === m ? "bg-brand-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"}`}>
            {m}
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
          <SquarePen size={14} /> שיחה חדשה
        </Button>
      </div>

      {!hasMaterial && <Alert kind="info">הטוטור עונה מתוך החומרים שלכם. העלו קבצים כדי לקבל תשובות עם ציטוטים.</Alert>}

      <div className="space-y-3" aria-live="polite">
        {messages.length === 0 && streaming === null && (
          <Card className="p-6 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl tile-grad-1 text-ink/80"><MessagesSquare size={26} strokeWidth={1.7} /></div>
            <p className="mt-2 font-semibold">על מה נלמד היום?</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {STARTERS.map((s) => (
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
        {streaming !== null && (streaming ? <Bubble turn={{ role: "assistant", content: streaming }} /> : <Spinner label="חושב…" />)}
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
          placeholder="שאלו כל דבר על החומר…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          aria-label="הודעה לטוטור"
        />
        <Button type="submit" disabled={!input.trim() || streaming !== null}>
          שליחה
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
