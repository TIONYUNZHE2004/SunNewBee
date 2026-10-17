/** Ticket impact wording (pure, tested). Every number is copied from the engine's FactImpact;
 * "would" only for open tickets, "changed" only for resolved and verified ones. */
import { plural } from "../whatif/whatifModel";

export interface ImpactLike {
  mode: string;
  profile: string;
  profile_assumed?: boolean;
  sampled: number;
  became_confirmed?: number;
  lost_route?: number;
  changed?: number;
  own?: {
    from_name: string;
    to_name: string;
    statuses: Record<string, string>;
    demo_values?: boolean;
  } | null;
  own_other_checks?: number | null;
  belief_q?: number | null;
  belief_q_before?: number | null;
  note: string;
}

const STATUS: Record<string, string> = {
  confirmed: "confirmed",
  partly_unverified: "partly unverified",
  blocked: "blocked",
  no_data: "no mapped connection",
};
const word = (s?: string) => (s ? (STATUS[s] ?? s.replace(/_/g, " ")) : "—");

const PROFILE: Record<string, string> = {
  wheelchair: "wheelchair",
  stroller: "stroller",
  older_adult_rest: "older-adult (rests often)",
  default: "walking",
};

export function impactLines(d: ImpactLike): {
  title: string;
  headline: string;
  sample: string;
  own?: string;
  belief?: string;
} | null {
  if (d.mode === "none") return null;
  const who = PROFILE[d.profile] ?? d.profile.replace(/_/g, " ");
  const sample = `Sampled ${plural(d.sampled, `everyday ${who} journey`)} on the township model${
    d.profile_assumed ? " (profile assumed: the ticket did not name one)" : ""
  }.`;
  const headline =
    d.mode === "would"
      ? `If it passes, ${d.became_confirmed ?? 0} of ${d.sampled} would become confirmed; if it fails, ${d.lost_route ?? 0} would lose their route.`
      : `This check changed ${d.changed ?? 0} of ${d.sampled} (compared with leaving it unchecked): ${d.became_confirmed ?? 0} became confirmed, ${d.lost_route ?? 0} lost their route.`;
  let own: string | undefined;
  if (d.own) {
    const s = d.own.statuses;
    const body =
      d.mode === "would"
        ? `now ${word(s.now)}; if it passes ${word(s.pass)}${
            s.pass !== "confirmed" && d.own_other_checks
              ? ` (${plural(d.own_other_checks, "other unchecked fact")} still on that route)`
              : ""
          }; if it fails ${word(s.fail)}.`
        : `before ${word(s.before)}, now ${word(s.now)}.`;
    own = `The question this came from (${d.own.from_name} → ${d.own.to_name}): ${body}${
      d.own.demo_values ? " Includes demo values, not yet surveyed." : ""
    }`;
  }
  let belief: string | undefined;
  if (typeof d.belief_q === "number") {
    const before =
      typeof d.belief_q_before === "number"
        ? ` (was ${Math.round(d.belief_q_before * 100)}% before this check)`
        : "";
    belief = `Model estimate that a fact like this passes: ${Math.round(d.belief_q * 100)}%${before}. ${d.note}`;
  }
  return {
    title: d.mode === "would" ? "What this check would change" : "What this check changed",
    headline,
    sample,
    own,
    belief,
  };
}

/** Who a ticket's path or place matters to, from a rehearsed day (Cycle 23): synthetic
 * residents whose trips cross it, and what for. Null when nobody's trips use it. */
export function reachLine(d: unknown): { title: string; text: string; who: string | null } | null {
  const r = d as {
    kind?: string;
    residents?: number;
    trips?: number;
    day?: { label?: string };
    by_purpose?: { purpose: string; words: string; trips: number }[];
    by_group?: Record<string, number>;
  } | null;
  if (!r || !r.residents || r.kind === "other") return null;
  const n = r.residents.toLocaleString();
  const what = (r.by_purpose ?? [])
    .filter((p) => p.purpose !== "home")
    .slice(0, 3)
    .map((p) => `${p.trips.toLocaleString()} ${p.words}`);
  const verb = r.kind === "place" ? "go to this place" : "cross this path";
  const g = r.by_group ?? {};
  const young = [
    g.child ? `${g.child.toLocaleString()} children` : null,
    g.teen ? `${g.teen.toLocaleString()} teenagers` : null,
  ].filter(Boolean);
  return {
    title: `Who this matters to · ${r.day?.label ?? "a rehearsed day"} (rehearsal)`,
    text: `${n} synthetic residents' trips ${verb} (${(r.trips ?? 0).toLocaleString()} trips${
      what.length ? `: ${what.join(", ")}` : ""
    }).`,
    who: young.length ? `Among them ${young.join(" and ")}.` : null,
  };
}
