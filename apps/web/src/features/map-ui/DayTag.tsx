import { useDay } from "../../lib/api";
import { DAY_LEGEND, DAY_STYLE, hhmm } from "../day/dayModel";
import { useScene } from "../scene/sceneStore";
import { InSlot } from "./mapSlots";

/** Legend chip while Elmina Day plays: the clock, what the dot colours mean, and that the
 * residents are synthetic and the day a rehearsal, not a forecast. */
export function DayTag() {
  const on = useScene((s) => s.day.on);
  const t = useScene((s) => s.day.t);
  const playing = useScene((s) => s.day.playing);
  const setDay = useScene((s) => s.setDay);
  const scenario = useScene((s) => s.day.scenario);
  const q = useDay(scenario, on);
  const tr = (q.data as { tracks?: { shown?: number; of?: number } } | undefined)?.tracks;
  if (!on) return null;
  return (
    <InSlot name="sim">
      <div
        role="note"
        className="flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-full border border-dashed border-lilac bg-surface/95 px-3 py-1 text-sm text-fg shadow-md"
      >
        <strong className="font-mono text-lilac">{hhmm(t)}</strong>
        <button
          type="button"
          aria-label={playing ? "Pause the rehearsal" : "Play the rehearsal"}
          aria-pressed={playing}
          onClick={() => setDay({ playing: !playing })}
          className="grid size-8 place-items-center rounded-full text-fg hover:bg-raised"
        >
          <span aria-hidden="true">{playing ? "❚❚" : "▶"}</span>
        </button>
        <span className="text-xs">{DAY_LEGEND}</span>
        {tr?.shown ? (
          <span className="text-xs text-fg-soft">
            showing {tr.shown.toLocaleString()} of {(tr.of ?? 0).toLocaleString()}
          </span>
        ) : null}
        {(Object.keys(DAY_STYLE) as (keyof typeof DAY_STYLE)[]).map((k) => (
          <span key={k} className="flex items-center gap-1 text-xs text-fg-soft">
            <svg width="10" height="10" aria-hidden="true">
              <circle cx="5" cy="5" r="4" fill={DAY_STYLE[k].color} stroke="#000" strokeWidth="1" />
            </svg>
            {DAY_STYLE[k].label}
          </span>
        ))}
        <button
          type="button"
          aria-label="Stop the rehearsal"
          onClick={() => setDay({ on: false, playing: false })}
          className="grid size-8 place-items-center rounded-full text-fg-soft hover:bg-raised"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </InSlot>
  );
}
