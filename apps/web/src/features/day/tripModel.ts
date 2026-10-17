/** Rehearse my trip (Cycle 19-20): a resident's own trip through an Elmina Day rehearsal.
 * Pure helpers: the trip geojson (from the server's day.trip intent or POST /day/{id}/trip), the
 * resident's position at the rehearsal clock, and the departure strip's words and colours. Every
 * time and outcome comes from the engine; nothing here computes a fact. */

export type TripOutcome =
  | "clear"
  | "longer"
  | "very_long"
  | "rerouted"
  | "turned_back"
  | "stranded"
  | "no_way";

/** Map styles: the rehearsed trip, the normal-day route under it and the flooded pieces. */
export const TRIP_STYLE = {
  trip: { color: "#F6E05E", width: 10, label: "Your trip (rehearsal)" },
  // white dashes on dark gaps: readable over the stylised roads and the flood layer alike
  normal: { color: "#FFFFFF", gap: "#1A202C", width: 7, label: "Usual route on a normal day" },
  cut: { color: "#FF3B3B", width: 18, label: "Flooded at the time you leave (indicative)" },
} as const;

/** The strip: a colour plus a glyph per outcome, so it never relies on colour alone. */
export const OUTCOME_STYLE: Record<TripOutcome, { color: string; glyph: string; words: string }> = {
  clear: { color: "#1B873F", glyph: "✓", words: "got there" },
  longer: { color: "#B7791F", glyph: "~", words: "got there by a longer way round" },
  rerouted: { color: "#DD6B20", glyph: "↺", words: "had to re-plan on the way and got there" },
  very_long: { color: "#C53030", glyph: "…", words: "found only a very long way round" },
  turned_back: { color: "#C53030", glyph: "↩", words: "turned back" },
  stranded: { color: "#C53030", glyph: "■", words: "was stuck on the way" },
  no_way: { color: "#C53030", glyph: "✕", words: "found no way through" },
};

export const PROFILE_WORDS: Record<string, string> = {
  default: "on foot",
  stroller: "with a stroller",
  wheelchair: "in a wheelchair",
  older_adult_rest: "on foot with rests",
  drive: "by car",
};

export interface SweepCell {
  leave: string;
  outcome: TripOutcome;
  arrive?: string | null;
}

export interface TripMeta {
  day?: string;
  day_label?: string;
  profile?: string;
  from?: string;
  to?: string;
  from_id?: string | null;
  to_id?: string | null;
  leave?: string;
  outcome?: TripOutcome;
  arrive?: string | null;
  minutes?: number | null;
  unchecked?: number | null;
  normal_minutes?: number | null;
  cut_by?: string[];
  last_ok_leave_before?: string | null;
  next_clear_leave?: string | null;
  sweep?: SweepCell[];
}

export interface TripSeg {
  t0: number;
  t1: number;
  wait: boolean;
  coords: number[][];
}

export interface ParsedTrip {
  normal: number[][] | null;
  cut: number[][][];
  segs: TripSeg[];
  meta: TripMeta;
}

type Feature = {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown> | null;
};

/** The trip geojson (normal route, trip segments, cut pieces) as plain arrays for renderers. */
export function parseTrip(geojson: unknown): ParsedTrip | null {
  const fc = geojson as { features?: Feature[]; meta?: TripMeta } | null | undefined;
  if (!fc || !Array.isArray(fc.features)) return null;
  const out: ParsedTrip = { normal: null, cut: [], segs: [], meta: fc.meta ?? {} };
  for (const f of fc.features) {
    const p = f.properties ?? {};
    const g = f.geometry ?? {};
    const coords =
      g.type === "Point"
        ? [g.coordinates as number[]]
        : g.type === "LineString"
          ? (g.coordinates as number[][])
          : [];
    if (!coords.length) continue;
    if (p.kind === "normal") out.normal = coords;
    else if (p.kind === "cut") out.cut.push(coords);
    else if (typeof p.t0 === "number" && typeof p.t1 === "number")
      out.segs.push({ t0: p.t0, t1: p.t1, wait: !!p.wait, coords });
  }
  return out;
}

const M_PER_DEG = [111_320 * 0.9984, 110_540];
const dist = (a: number[], b: number[]) =>
  Math.hypot(
    ((a[0] as number) - (b[0] as number)) * (M_PER_DEG[0] as number),
    ((a[1] as number) - (b[1] as number)) * (M_PER_DEG[1] as number),
  );

export type TripState = "not_left" | "moving" | "waiting" | "ended";

/** Where the resident is at minute t of the rehearsal, along the engine's own segments. */
export function tripPositionAt(
  segs: TripSeg[],
  t: number,
): { lon: number; lat: number; state: TripState } | null {
  if (!segs.length) return null;
  const first = segs[0] as TripSeg;
  const at = (c: number[] | undefined, state: TripState) =>
    c ? { lon: c[0] as number, lat: c[1] as number, state } : null;
  if (t < first.t0) return at(first.coords[0], "not_left");
  for (const s of segs) {
    if (t > s.t1) continue;
    if (s.wait || s.coords.length < 2 || s.t1 <= s.t0) return at(s.coords[0], "waiting");
    const legs = s.coords.slice(1).map((c, i) => dist(s.coords[i] as number[], c));
    const total = legs.reduce((a, b) => a + b, 0);
    let want = (total * (t - s.t0)) / (s.t1 - s.t0);
    for (let i = 0; i < legs.length; i++) {
      const l = legs[i] as number;
      if (want <= l || i === legs.length - 1) {
        const a = s.coords[i] as number[];
        const b = s.coords[i + 1] as number[];
        const f = l > 0 ? Math.min(1, want / l) : 0;
        return {
          lon: (a[0] as number) + ((b[0] as number) - (a[0] as number)) * f,
          lat: (a[1] as number) + ((b[1] as number) - (a[1] as number)) * f,
          state: "moving",
        };
      }
      want -= l;
    }
  }
  const last = segs[segs.length - 1] as TripSeg;
  return at(last.coords[last.coords.length - 1], "ended");
}

/** POST /day/{id}/trip's response as the same geojson the server's day.trip intent carries. */
export function tripFromApi(d: Record<string, unknown>): {
  type: "FeatureCollection";
  features: unknown[];
  meta: TripMeta;
} {
  const feats: unknown[] = [];
  const line = (coordinates: unknown, properties: Record<string, unknown>) => ({
    type: "Feature",
    geometry: { type: "LineString", coordinates },
    properties,
  });
  const normal = d.normal_route as number[][] | undefined;
  if (normal?.length) feats.push(line(normal, { kind: "normal" }));
  for (const s of (d.track as TripSeg[] | undefined) ?? []) {
    if (!s.coords?.length) continue;
    const props = { kind: "trip", t0: s.t0, t1: s.t1, wait: !!s.wait };
    feats.push(
      s.wait || s.coords.length === 1
        ? {
            type: "Feature",
            geometry: { type: "Point", coordinates: s.coords[0] },
            properties: props,
          }
        : line(s.coords, props),
    );
  }
  for (const c of (d.cut_lines as number[][][] | undefined) ?? [])
    feats.push(line(c, { kind: "cut" }));
  const asked = (d.asked ?? {}) as Record<string, unknown>;
  const sc = (d.scenario ?? {}) as Record<string, string>;
  const from = (d.from ?? {}) as Record<string, string | null>;
  const to = (d.to ?? {}) as Record<string, string | null>;
  return {
    type: "FeatureCollection",
    features: feats,
    meta: {
      day: sc.id,
      day_label: sc.label,
      profile: d.profile as string,
      from: from.name ?? undefined,
      to: to.name ?? undefined,
      from_id: from.id ?? null,
      to_id: to.id ?? null,
      leave: d.leave as string,
      outcome: asked.outcome as TripOutcome,
      arrive: (asked.arrive as string | null) ?? null,
      minutes: (asked.minutes as number | null) ?? null,
      unchecked: (asked.unchecked as number | null) ?? null,
      normal_minutes: (d.normal_minutes as number | null) ?? null,
      cut_by: (d.cut_by as string[]) ?? [],
      last_ok_leave_before: (d.last_ok_leave_before as string | null) ?? null,
      next_clear_leave: (d.next_clear_leave as string | null) ?? null,
      sweep: ((d.sweep as SweepCell[]) ?? []).map((x) => ({
        leave: x.leave,
        outcome: x.outcome,
        arrive: x.arrive ?? null,
      })),
    },
  };
}

/** One sentence for the strip's selected cell, copied from the rehearsal (never advice). */
export function cellSentence(c: SweepCell): string {
  const s = OUTCOME_STYLE[c.outcome] ?? OUTCOME_STYLE.no_way;
  return `Leaving at ${c.leave}: ${s.words}${c.arrive ? ` at ${c.arrive}` : ""} (rehearsal).`;
}

export const minutesOf = (hhmm: string | null | undefined): number | null => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Which trip this is (day, ends, profile): a new departure of the same trip keeps the view. */
export function tripIdentity(geojson: unknown): string | null {
  const m = (geojson as { meta?: TripMeta } | null | undefined)?.meta;
  return m ? [m.day, m.from, m.to, m.profile].join("|") : null;
}

/** Every coordinate of a trip, for framing it on the map (usual route, trip and cut pieces). */
export function tripCoords(t: ParsedTrip | null): number[][] {
  return t ? [...(t.normal ?? []), ...t.segs.flatMap((x) => x.coords), ...t.cut.flat()] : [];
}
