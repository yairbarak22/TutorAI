/**
 * Bayesian Knowledge Tracing — one probability per concept that the student "knows" it.
 * Same model OATutor (Berkeley) uses. Parameters are conservative defaults.
 */
export interface BktParams {
  pInit: number;
  pLearn: number;
  pSlip: number;
  pGuess: number;
}

export const BKT_DEFAULTS: BktParams = { pInit: 0.2, pLearn: 0.15, pSlip: 0.1, pGuess: 0.2 };

/** Guess probability depends on the question format. */
export const guessFor = (kind: "mcq" | "open" | "exam" | "card") =>
  kind === "mcq" ? 0.25 : kind === "card" ? 0.15 : 0.05;

export function bktUpdate(pKnown: number, correct: boolean, params: Partial<BktParams> = {}): number {
  const { pLearn, pSlip, pGuess } = { ...BKT_DEFAULTS, ...params };
  const posterior = correct
    ? (pKnown * (1 - pSlip)) / (pKnown * (1 - pSlip) + (1 - pKnown) * pGuess)
    : (pKnown * pSlip) / (pKnown * pSlip + (1 - pKnown) * (1 - pGuess));
  const next = posterior + (1 - posterior) * pLearn;
  return Math.min(0.999, Math.max(0.001, next));
}

export type MasteryLevel = "new" | "weak" | "progress" | "strong";

export function masteryLevel(p: number, attempts: number): MasteryLevel {
  if (attempts === 0) return "new";
  if (p < 0.4) return "weak";
  // "strong" needs evidence from several answers, not one lucky one.
  if (p < 0.8 || attempts < 3) return "progress";
  return "strong";
}

export const MASTERY_LABEL: Record<MasteryLevel, string> = {
  new: "טרם תורגל",
  weak: "דורש חיזוק",
  progress: "בתהליך",
  strong: "שולט",
};
