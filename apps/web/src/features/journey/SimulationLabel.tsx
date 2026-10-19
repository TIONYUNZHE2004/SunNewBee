import { SIMULATION_LABEL } from "./cardContent";

/** Spec §6.4 / §7: always on screen while a journey is loaded. */
export function SimulationLabel() {
  return (
    <p
      role="note"
      aria-label={SIMULATION_LABEL}
      data-testid="journey-sim-label"
      className="glass inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold text-fg"
    >
      <span aria-hidden="true" className="size-2.5 rounded-full bg-[#f5c518]" />
      <span>
        Simulation{" "}
        <span className="font-normal text-fg-soft">· indicative times, not a prediction</span>
      </span>
    </p>
  );
}
