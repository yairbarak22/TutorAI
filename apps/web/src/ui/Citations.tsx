import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Paperclip } from "lucide-react";
import { sectionIdFromKey } from "@ruecai/core";
import { useEngine } from "../engine.ts";
import { Button, Modal } from "./components.tsx";
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
  return (
    <Modal open onClose={onClose} title={source ? `${source.name} · ${section!.anchor}` : t("מקור", "Source")} wide>
      {!section || !source ? (
        <p>{t("המקור לא נמצא (ייתכן שהקובץ נמחק).", "Source not found (the file may have been deleted).")}</p>
      ) : (
        <div className="space-y-3">
          {section.title && <h3 className="text-lg font-semibold">{section.title}</h3>}
          <pre dir="auto" className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 font-sans text-sm leading-7">
            {section.text}
          </pre>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  window.open(await engine.sourceUrl(source.id, section.page), "_blank", "noopener");
                } catch {
                  alert(t("הקובץ המקורי לא נמצא בתיקייה.", "The original file was not found in the folder."));
                }
              }}
            >
              {t("פתח את הקובץ המקורי", "Open the original file")}{" "}
              {section.page && source.name.toLowerCase().endsWith(".pdf") ? t(`בעמוד ${section.page}`, `at page ${section.page}`) : ""}
            </Button>
          </div>
        </div>
      )}
    </Modal>
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
