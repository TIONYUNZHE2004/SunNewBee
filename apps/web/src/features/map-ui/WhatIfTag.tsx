import { useScene } from "../scene/sceneStore";
import { useEffectiveView } from "../scene/useMapStyle";
import { WHATIF_LEGEND, WHATIF_STYLE } from "../whatif/whatifModel";

/** Legend chip while a what-if diff is on the map: imagined lines are never mistaken for routes. */
export function WhatIfTag() {
  const whatIf = useScene((s) => s.whatIf);
  const clear = useScene((s) => s.clearWhatIf);
  const view = useEffectiveView();
  const drawn = view !== "list"; // the 3D and lite maps draw the diff; the list spells it out
  if (!whatIf) return null;
  return (
    <div
      role="note"
      className="absolute left-4 top-20 z-10 flex max-w-[calc(100%-2rem)] flex-wrap items-center gap-x-3 gap-y-1 rounded-full border border-dashed border-lilac bg-surface/95 py-1 pl-3 pr-1 text-sm text-fg shadow-md"
    >
      <strong className="text-lilac">{WHATIF_LEGEND}</strong>
      {!drawn && <span className="text-xs text-fg-soft">Listed below</span>}
      {(drawn ? (["before", "after", "touched"] as const) : []).map((k) => (
        <span key={k} className="flex items-center gap-1 text-xs text-fg-soft">
          <svg width="18" height="8" aria-hidden="true">
            <line
              x1="1"
              y1="4"
              x2="17"
              y2="4"
              stroke={WHATIF_STYLE[k].color}
              strokeWidth="4"
              strokeDasharray={k === "before" ? "4 3" : undefined}
            />
          </svg>
          {WHATIF_STYLE[k].label}
        </span>
      ))}
      <button
        type="button"
        aria-label="Clear what-if from map"
        onClick={clear}
        className="grid size-11 place-items-center rounded-full text-fg-soft hover:bg-raised"
      >
        ×
      </button>
    </div>
  );
}
