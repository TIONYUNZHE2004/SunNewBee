import { ClosureResult } from "./ClosureResult";
import type { MarathonResult } from "./closureSimModel";

/** Course rows shown before "and N more stretches" (the engine's order, never reordered). */
export const COURSE_ROWS = 8;

/**
 * T-028: a proposed marathon course under a management answer: its length, the roads in order
 * with their lengths (all the engine's), the proposal label, then the closure impact card.
 */
export function MarathonCard({ m }: { m: MarathonResult }) {
  const { course, impact } = m;
  const more = course.roads.length - COURSE_ROWS;
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
        {course.roads.slice(0, COURSE_ROWS).map((r) => (
          <li key={r.order} className="flex justify-between gap-2">
            <span>
              <span className="text-fg-soft tabular-nums">{r.order}. </span>
              {r.name}
            </span>
            <span className="shrink-0 tabular-nums text-fg-soft">{Math.round(r.length_m)} m</span>
          </li>
        ))}
      </ol>
      {more > 0 && (
        <p className="m-0 text-xs text-fg-soft">
          and {more} more {more === 1 ? "stretch" : "stretches"}, drawn on the map
        </p>
      )}
      <ClosureResult r={impact} />
    </section>
  );
}
