import { useEffect, useState } from "react";
import { DEFAULT_CLAUDE_CODE_MODELS, type Settings } from "@tutorai/local-api";
import { CLAUDE_MODELS, RECOMMENDED_MODELS } from "../platform/models.ts";
import { localApi } from "../platform/local-server.ts";
import { secrets } from "../platform/secrets.ts";
import { Select, type SelectOption } from "./Select.tsx";
import { Field, errorMessage } from "./components.tsx";
import { t } from "../i18n.tsx";

type Tier = "smart" | "fast";
type Pair = { fast: string; smart: string };

/**
 * Two dropdowns: which Claude model does the hard work (explanations, exams, tutor) and which does
 * the simple work (reading material, flashcards). Each option says in a few words what it costs.
 * Starts on the recommended pair and saves on every change:
 * an API key in this browser, a Claude plan in TutorAI Local's settings.
 */
export function ModelPicker({ kind, onSaved, wide }: { kind: "claude" | "claude-code"; onSaved?: () => void; /** Side by side (Settings); stacked in narrow cards. */ wide?: boolean }) {
  const [models, setModels] = useState<Pair | null>(kind === "claude" ? (secrets.getModels() ?? { ...RECOMMENDED_MODELS }) : null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== "claude-code") return;
    localApi
      .settings()
      .then((s) => {
        setSettings(s);
        setModels(s.models["claude-code"]);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [kind]);

  if (!models) return error ? <p className="text-[12.5px] text-red-700">{error}</p> : null;

  const save = async (tier: Tier, id: string) => {
    const next = { ...models, [tier]: id };
    setModels(next);
    setError(null);
    try {
      if (kind === "claude") secrets.setModels(next);
      else if (settings) setSettings(await localApi.saveSettings({ models: { ...settings.models, "claude-code": next } }));
      onSaved?.();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const recommended = kind === "claude" ? RECOMMENDED_MODELS : DEFAULT_CLAUDE_CODE_MODELS;
  const options = (tier: Tier): SelectOption[] => {
    const list: SelectOption[] = CLAUDE_MODELS.filter((m) => kind === "claude" || m.plan).map((m) => ({
      value: m.id,
      label: m.name + (m.id === recommended[tier] ? ` · ${t("מומלץ", "recommended")}` : ""),
      hint: kind === "claude" ? m.apiHint() : m.planHint(),
    }));
    // A model saved earlier that isn't in the list (typed by hand before) stays selectable.
    const current = models[tier];
    if (current && !list.some((o) => o.value === current)) list.push({ value: current, label: current, hint: t("מודל שהוגדר ידנית", "Set by hand") });
    return list;
  };

  return (
    <div className="space-y-2">
      <div className={`grid gap-3 ${wide ? "sm:grid-cols-2" : ""}`}>
        <Field label={t("מודל למשימות קשות", "Model for hard tasks")} help={t("הסברים, מבחנים והמורה הפרטי", "Explanations, exams and the tutor")}>
          <Select value={models.smart} onChange={(v) => void save("smart", v)} options={options("smart")} searchable={false} aria-label={t("מודל למשימות קשות", "Model for hard tasks")} />
        </Field>
        <Field label={t("מודל למשימות פשוטות", "Model for simple tasks")} help={t("קריאת החומר וכרטיסיות", "Reading your material and flashcards")}>
          <Select value={models.fast} onChange={(v) => void save("fast", v)} options={options("fast")} searchable={false} aria-label={t("מודל למשימות פשוטות", "Model for simple tasks")} />
        </Field>
      </div>
      {error && <p className="text-[12.5px] text-red-700">{error}</p>}
    </div>
  );
}
