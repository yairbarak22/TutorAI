import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Download, ExternalLink, FileText, Paperclip } from "lucide-react";
import { sectionIdFromKey } from "@tutorai/core";
import { useEngine } from "../engine.ts";
import { Button, Modal, Spinner } from "./components.tsx";
import { t } from "../i18n.tsx";

const Ctx = createContext<{ open: (id: string) => void }>({ open: () => {} });
export const useCitations = () => useContext(Ctx);

/** Lets any rendered citation open the exact page/slide it points to. */
export function CitationProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<string | null>(null);
  const open = useCallback((k: string) => setId(k), []);
  return (
    <Ctx.Provider value={{ open }}>
      {children}
      {id && <SourceViewer sectionKey={id} onClose={() => setId(null)} />}
    </Ctx.Provider>
  );
}

function SourceViewer({ sectionKey, onClose }: { sectionKey: string; onClose: () => void }) {
  const engine = useEngine();
  const section = engine.store.section(sectionIdFromKey(sectionKey));
  const source = section ? engine.store.source(section.source_id) : undefined;
  const isPdf = !!source?.name.toLowerCase().endsWith(".pdf");
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [showText, setShowText] = useState(false);

  // The original file, as an inert blob URL (PDFs open at the cited page via #page=N).
  useEffect(() => {
    if (!source || !section) return;
    let alive = true;
    let made: string | null = null;
    engine
      .sourceUrl(source.id, section.page)
      .then((u) => {
        made = u.split("#")[0];
        if (alive) setUrl(u);
        else URL.revokeObjectURL(made);
      })
      .catch(() => alive && setMissing(true));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [sectionKey]);

  const title = source ? `${source.name} · ${section!.anchor}` : t("מקור", "Source");
  if (!section || !source)
    return (
      <Modal open onClose={onClose} title={title}>
        <p>{t("המקור לא נמצא (ייתכן שהקובץ נמחק).", "Source not found (the file may have been deleted).")}</p>
      </Modal>
    );

  const pdfView = isPdf && !missing && !showText;
  return (
    <Modal open onClose={onClose} title={title} huge={pdfView} wide={!pdfView}>
      {pdfView ? (
        url ? (
          <iframe title={title} src={url} className="h-[74vh] w-full rounded-xl border border-black/[0.08] bg-black/[0.03]" />
        ) : (
          <div className="grid h-[74vh] place-items-center">
            <Spinner label={t("פותח את הקובץ…", "Opening the file…")} />
          </div>
        )
      ) : (
        <SectionText title={section.title} text={section.text} />
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {url && isPdf && (
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-black/10 px-3.5 text-[13.5px] font-medium hover:bg-hover">
            <ExternalLink size={15} /> {t("פתיחה בלשונית חדשה", "Open in a new tab")}
          </a>
        )}
        {url && !isPdf && (
          <a href={url} download={source.name} className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-black/10 px-3.5 text-[13.5px] font-medium hover:bg-hover">
            <Download size={15} /> {t("הורדת הקובץ המקורי", "Download the original file")}
          </a>
        )}
        {isPdf && !missing && (
          <Button variant="ghost" onClick={() => setShowText(!showText)}>
            <FileText size={15} /> {showText ? t("חזרה לקובץ", "Back to the file") : t("גרסת טקסט", "Text version")}
          </Button>
        )}
        {missing && <span className="text-xs text-muted">{t("הקובץ המקורי לא נמצא בתיקייה, מוצג הטקסט שחולץ ממנו.", "The original file isn't in the folder; showing the text extracted from it.")}</span>}
      </div>
    </Modal>
  );
}

/** The extracted text of one page / slide / section, for files the browser can't display. */
function SectionText({ title, text }: { title: string; text: string }) {
  return (
    <div className="max-h-[62vh] overflow-y-auto rounded-xl border border-black/[0.06] px-5 py-4">
      {title && <h3 className="mb-2 text-[15px] font-semibold">{title}</h3>}
      <p dir="auto" className="whitespace-pre-line text-[14px] leading-7 text-ink-2">
        {text}
      </p>
    </div>
  );
}

export function CitationChips({ ids }: { ids: string[] }) {
  const { open } = useCitations();
  const engine = useEngine();
  if (!ids.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {ids.map((k) => {
        const s = engine.store.section(sectionIdFromKey(k));
        const src = s ? engine.store.source(s.source_id) : undefined;
        return (
          <button
            key={k}
            type="button"
            onClick={() => open(k)}
            data-testid="cite-chip"
            className="inline-flex items-center gap-1 rounded-full border border-black/[0.08] bg-white px-2.5 py-0.5 text-[12px] text-ink-2 transition hover:border-black/20 hover:bg-hover"
            title={src ? `${src.name} · ${s!.anchor}` : k}
          >
            <Paperclip size={11} className="text-muted" /> {src ? `${shortName(src.name)} · ${s!.anchor}` : k}
          </button>
        );
      })}
    </div>
  );
}

const shortName = (n: string) => {
  const base = n.replace(/\.[^.]+$/, "");
  return base.length > 26 ? base.slice(0, 24) + "…" : base;
};
