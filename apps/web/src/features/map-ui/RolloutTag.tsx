import { useRiverRollout } from "../../lib/api";
import { useScene } from "../scene/sceneStore";
import { useEffectiveView } from "../scene/useMapStyle";
import { RESIDENT_STYLE, ROLLOUT_LEGEND } from "../whatif/rolloutModel";
import { InSlot } from "./mapSlots";

/** Legend while synthetic residents are on the map: always labelled a simulation. */
export function RolloutTag() {
  const rollout = useScene((s) => s.rollout);
  const setRollout = useScene((s) => s.setRollout);
  const q = useRiverRollout(rollout.on);
  const drawn = useEffectiveView() === "cesium";
  if (!rollout.on) return null;
  const stage = q.data?.stages[rollout.stage];
  return (
    <InSlot name="sim">
      <div
        role="note"
        className="flex max-w-[min(28rem,100%)] flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-dashed border-lilac bg-surface/95 py-1 pl-3 pr-1 text-sm text-fg shadow-md"
      >
        <strong className="text-lilac">{stage?.label ?? "Rising river"}</strong>
        <span className="text-xs text-fg-soft">{ROLLOUT_LEGEND}</span>
        {drawn ? (
          Object.values(RESIDENT_STYLE).map((s) => (
            <span key={s.label} className="flex items-center gap-1 text-xs text-fg-soft">
              <span
                aria-hidden="true"
                className="inline-block size-2.5 rounded-full"
                style={{ background: s.color }}
              />
              {s.label}
            </span>
          ))
        ) : (
          <span className="text-xs text-fg-soft">Residents are drawn on the 3D map</span>
        )}
        <button
          type="button"
          aria-label="Stop the rising-river simulation"
          onClick={() => setRollout({ on: false, playing: false })}
          className="grid size-11 place-items-center rounded-full text-fg-soft hover:bg-raised"
        >
          ×
        </button>
      </div>
    </InSlot>
  );
}
