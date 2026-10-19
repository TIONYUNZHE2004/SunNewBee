import { useSceneSettings } from "./sceneSettingsStore";
import { useScene } from "./sceneStore";
import { type EdgeStatus, ROUTE_STYLE, statusStyle } from "./styles";

/** Dash pattern per border style, ; butt caps so gaps stay visible at the sample width. */
const DASH = { solid: undefined, dashed: "6 4", dotted: "2 3" } as const;

const ACCESS_ROWS: EdgeStatus[] = ["ok", "unknown", "blocked"];
const FLOOD_ROWS: EdgeStatus[] = ["flooded_likely", "flooded_possible"];

/** Which status rows the legend lists: access rows follow "Path status", flood rows follow the
 * flood scenario (they label lines that draw whenever a scenario is on, whatever Path status says). */
export function legendRows(pathStatus: boolean, floodOn: boolean): EdgeStatus[] {
  return [...(pathStatus ? ACCESS_ROWS : []), ...(floodOn ? FLOOD_ROWS : [])];
}

/** Compact text legend: patterns plus words, so status is never colour alone. */
export function StatusLegend({
  className = "",
  showStatus,
  showFlood,
}: {
  className?: string;
  /** Override for tests; defaults to the "Path status" setting. */
  showStatus?: boolean;
  /** Override for tests; defaults to "a scenario is chosen and the flood lens is on". */
  showFlood?: boolean;
}) {
  const setting = useSceneSettings((s) => s.pathStatus);
  const pathStatus = showStatus ?? setting;
  const sceneFlood = useScene((s) => !!s.scenarioId && s.lensVisible.flood);
  const floodOn = showFlood ?? sceneFlood;
  return (
    <ul
      aria-label="Path status legend"
      className={`m-0 list-none space-y-0.5 text-fg px-2 py-1.5 text-xs ${className}`}
    >
      {legendRows(pathStatus, floodOn).map((s) => {
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
                strokeLinecap="butt"
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
