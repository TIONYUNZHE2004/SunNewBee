import type { CSSProperties, Ref } from "react";
import type { CompareIntent } from "../compareTypes";
import {
  DEMO_VALUES,
  REASONS_FOOT,
  reasonRows,
  reasonsTitle,
  uncheckedLine,
  usesDemoValues,
} from "./copy";

/**
 * "Why this route" (spec §5.3, AC-N6): the five known-fact rows for both routes; a null fact reads
 * "Not checked yet". Used at the end of the 3D playback and, as text, in the List view.
 */
export function ReasonsCard({
  compare,
  className = "",
  style,
  ref,
}: {
  compare: CompareIntent;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLElement>;
}) {
  const rows = reasonRows(compare);
  const unchecked = uncheckedLine(compare);
  return (
    <section
      ref={ref}
      data-beat="reasons"
      aria-labelledby="compare-reasons-h"
      style={style}
      className={`rounded-lg border border-line bg-card p-4 ${className}`}
    >
      <h3 id="compare-reasons-h" className="m-0 text-base font-semibold">
        {reasonsTitle(compare)}
      </h3>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr>
            <th scope="col" className="text-left font-normal text-fg-soft">
              <span className="sr-only">Fact</span>
            </th>
            <th scope="col" className="text-left font-medium">
              Fastest
            </th>
            <th scope="col" className="text-left font-medium">
              Recommended
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row" className="py-1 pr-2 text-left font-normal">
                {r.label}
              </th>
              <td className="py-1 pr-2">{r.fastest}</td>
              <td className="py-1">{r.recommended}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 space-y-1 text-xs text-fg-soft">
        <p className="m-0">{REASONS_FOOT}</p>
        {unchecked && <p className="m-0">{unchecked}</p>}
        {usesDemoValues(compare) && <p className="m-0">{DEMO_VALUES}</p>}
      </div>
    </section>
  );
}
