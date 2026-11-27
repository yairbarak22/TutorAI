/**
 * The institutions TutorAI can connect to. An entry holds names and where to look; the site's own
 * public configuration, validated against the address we probed, decides what is offered.
 *
 * v1 ships Reichman only (the one institution verified with a real account). The survey of other
 * institutions is in docs/rfc-moodle.md, Appendix A.
 */
export interface Institution {
  id: string;
  name: { he: string; en: string };
  /**
   * Addresses to try. Placeholders: {yyyy} {yy} = the year an academic year ends, {YYYY} {YY} = the
   * year it starts. A site without a yearly address has one entry and no placeholder. At most two.
   */
  sites: string[];
  status: "verified" | "config-checked" | "mobile-off" | "unreachable";
  verified?: { date: string; moodle: string; by: "maintainer" | "student" };
  /** Turns this institution off in the next release. */
  disabled?: true;
  /** Minimum pause between requests, when the site needs more than the default (ms). */
  paceMs?: number;
  notes?: string;
}

export const INSTITUTIONS: Institution[] = [
  {
    id: "runi",
    name: { he: "אוניברסיטת רייכמן", en: "Reichman University" },
    sites: ["https://moodle.runi.ac.il/{yyyy}"],
    status: "verified",
    verified: { date: "2026-11-27", moodle: "4.5.16", by: "maintainer" },
    notes: "Forces the moodlemobile scheme. File responses carry two CORS values, so a web page cannot read files. The root address redirects to last year's site.",
  },
];

export const MAX_CANDIDATES = 6;

const two = (n: number) => String(n % 100).padStart(2, "0");

function expand(template: string, endYear: number): string {
  return template
    .replaceAll("{yyyy}", String(endYear))
    .replaceAll("{yy}", two(endYear))
    .replaceAll("{YYYY}", String(endYear - 1))
    .replaceAll("{YY}", two(endYear - 1));
}

/**
 * The addresses to probe for an institution, newest academic year first: the years ending in
 * Y+1, Y and Y-1, where Y is the calendar year of `now`. Several templates are interleaved by year.
 */
export function candidateSites(inst: Institution, now: Date): string[] {
  const y = now.getFullYear();
  const out: string[] = [];
  for (const endYear of [y + 1, y, y - 1]) {
    for (const template of inst.sites) {
      const url = expand(template, endYear).replace(/\/+$/, "");
      if (!out.includes(url)) out.push(url);
    }
  }
  return out.slice(0, MAX_CANDIDATES);
}

export const institutionById = (id: string, list: Institution[] = INSTITUTIONS) => list.find((i) => i.id === id);
