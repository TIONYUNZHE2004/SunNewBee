import { TRAVEL_LABELS } from "../map-ui/TravelLabels";
import type { Profile } from "../scene/sceneStore";
import { DEMO_CHIP } from "./cardContent";
import type { CoveredSpan, JourneyState } from "./timeline";

function Cell({ id, value, label }: { id: string; value: string; label: string }) {
  return (
    <div className="px-2 text-center">
      <b data-testid={id} className="block text-lg tabular-nums leading-tight">
        {value}
      </b>
      <span className="text-[11px] uppercase tracking-wide text-fg-soft">{label}</span>
    </div>
  );
}

/**
 * Journey HUD (spec §6.4): clock from the start time, distance walked, minutes outdoors (paused
 * under covered spans: verified roofs, and demo roofs too, which the HUD labels "Demo value · not
 * surveyed") and rests taken. All values come from `stateAt`; nothing is computed here.
 */
export function JourneyHud({
  state,
  covered,
  profile,
  distanceLabel = "Walked",
}: {
  state: JourneyState;
  covered: readonly CoveredSpan[];
  /** The persona the trip was planned for (the plan's own, never the selector's). */
  profile?: Profile;
  /** The flood wheelchair story uses "Travelled"; existing callers retain their label. */
  distanceLabel?: string;
}) {
  const demoRoof = covered.some((c) => c.demo);
  return (
    <div data-testid="journey-hud" className="glass rounded-2xl px-2 py-1.5 text-fg">
      <div className="grid grid-cols-4 gap-1">
        <Cell id="hud-clock" value={state.clock} label="Clock" />
        <Cell id="hud-walked" value={`${Math.round(state.distance_m)} m`} label={distanceLabel} />
        <Cell id="hud-outdoors" value={`${state.minutesOutdoors} min`} label="Outdoors" />
        <Cell id="hud-rests" value={String(state.restsTaken)} label="Rests" />
      </div>
      {profile && (
        <p data-testid="hud-planned-for" className="mt-1 px-2 text-[11px] text-fg-soft">
          Planned for: {TRAVEL_LABELS[profile]}
        </p>
      )}
      {demoRoof && (
        <p className="mt-1 px-2 text-[11px] text-fg-soft">
          Outdoor time pauses under a roof: {DEMO_CHIP}
        </p>
      )}
    </div>
  );
}
