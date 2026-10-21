import type { StateAt } from "./types";

function Cell({ id, value, label }: { id: string; value: string; label: string }) {
  return (
    <div className="px-2 text-center">
      <b data-testid={id} className="block whitespace-nowrap text-lg tabular-nums leading-tight">
        {value}
      </b>
      <span className="text-[11px] uppercase tracking-wide text-fg">{label}</span>
    </div>
  );
}

/**
 * Development Simulation HUD (spec §4.1): Act · Simulated time · Homes occupied. Display values of
 * the simulation clock, under the "Simulation · illustrative" badge; never cited as facts (§3).
 */
export function DevsimHud({ state }: { state: StateAt }) {
  return (
    <div data-testid="devsim-hud" aria-live="off" className="glass rounded-2xl px-2 py-1.5 text-fg">
      <div className="grid grid-cols-3 gap-1">
        <Cell id="devsim-hud-act" value={state.act} label="Act" />
        <Cell id="devsim-hud-when" value={state.simClock.label} label="Simulated time" />
        <Cell id="devsim-hud-homes" value={String(state.occupancy)} label="Homes occupied" />
      </div>
    </div>
  );
}
