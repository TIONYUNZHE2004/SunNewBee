import { GAP_BAND_ORDER, GAP_BANDS } from "./gapModel";

/** Text legend: pattern plus words, so a band is never colour alone. */
export function GapLegend({ className = "" }: { className?: string }) {
  return (
    <ul
      aria-label="Gap map legend"
      className={`m-0 list-none space-y-0.5 rounded-md border border-line bg-white/95 px-2 py-1.5 text-xs shadow-sm ${className}`}
    >
      {GAP_BAND_ORDER.map((b) => {
        const st = GAP_BANDS[b];
        return (
          <li key={b} className="flex items-center gap-2">
            <svg width="28" height="8" aria-hidden="true">
              <line
                x1="2"
                y1="4"
                x2="26"
                y2="4"
                stroke={st.color}
                strokeWidth={Math.min(st.width, 7)}
                strokeDasharray={
                  st.pattern === "dotted" ? "1 5" : st.pattern === "dashed" ? "5 4" : undefined
                }
                strokeLinecap={st.pattern === "dotted" ? "round" : "butt"}
              />
            </svg>
            {st.label}
          </li>
        );
      })}
    </ul>
  );
}
