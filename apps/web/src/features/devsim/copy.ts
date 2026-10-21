/**
 * Copy helpers for the Development Simulation overlays and the text version. All strings come from
 * the plan (spec §4.3, §4.5, D8); these only split them for layout, never rewrite them.
 */

/** "ROUTE ENGINE · +3 min walk · 2,516 → 2,754 m" -> head "ROUTE ENGINE", body the rest. */
export function splitTag(tag: string): { head: string; body: string } {
  const i = tag.indexOf(" · ");
  return i < 0 ? { head: "", body: tag } : { head: tag.slice(0, i), body: tag.slice(i + 3) };
}

/** "Hypothetical development · not an SDP project · 30 storeys · ~500 homes" -> title + detail. */
export function splitLabel(label: string): { title: string; detail: string } {
  const i = label.indexOf(" · ");
  return i < 0
    ? { title: label, detail: "" }
    : { title: label.slice(0, i), detail: label.slice(i + 3) };
}

/**
 * The Brief overview's site label (prototype `parcelTag`): the parcel is OSM landuse=construction
 * beside Lakeside Mall (`plan.site.parcel_id`, spec D3), so it is a mapped fact with its source.
 */
export const SITE_LABEL = {
  source: "OpenStreetMap",
  text: "Construction lot beside Lakeside Mall",
};

/** Copy when the simulation cannot play. */
export const LOADING_COPY = "Preparing the development simulation…";
export const ERROR_COPY = "The development simulation could not be loaded. Try again.";

// ---------- Building timeline: schedule bar and estimate HUD (spec §6.2, D8, D9; AC-W1, W2, W9) ----------

/** Every estimate carries this badge (spec §3). */
export const ESTIMATE_BADGE = "ESTIMATE";
/** HUD footnote (AC-W2). */
export const ESTIMATE_FOOTNOTE = "Estimate from published benchmarks";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "RM {n} M" (AC-W2): ringgit to the nearest million. */
export const formatRmMillions = (rm: number) => `RM ${Math.round(rm / 1_000_000)} M`;
/** "{n} d" (AC-W2): working days, rounded. */
export const formatDays = (d: number) => `${Math.round(d)} d`;
/** "2028-02" -> "Feb 2028". */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return `${MONTHS[m - 1] ?? "?"} ${y}`;
}
/** Month number 1-12 -> "Nov". */
export const monthShort = (m: number) => MONTHS[(((m - 1) % 12) + 12) % 12] as string;

/** Holiday tick tooltip: the name, plus "expected" when the date is not gazetted (AC-W1). */
export function holidayTooltip(h: { name: string; status: string }): string {
  return h.status === "gazetted" ? h.name : `${h.name} · expected date`;
}

/** Timeline legend entries. `monsoon` is "Nov–Mar" from the schedule's bands. */
export const SCHEDULE_LEGEND = {
  holiday: "Public holiday",
  raya: "Hari Raya Aidilfitri · site closed",
  monsoon: (span: string) => `Northeast monsoon (${span})`,
  progress: "Progress",
  expected: "Holidays not yet gazetted show expected dates",
};

// ---------- Simulated residents (spec D10, D11, §6.2; AC-W7) ----------

export const RESIDENTS_BUTTON = (n: number) => `Simulated residents · ${n}`;
export const RESIDENTS_SUB = (tower: number, nearby: number) =>
  `${tower} move into the tower, ${nearby} live nearby`;
export const RESIDENT_SIDE = { tower: "New tower", neighbour: "Neighbour" } as const;
export const RESIDENT_SIDE_LONG = {
  tower: "moves into the new tower",
  neighbour: "lives nearby",
} as const;
export const RESIDENT_PHASES = [
  ["construction", "During construction"],
  ["handover", "Handover"],
  ["daily_life", "Daily life"],
] as const;
export const RESIDENT_FACTS_HEAD = "From the world model";
export const RESIDENT_BACK = (n: number) => `All ${n} residents`;
