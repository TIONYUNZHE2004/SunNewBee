import { type EdgeStatus, ROUTE_STYLE, statusStyle } from "./styles";

const ORDER: EdgeStatus[] = ["ok", "unknown", "blocked", "flooded_likely", "flooded_possible"];

/** Compact text legend: patterns plus words, so status is never colour alone. */
export function StatusLegend({ className = "" }: { className?: string }) {
  return (
    <ul
      aria-label="Path status legend"
      className={`m-0 list-none space-y-0.5 rounded-md border border-edge bg-surface/95 text-fg px-2 py-1.5 text-xs shadow-sm ${className}`}
    >
      {ORDER.map((s) => {
        const st = statusStyle(s);
        return (
          <li key={s} className="flex items-center gap-2">
            <svg width="28" height="8" aria-hidden="true">
              <line
                x1="2"
                y1="4"
                x2="26"
                y2="4"
                stroke={st.color}
                strokeWidth={Math.min(st.width, 7)}
                strokeDasharray={st.dotted ? "1 5" : st.dashed ? "5 4" : undefined}
                strokeLinecap={st.dotted ? "round" : "butt"}
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
