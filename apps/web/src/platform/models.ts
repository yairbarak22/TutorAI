import { DEFAULT_MODELS } from "@tutorai/core";
import { t } from "../i18n.tsx";

/**
 * The Claude models a student can pick, with a few plain words each.
 * Used for an API key (price per use) and for a Claude plan (counts against the plan's limits).
 * Defaults (recommended): DEFAULT_MODELS — Sonnet for hard work, Haiku for simple work.
 */
export interface ClaudeModel {
  id: string;
  name: string;
  /** USD per 1M tokens: input, output. */
  price: [number, number];
  /** Short description for an API key, where cost is per use. */
  apiHint: () => string;
  /** Short description for a plan, where usage counts against the plan's limits. */
  planHint: () => string;
  /** Offered with a Claude plan (Claude Code). */
  plan: boolean;
}

export const CLAUDE_MODELS: ClaudeModel[] = [
  {
    id: "claude-fable-5-2",
    name: "Claude Fable 5.2",
    price: [8, 40],
    apiHint: () => t("הכי חכם · הכי יקר ואיטי", "Smartest · most expensive and slowest"),
    planHint: () => t("הכי חכם · איטי, מנצל את המנוי הכי מהר", "Smartest · slow, uses up your plan fastest"),
    plan: false,
  },
  {
    id: "claude-opus-5-5",
    name: "Claude Opus 5.5",
    price: [4, 20],
    apiHint: () => t("חכם מאוד · יקר", "Very smart · pricey"),
    planHint: () => t("חכם מאוד · מנצל את המנוי מהר", "Very smart · uses up your plan quickly"),
    plan: true,
  },
  {
    id: "claude-sonnet-5-5",
    name: "Claude Sonnet 5.5",
    price: [2, 10],
    apiHint: () => t("חכם ומהיר · מחיר בינוני", "Smart and quick · mid-priced"),
    planHint: () => t("חכם ומהיר · מאוזן", "Smart and quick · balanced"),
    plan: true,
  },
  {
    id: "claude-haiku-5-5",
    name: "Claude Haiku 5.5",
    price: [0.1, 0.5],
    apiHint: () => t("הכי מהיר · הכי זול", "Fastest · cheapest"),
    planHint: () => t("הכי מהיר · כמעט לא מנצל את המנוי", "Fastest · barely uses your plan"),
    plan: true,
  },
];

export const RECOMMENDED_MODELS = DEFAULT_MODELS;

/** USD per 1M tokens for the usage estimate; undefined for models we don't know. */
export const priceOf = (model: string) => CLAUDE_MODELS.find((m) => m.id === model)?.price;
