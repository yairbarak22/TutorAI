import { INSTITUTIONS, MoodleError, candidateSites, classify, validateSite, type Institution, type ValidatedSite } from "@tutorai/moodle";
import type { MoodleCandidate, MoodleInstitutions, MoodleResolve } from "@tutorai/local-api";
import { z } from "zod";
import { PROBE_MAX_BYTES, type MoodleHttp } from "./http.ts";

/**
 * Finding and validating an institution's Moodle site (docs/rfc-moodle.md §5.2). The registry says
 * where to look; the site's own public configuration, checked against the address we probed,
 * decides what is offered. Validated sites are remembered for 30 minutes, and a sign-in can only
 * start for a site in that list: the page never hands the server an address.
 */

export const RESOLVED_TTL_MS = 30 * 60_000;

export interface ResolvedSite {
  site: ValidatedSite;
  institution: Institution;
  at: number;
}

const TestSites = z.array(z.object({ id: z.string().max(40), site: z.string().max(200), he: z.string().optional(), en: z.string().optional() }));

/** Tests only: extra institutions that point at a mock (docs/impl-moodle.md §3.4). */
function testInstitutions(): Institution[] {
  const raw = process.env.TUTORAI_MOODLE_TEST_SITES;
  if (!raw) return [];
  try {
    return TestSites.parse(JSON.parse(raw)).map((t) => ({ id: t.id, name: { he: t.he ?? t.id, en: t.en ?? t.id }, sites: [t.site], status: "config-checked" as const }));
  } catch {
    return [];
  }
}

type Outcome = "refused" | "not_moodle" | "timeout" | "offline";
const WORST: Outcome[] = ["refused", "not_moodle", "timeout", "offline"];

export class Sites {
  private resolved = new Map<string, ResolvedSite>();

  constructor(
    private http: MoodleHttp,
    private o: { testMode: boolean; now: () => number },
  ) {}

  registry(): Institution[] {
    return this.o.testMode ? [...INSTITUTIONS, ...testInstitutions()] : INSTITUTIONS;
  }

  institutions(): MoodleInstitutions {
    return { institutions: this.registry().map((i) => ({ id: i.id, name: i.name, status: i.status })) };
  }

  /** A site validated in the last 30 minutes, or undefined. */
  get(site: string): ResolvedSite | undefined {
    const r = this.resolved.get(site);
    if (!r) return undefined;
    if (this.o.now() - r.at > RESOLVED_TTL_MS) {
      this.resolved.delete(site);
      return undefined;
    }
    return r;
  }

  forget() {
    this.resolved.clear();
  }

  /** Probes a candidate; when the site names another root (an ancestor), that root must say the same. */
  private async probe(candidate: string): Promise<ValidatedSite | Outcome> {
    const first = await this.probeOnce(candidate);
    if (typeof first === "string" || first.site === candidate.replace(/\/+$/, "")) return first;
    const again = await this.probeOnce(first.site);
    if (typeof again === "string") return again;
    return again.site === first.site ? again : "refused";
  }

  private async probeOnce(candidate: string): Promise<ValidatedSite | Outcome> {
    let answer: { text: string };
    try {
      answer = await this.http.text(
        { site: candidate, level: "probe" },
        `${candidate}/lib/ajax/service-nologin.php?info=tool_mobile_get_public_config`,
        { body: JSON.stringify([{ index: 0, methodname: "tool_mobile_get_public_config", args: {} }]), headers: { "content-type": "application/json" }, maxBytes: PROBE_MAX_BYTES },
      );
    } catch (e) {
      if (e instanceof MoodleError && e.kind === "network") return e.code === "timeout" ? "timeout" : "offline";
      if (e instanceof MoodleError && e.kind === "forbidden") return "refused";
      return "not_moodle";
    }
    let data: unknown;
    try {
      const parsed = JSON.parse(answer.text) as unknown;
      const first = Array.isArray(parsed) ? (parsed[0] as { error?: unknown; data?: unknown } | undefined) : undefined;
      if (!first || first.error || !first.data || typeof first.data !== "object") return "not_moodle";
      data = first.data;
    } catch {
      return "not_moodle";
    }
    if (typeof (data as { wwwroot?: unknown }).wwwroot !== "string") return "not_moodle";
    return validateSite(candidate, data, { allowLocal: this.o.testMode }) ?? "refused";
  }

  async resolve(institutionId: string): Promise<MoodleResolve> {
    const institution = this.registry().find((i) => i.id === institutionId);
    if (!institution) return { candidates: [], problem: "refused" };
    if (institution.disabled) return { candidates: [{ site: "", host: "", siteName: "", institutionId, login: "unavailable", reason: "disabled" }] };

    const results = await Promise.all(candidateSites(institution, new Date(this.o.now())).map((c) => this.probe(c)));
    const candidates: MoodleCandidate[] = [];
    const seen = new Set<string>();
    let problem: Outcome | undefined;
    for (const r of results) {
      if (typeof r === "string") {
        if (!problem || WORST.indexOf(r) < WORST.indexOf(problem)) problem = r;
        continue;
      }
      if (seen.has(r.site)) continue;
      seen.add(r.site);
      this.resolved.set(r.site, { site: r, institution, at: this.o.now() });
      candidates.push({ site: r.site, host: r.host, siteName: r.siteName, institutionId, ...classify(r) });
    }
    return candidates.length ? { candidates } : { candidates, problem: problem ?? "offline" };
  }
}
