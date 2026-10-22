import "./floodStory.css";
import { useEffect, useRef } from "react";
import { JourneyHud } from "../journey/JourneyHud";
import { JourneyMiniMap } from "../journey/JourneyMiniMap";
import { SimulationLabel } from "../journey/SimulationLabel";
import { stateAt } from "../journey/timeline";
import { usePanel } from "../main/panelStore";
import { WATER_LOOK_NOTE } from "./floodPresentation";
import { floodRouteEvidence } from "./floodRouteEvidence";
import { useFloodStory } from "./floodStoryStore";
import { floodStateAt } from "./floodTimeline";
import { impactSummary } from "./impactModel";

export function FloodStoryOverlay() {
  const s = useFloodStory();
  const wasOpen = useRef(false);
  const active = s.status !== "idle";
  useEffect(() => {
    if (!active) return;
    wasOpen.current = usePanel.getState().open;
    usePanel.getState().setOpen(false);
    return () => usePanel.getState().setOpen(wasOpen.current);
  }, [active]);
  useEffect(() => {
    if (!s.playing || s.status !== "ready") return;
    let id = 0;
    let last = performance.now();
    const tick = (now: number) => {
      useFloodStory.getState().advance(Math.min(0.2, Math.max(0, (now - last) / 1000)));
      last = now;
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [s.playing, s.status]);
  if (!active) return null;
  const p = s.timeline ? floodStateAt(s.t, s.timeline) : null;
  const stage = s.story && p ? s.story.stages[p.stage] : null;
  const impact = impactSummary(stage?.affected);
  const trip = s.story?.resident;
  const journey = p && s.timeline?.journey ? stateAt(s.timeline.journey, p.journeyT) : null;
  const residentOn = p?.phase === "resident";
  const routeEvidence =
    trip && s.story?.stages[3] ? floodRouteEvidence(trip, s.story.stages[3].affected) : null;
  const route =
    trip?.route.routes.find((r) => r.id === trip.plan.route_id) ?? trip?.route.routes[0];
  return (
    <div
      data-testid="flood-story"
      data-phase={p?.phase ?? s.status}
      data-stage={stage?.scenario.id}
      className="pointer-events-none absolute inset-0 z-30 text-fg"
    >
      <div className="absolute top-20 left-4 right-4 flex flex-wrap items-start justify-between gap-3 sm:left-6 sm:right-6">
        <section
          className="glass max-w-xl rounded-2xl px-4 py-3 shadow-lg"
          aria-label="River scenario"
        >
          <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-fg-soft">
            Elmina · River-rise rehearsal
          </p>
          <h2 className="mt-1 text-xl font-semibold sm:text-2xl">
            {stage
              ? stage.scenario.stage_m === 0
                ? "Normal river level"
                : `River +${stage.scenario.stage_m} m`
              : "Loading the river story"}
          </h2>
          <p className="mt-1 text-xs font-semibold">Indicative scenario, not a forecast.</p>
          <p className="mt-1 text-[11px] text-fg-soft">{WATER_LOOK_NOTE}</p>
        </section>
        {impact && (
          <section
            aria-label="Scenario impact counters"
            className="glass rounded-2xl px-3 py-3 shadow-lg"
          >
            <div className="grid grid-cols-3 gap-4 text-center">
              <Counter
                value={String(impact.flooded)}
                label="Places likely flooded"
                id="flood-count"
              />
              <Counter value={String(impact.cutOff)} label="Places cut off" id="cut-off-count" />
              <Counter value={impact.pathLength} label="Paths likely flooded" id="path-count" />
            </div>
            <p className="mt-2 text-center text-[10px] text-fg-soft">
              Mapped places and paths · wheelchair profile
            </p>
          </section>
        )}
      </div>
      {residentOn && trip && journey && s.timeline?.journey && (
        <div className="absolute top-72 left-4 max-w-[360px] sm:top-56 space-y-2 sm:left-6">
          <section className="glass rounded-2xl p-3 text-xs">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-soft">
              One resident · wheelchair
            </p>
            <p className="mt-1 font-semibold">
              {trip.origin.name} → {trip.centre.centre.name}
            </p>
            <p className="mt-1">
              Nearest candidate with a mapped route ·{" "}
              {trip.route.status === "confirmed" ? "No known barrier" : "Access not checked yet"}
            </p>
            <p className="mt-1 font-semibold">
              {trip.centre.centre.source === "official_pps"
                ? "Official PPS (API source)"
                : "OSM candidate · not an official relief centre"}
            </p>
            {route && (
              <p className="mt-1">
                Mapped route: {route.distance_m.toFixed(1)} m · est. {route.est_minutes.toFixed(1)}{" "}
                min
              </p>
            )}
            {routeEvidence?.kind === "unchanged" && (
              <p className="mt-1 text-fg-soft">
                The mapped route is unchanged from Normal. A flood detour is not shown here.
              </p>
            )}
            {routeEvidence?.kind === "detour" && (
              <p className="mt-1 font-semibold">Likely flooded (indicative) — route goes around</p>
            )}
            {journey.event?.kind === "unknown" && (
              <p className="mt-1 font-semibold">{journey.event.body}</p>
            )}
            {trip.route.demo_evidence && <p className="mt-1">Demo value · not surveyed</p>}
            <p className="mt-1 text-fg-soft">
              {trip.missingCentres} centres have no mapped connection (data gap).
            </p>
          </section>
          <JourneyHud state={journey} covered={s.timeline.journey.covered} profile="wheelchair" />
          <div className="hidden sm:block">
            <JourneyMiniMap plan={trip.plan} distanceM={journey.distance_m} />
          </div>
        </div>
      )}
      {residentOn && !trip && (
        <div
          className="glass absolute top-56 left-6 max-w-md rounded-2xl p-4 text-sm"
          role="status"
        >
          {s.story?.residentGap}
        </div>
      )}
      {p?.phase === "end" && impact && (
        <FloodEndCard flooded={impact.flooded} cutOff={impact.cutOff} paths={impact.pathLength} />
      )}
      {(s.status === "loading" || s.status === "error") && (
        <section
          className="glass pointer-events-auto absolute top-1/2 left-1/2 w-[min(90%,440px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5"
          role="status"
        >
          <p className="text-base font-semibold">
            {s.status === "error"
              ? "The river story is unavailable"
              : "Loading the mapped river stages…"}
          </p>
          <p className="mt-2 text-sm text-fg-soft">
            {s.error ?? "Checking scenario areas, affected places and the resident route."}
          </p>
        </section>
      )}
      <div className="absolute right-4 bottom-16 left-4 mx-auto flex max-w-[820px] flex-col gap-2 sm:right-6 sm:left-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SimulationLabel />
          <p className="glass rounded-full px-3 py-1 text-[11px]">
            Decorative people and water motion are illustrative.
          </p>
        </div>
        <section
          className="glass pointer-events-auto rounded-2xl px-4 py-3"
          aria-label="River playback controls"
        >
          <div className="mb-2 flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold">
              {p?.phase === "buildings"
                ? "Where the water meets buildings"
                : residentOn
                  ? "Follow one resident"
                  : p?.phase === "end"
                    ? "What this model can show"
                    : "Watch the river rise"}
            </span>
            <span className="tabular-nums text-fg-soft">
              {Math.floor(s.t)} / {Math.ceil(s.timeline?.total ?? 0)} s
            </span>
          </div>
          <input
            className="block w-full accent-lilac"
            type="range"
            aria-label="River story time"
            min="0"
            max={s.timeline?.total ?? 1}
            step="0.1"
            value={s.t}
            disabled={!s.timeline}
            onChange={(e) => s.seek(Number(e.target.value))}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Control disabled={!s.timeline} onClick={s.playing ? s.pause : s.play}>
              {s.playing ? "Pause" : "Play"}
            </Control>
            <Control
              disabled={!s.timeline}
              onClick={() => {
                s.seek(0);
                s.play();
              }}
            >
              Restart
            </Control>
            <span className="flex-1" />
            <Control onClick={s.close}>Exit story</Control>
          </div>
        </section>
      </div>
    </div>
  );
}

function Counter({ value, label, id }: { value: string; label: string; id: string }) {
  return (
    <div>
      <b
        key={value}
        data-testid={id}
        className="flood-counter block text-xl tabular-nums sm:text-2xl"
      >
        {value}
      </b>
      <span className="mt-1 block max-w-28 text-[10px] leading-tight text-fg-soft">{label}</span>
    </div>
  );
}
function Control({
  children,
  onClick,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick(): void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-full border border-edge bg-surface px-4 py-1.5 text-xs font-semibold text-fg hover:bg-raised disabled:opacity-50"
    >
      {children}
    </button>
  );
}
function FloodEndCard({
  flooded,
  cutOff,
  paths,
}: {
  flooded: number;
  cutOff: number;
  paths: string;
}) {
  return (
    <section
      aria-label="River scenario limits"
      className="glass pointer-events-auto absolute top-1/2 left-1/2 w-[min(90%,520px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl p-6 shadow-xl"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-fg-soft">
        River +3 m · indicative
      </p>
      <h2 className="mt-2 text-2xl font-semibold">A scenario, not a prediction</h2>
      <p className="mt-3 text-sm">
        {flooded} places likely flooded · {cutOff} places cut off · {paths} of mapped paths likely
        flooded.
      </p>
      <ul className="mt-4 list-disc space-y-2 pl-4 text-sm text-fg-soft">
        <li>30 m surface model; building and tree detail can affect the terrain screen.</li>
        <li>Drains are not modelled.</li>
        <li>Flash floods from heavy rain are not shown.</li>
        <li>Unmarked areas and a mapped route do not verify access.</li>
      </ul>
      <p className="mt-4 text-xs font-semibold">
        Follow official{" "}
        <a className="underline" href="https://www.mbsa.gov.my" target="_blank" rel="noreferrer">
          MBSA
        </a>{" "}
        /{" "}
        <a
          className="underline"
          href="https://publicinfobanjir.water.gov.my"
          target="_blank"
          rel="noreferrer"
        >
          JPS
        </a>{" "}
        /{" "}
        <a className="underline" href="https://www.nadma.gov.my" target="_blank" rel="noreferrer">
          NADMA
        </a>{" "}
        guidance.
      </p>
    </section>
  );
}
