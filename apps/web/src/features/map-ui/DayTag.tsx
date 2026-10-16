import { DAY_LEGEND, DAY_STYLE, hhmm } from "../day/dayModel";
import { useScene } from "../scene/sceneStore";

/** Legend chip while Elmina Day plays: the clock, what the dot colours mean, and that the
 * residents are synthetic and the day a rehearsal, not a forecast. */
export function DayTag() {
  const day = useScene((s) => s.day);
  if (!day.on) return null;
  return (
    <div
      role="note"
      className="absolute left-4 top-32 z-10 flex max-w-[calc(100%-2rem)] flex-wrap items-center gap-x-3 gap-y-1 rounded-full border border-dashed border-lilac bg-surface/95 px-3 py-1 text-sm text-fg shadow-md"
    >
      <strong className="font-mono text-lilac">{hhmm(day.t)}</strong>
      <span className="text-xs">{DAY_LEGEND}</span>
      {(Object.keys(DAY_STYLE) as (keyof typeof DAY_STYLE)[]).map((k) => (
        <span key={k} className="flex items-center gap-1 text-xs text-fg-soft">
          <svg width="10" height="10" aria-hidden="true">
            <circle cx="5" cy="5" r="4" fill={DAY_STYLE[k].color} stroke="#000" strokeWidth="1" />
          </svg>
          {DAY_STYLE[k].label}
        </span>
      ))}
    </div>
  );
}
