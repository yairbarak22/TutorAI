/**
 * Issue claiming for a project where most contributors are first-timers.
 * Pure decision logic (unit-tested in claims.test.ts); the workflow in .github/workflows/claims.yml calls it.
 *
 * Rules:
 *  - Comment "/claim <short plan>" to be assigned; "/unclaim" to release.
 *  - One open claimed issue at a time until you have 2 merged PRs.
 *  - No linked PR after REMIND_DAYS → reminder; after RELEASE_DAYS → released.
 */
export const LIMIT_UNTIL_MERGED = 2;
export const REMIND_DAYS = 10;
export const RELEASE_DAYS = 14;
const DAY = 86_400_000;

/** "/claim", "/unclaim" or null, plus the rest of the comment (the plan). */
export function parseCommand(body) {
  const m = /^\s*\/(claim|unclaim)\b([\s\S]*)$/i.exec(body ?? "");
  return m ? { command: m[1].toLowerCase(), plan: m[2].trim() } : null;
}

/**
 * @param {{ user: string, assignees: string[], isPullRequest: boolean, isOpen: boolean,
 *           otherOpenClaims: number, mergedPrs: number, plan: string }} s
 * @returns {{ action: "assign" | "none", reply: string }}
 */
export function decideClaim(s) {
  if (s.isPullRequest || !s.isOpen) return { action: "none", reply: "" };
  if (s.assignees.includes(s.user)) return { action: "none", reply: `@${s.user} this issue is already yours. Have fun!` };
  if (s.assignees.length)
    return {
      action: "none",
      reply: `@${s.user} thanks! This issue is already being worked on by @${s.assignees.join(", @")}. Please pick another open issue (look for \`good first issue\` or \`no-code\`), or ask here if you'd like to help with this one together.`,
    };
  if (s.otherOpenClaims > 0 && s.mergedPrs < LIMIT_UNTIL_MERGED)
    return {
      action: "none",
      reply: `@${s.user} thanks for the enthusiasm! New contributors work on **one issue at a time** until their first ${LIMIT_UNTIL_MERGED} PRs are merged. Finish (or \`/unclaim\`) your current issue first, then come back.`,
    };
  const planHint = s.plan.length < 15 ? `\n\nPlease add a short plan in a comment: 1–3 sentences on what you'll change, so reviewers can help early.` : "";
  return {
    action: "assign",
    reply: `@${s.user} it's yours! 🎉 Open a pull request that says \`Closes #<this issue>\` within ${REMIND_DAYS} days. If you get stuck, ask here. If you can't continue, comment \`/unclaim\`.${planHint}\n\nNew to GitHub? Ask your AI assistant to follow AGENTS.md ("Helping a student contribute"), or run \`/contribute\` in Claude Code.`,
  };
}

/**
 * What to do with an assigned issue that may have stalled.
 * @param {{ assignedAt: string, now: string, hasLinkedPr: boolean, reminded: boolean }} s
 * @returns {"none" | "remind" | "release"}
 */
export function decideStale(s) {
  if (s.hasLinkedPr) return "none";
  const days = (Date.parse(s.now) - Date.parse(s.assignedAt)) / DAY;
  if (days >= RELEASE_DAYS) return "release";
  if (days >= REMIND_DAYS && !s.reminded) return "remind";
  return "none";
}

export const remindText = (user) =>
  `@${user} a friendly check-in: this issue was claimed ${REMIND_DAYS} days ago and has no pull request yet. Still on it? Reply here or open a draft PR. If it doesn't move in the next ${RELEASE_DAYS - REMIND_DAYS} days it will be released so someone else can pick it up. Need help? Just ask.`;
export const releaseText = (user) =>
  `@${user} this issue has been released after ${RELEASE_DAYS} days without a pull request, so others can pick it up. No problem at all: you're welcome to \`/claim\` it again later.`;
