import { useMemo } from "react";
import { COURSE_STYLE, type MarathonResult, uniqueSuggestions } from "./closureSimModel";
import { closedTag } from "./courseDressing";
import {
  carAt,
  detourTag,
  followedTrip,
  leadAt,
  roadsClosed,
  SHOT_CAPTION,
  shotAt,
  TOTAL_S,
} from "./marathonCinematic";
import { PLAY_STYLE } from "./marathonPlay";

/** The end card shows from this far into the pull-back. */
export const END_CARD_FROM_S = TOTAL_S - 1.5;

export const END_NOTE =
  "Simulation · illustrative — runners, spectators and cars are not crowd sizes, vehicle counts or delays.";

/**
 * T-031 HUD under the controls: the simulated shot's caption and counters. Every number is the
 * engine's (course length, named roads closed, sample trips rerouted of the sample); "km run" is
 * the lead runner's share of the engine's course length in this illustration.
 */
export function MarathonHud({ m, t }: { m: MarathonResult; t: number }) {
  const shot = shotAt(t).id;
  const km = (m.course.length_m / 1000) * leadAt(t);
  const i = m.impact;
  return (
    <div data-testid="marathon-hud" className="flex w-full flex-wrap items-center gap-x-4 gap-y-1">
      <span className="font-semibold">{SHOT_CAPTION[shot]}</span>
      <Stat
        label="Lead runner"
        value={`${km.toFixed(1)} of ${(m.course.length_m / 1000).toFixed(1)} km`}
      />
      <Stat label="Roads closed" value={String(roadsClosed(m))} />
      <Stat label="Sample trips rerouted" value={`${i.trips_affected} of ${i.trips_total}`} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-xs text-fg-soft">
      {label} <strong className="tabular-nums text-fg">{value}</strong>
    </span>
  );
}

const MM_W = 120;
const MM_H = 88;
const PAD = 8;

/**
 * North-up mini-map of the course (the journey mini-map's look): the course in the closed-course
 * red, the followed car's before route dashed grey and after route blue, and a dot for whoever the
 * camera follows (lead runner or car).
 */
export function MarathonMiniMap({ m, t }: { m: MarathonResult; t: number }) {
  const trip = followedTrip(m);
  const lay = useMemo(() => {
    const lines = [
      m.animation.course_coordinates,
      ...(trip ? [trip.before_coordinates, trip.after_coordinates] : []),
    ];
    const pts = lines.flat();
    const lons = pts.map((p) => p[0] ?? 0);
    const lats = pts.map((p) => p[1] ?? 0);
    const [w, e, s, n] = [
      Math.min(...lons),
      Math.max(...lons),
      Math.min(...lats),
      Math.max(...lats),
    ];
    const k = Math.min(
      (MM_W - 2 * PAD) / Math.max(e - w, 1e-9),
      (MM_H - 2 * PAD) / Math.max(n - s, 1e-9),
    );
    const xy = (p: number[]): [number, number] => [
      PAD + ((p[0] ?? 0) - w) * k,
      MM_H - PAD - ((p[1] ?? 0) - s) * k,
    ];
    const poly = (l: number[][]) =>
      l
        .map((p) =>
          xy(p)
            .map((v) => v.toFixed(1))
            .join(","),
        )
        .join(" ");
    return { xy, poly };
  }, [m, trip]);
  const shot = shotAt(t).id;
  const onCar = trip && (shot === "cut" || shot === "car" || shot === "pull");
  const line = onCar ? trip.after_coordinates : m.animation.course_coordinates;
  const f = onCar ? carAt(t) : leadAt(t);
  const dot = line.length
    ? lay.xy(line[Math.min(line.length - 1, Math.round(f * (line.length - 1)))] as number[])
    : null;
  return (
    <svg
      width={MM_W}
      height={MM_H}
      role="img"
      aria-label="Mini-map of the proposed course"
      data-testid="marathon-minimap"
      className="shrink-0"
    >
      <rect width={MM_W} height={MM_H} rx="10" className="fill-raised" />
      <polyline
        points={lay.poly(m.animation.course_coordinates)}
        fill="none"
        stroke={COURSE_STYLE.color}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      {trip && (
        <>
          <polyline
            points={lay.poly(trip.before_coordinates)}
            fill="none"
            stroke={PLAY_STYLE.before}
            strokeWidth="2"
            strokeDasharray="4 3"
          />
          <polyline
            points={lay.poly(trip.after_coordinates)}
            fill="none"
            stroke={PLAY_STYLE.car}
            strokeWidth="2"
          />
        </>
      )}
      {dot && (
        <circle
          data-testid="marathon-minimap-dot"
          cx={dot[0]}
          cy={dot[1]}
          r="4.5"
          fill={onCar ? PLAY_STYLE.car : PLAY_STYLE.runner}
          stroke={PLAY_STYLE.runnerEdge}
          strokeWidth="1.5"
        />
      )}
    </svg>
  );
}

/**
 * The end card over the overview: the course, the closure window, the engine's counts and
 * suggestions, and the simulation label. Numbers and texts are the tool's.
 */
export function MarathonEndCard({
  m,
  onReplay,
  onExit,
}: {
  m: MarathonResult;
  onReplay: () => void;
  onExit: () => void;
}) {
  const i = m.impact;
  const shape = m.course.shape === "loop" ? "loop" : "point-to-point";
  const closed = closedTag(i);
  const detour = detourTag(m);
  const sugg = uniqueSuggestions(i).slice(0, 2);
  return (
    <section
      aria-label="Marathon simulation summary"
      data-testid="marathon-end-card"
      className="w-full space-y-1 rounded-xl border border-edge bg-raised p-3 text-sm"
    >
      <p className="m-0 font-semibold">
        Proposed {(m.course.length_m / 1000).toFixed(1)} km {shape} course
        {closed ? ` · ${closed}` : ""}
      </p>
      <ul className="m-0 list-disc space-y-0.5 pl-5">
        <li>
          {roadsClosed(m)} named roads closed; {i.trips_affected} of {i.trips_total} sample trips
          change route
        </li>
        {detour && <li>{detour}</li>}
        {sugg.map((s) => (
          <li key={s.text}>{s.text}</li>
        ))}
      </ul>
      <p className="m-0 text-xs text-fg-soft">{END_NOTE}</p>
      <p className="m-0 text-xs text-fg-soft">{m.course.disclaimer}</p>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onReplay}
          className="inline-flex min-h-9 items-center rounded-full border border-edge bg-surface px-3 text-sm font-semibold"
        >
          Replay
        </button>
        <button
          type="button"
          onClick={onExit}
          className="inline-flex min-h-9 items-center rounded-full border border-edge bg-surface px-3 text-sm font-semibold"
        >
          Exit simulation
        </button>
      </div>
    </section>
  );
}
