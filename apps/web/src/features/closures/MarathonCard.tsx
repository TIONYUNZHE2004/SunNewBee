import { useScene } from "../scene/sceneStore";
import { ClosureResult } from "./ClosureResult";
import type { MarathonResult } from "./closureSimModel";
import { courseRows } from "./courseRows";
import { canPlay } from "./marathonPlay";
import { useMarathonPlay } from "./marathonPlayStore";

/** Puts this course back on the map (an older answer's too) and plays the illustrative simulation. */
export function watchMarathon(m: MarathonResult) {
  useScene.getState().applyIntent({ kind: "marathon.show", marathon: m } as never);
  useMarathonPlay.getState().start(m);
}

/** Course rows shown before "and N more roads" (the engine's order, never reordered). */
export const COURSE_ROWS = 8;

/**
 * T-028: a proposed marathon course under a management answer: its length, the roads in order
 * with their lengths (the engine's, consecutive stretches of one road merged and short unnamed
 * paths folded into one line; the map draws every stretch), the proposal label, "Watch the marathon", then the
 * closure impact card.
 */
export function MarathonCard({ m }: { m: MarathonResult }) {
  const { course, impact } = m;
  const { rows, short } = courseRows(course.roads);
  const hidden = rows.slice(COURSE_ROWS);
  const hiddenM = hidden.reduce((a, r) => a + r.length_m, 0);
  const shape = course.shape === "loop" ? "loop" : "point-to-point";
  return (
    <section
      aria-label="Proposed marathon course"
      data-testid="marathon-course"
      className="space-y-3 rounded-2xl border border-edge bg-raised p-3 text-sm text-fg"
    >
      <p className="m-0">
        <strong>
          Proposed {(course.length_m / 1000).toFixed(1)} km {shape} course
        </strong>
        <span className="block text-xs text-fg-soft">{course.disclaimer}</span>
      </p>
      <ol aria-label="Course roads in order" className="m-0 list-none space-y-1 p-0">
        {rows.slice(0, COURSE_ROWS).map((r, i) => (
          <li key={r.order} className="flex justify-between gap-2">
            <span>
              <span className="text-fg-soft tabular-nums">{i + 1}. </span>
              {r.name}
            </span>
            <span className="shrink-0 tabular-nums text-fg-soft">{Math.round(r.length_m)} m</span>
          </li>
        ))}
      </ol>
      {(hidden.length > 0 || short.stretches > 0) && (
        <p className="m-0 space-y-0.5 text-xs text-fg-soft">
          {hidden.length > 0 && (
            <span className="block">
              and {hidden.length} more {hidden.length === 1 ? "road" : "roads"} (
              {Math.round(hiddenM)} m), drawn on the map
            </span>
          )}
          {short.stretches > 0 && (
            <span className="block" data-testid="course-short-paths">
              Short connecting paths: {short.stretches}{" "}
              {short.stretches === 1 ? "stretch" : "stretches"}, {Math.round(short.length_m)} m
            </span>
          )}
        </p>
      )}
      {canPlay(m) && (
        <button
          type="button"
          onClick={() => watchMarathon(m)}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-edge bg-surface px-4 text-sm font-semibold text-fg hover:border-fg/25 focus-visible:outline-2"
        >
          <span aria-hidden="true">▶</span> Watch the marathon
        </button>
      )}
      <ClosureResult r={impact} />
    </section>
  );
}
