import { type EdgeStatus, ROUTE_STYLE, statusStyle } from "./styles";

/** Dash pattern per border style, matching the status chips. */
const DASH = { solid: undefined, dashed: "6 4", dotted: "1.5 3.5" } as const;

const ORDER: EdgeStatus[] = ["ok", "unknown", "blocked", "flooded_likely", "flooded_possible"];

/** Compact text legend: patterns plus words, so status is never colour alone. */
export function StatusLegend({ className = "" }: { className?: string }) {
  return (
    <ul
      aria-label="Path status legend"
      className={`m-0 list-none space-y-0.5 text-fg px-2 py-1.5 text-xs ${className}`}
    >
      {ORDER.map((s) => {
        const st = statusStyle(s);
        return (
          <li key={s} className="flex items-center gap-2">
            <svg width="28" height="8" aria-hidden="true">
              <line
                x1="1"
                y1="4"
                x2="27"
                y2="4"
                stroke={st.color}
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={st.dotted ? DASH.dotted : st.dashed ? DASH.dashed : DASH.solid}
              />
            </svg>
            {st.label}
          </li>
        );
      })}
      <li className="flex items-center gap-2">
        <svg width="28" height="8" aria-hidden="true">
          <line x1="2" y1="4" x2="26" y2="4" stroke={ROUTE_STYLE.color} strokeWidth="6" />
          <line x1="2" y1="4" x2="26" y2="4" stroke="#fff" strokeWidth="1" strokeDasharray="3 3" />
        </svg>
        {ROUTE_STYLE.label}
      </li>
    </ul>
  );
}
