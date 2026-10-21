import { BuildBanner, HoardingCard, TimedTagCard } from "../../devsim/BuildCards";
import { bannersAt, hoardingCardOn, hudAt, tagsAt } from "../../devsim/buildModel";
import { EstimateHud } from "../../devsim/DevsimHud";
import { DevsimStatusNotice } from "../../devsim/DevsimStatus";
import { useDevsim } from "../../devsim/devsimStore";
import { HypotheticalLabel } from "../../devsim/HypotheticalLabel";
import { ImpactBrief } from "../../devsim/ImpactBrief";
import { PlaybackBar } from "../../devsim/PlaybackBar";
import { RouteTag } from "../../devsim/RouteTag";
import { ResidentsLayer } from "../../devsim/residents/ResidentsLayer";
import { ScheduleBar } from "../../devsim/ScheduleBar";
import { SimBadge } from "../../devsim/SimBadge";
import { stateAt } from "../../devsim/timeline";
import { useDevsimDriver } from "../../devsim/useDevsimDriver";
import { useScene } from "../sceneStore";
import { devsimListModel } from "./devsimListModel";

const ACT_DOT: Record<string, string> = {
  done: "bg-ok",
  on: "bg-[#f5c518] ring-2 ring-[#f5c518]/40",
  todo: "bg-edge",
};

/**
 * Development Simulation, text version (List view / no WebGL, spec §5.3, AC-H6): the labels, the
 * estimate HUD, schedule bar and player, the acts, the banners, cards and tags on now, the bubbles
 * as quotes with speaker and tag, and from 33 s the simulated residents and the Impact Brief.
 */
export function DevsimListSection() {
  useDevsimDriver();
  const plan = useDevsim((s) => s.plan);
  const t = useDevsim((s) => s.t);
  const playing = useDevsim((s) => s.playing);
  const status = useDevsim((s) => s.status);
  if (status === "idle") return null;
  if (!plan)
    return (
      <section aria-label="Development simulation" data-testid="devsim-list">
        <DevsimStatusNotice
          status={status}
          onClose={() => useScene.getState().stopDevsim()}
          className="rounded-lg border border-line bg-card px-4 py-3"
        />
      </section>
    );
  const st = stateAt(t, plan);
  const { acts, quotes } = devsimListModel(plan, t);
  const hud = hudAt(plan, t);
  const banners = bannersAt(plan, t);
  const tags = tagsAt(plan, t);
  return (
    <section
      aria-labelledby="devsim-h"
      data-testid="devsim-list"
      className="space-y-4 rounded-lg border border-line bg-card p-4"
    >
      <h2 id="devsim-h" className="m-0 text-xl font-semibold">
        Development simulation
      </h2>
      <div className="flex flex-wrap items-start gap-2">
        <SimBadge text={plan.labels.simulation} />
        <HypotheticalLabel text={plan.labels.hypothetical} />
      </div>
      <EstimateHud
        schedule={plan.schedule}
        at={hud.at}
        sources={plan.estimate_sources}
        occupancy={hud.occupancy}
      />
      <ScheduleBar schedule={plan.schedule} month={hud.month} />
      <PlaybackBar onClose={() => useScene.getState().stopDevsim()} />
      <ol aria-label="Acts" className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0">
        {acts.map((a) => (
          <li
            key={a.name}
            aria-current={a.state === "on" ? "step" : undefined}
            data-state={a.state}
            className={`flex items-center gap-2 text-sm ${a.state === "todo" ? "text-fg-soft" : "font-semibold text-fg"}`}
          >
            <span aria-hidden="true" className={`size-2.5 rounded-full ${ACT_DOT[a.state]}`} />
            {a.name}
          </li>
        ))}
      </ol>
      {(banners.length > 0 || tags.length > 0 || hoardingCardOn(t)) && (
        <div className="flex flex-wrap items-start gap-2">
          {banners.map((b) => (
            <BuildBanner key={b.kind} banner={b} plan={plan} />
          ))}
          {hoardingCardOn(t) && <HoardingCard plan={plan} />}
          {tags.map((g) => (
            <TimedTagCard key={g.kind} tag={g} />
          ))}
        </div>
      )}
      <div>
        <h3 className="m-0 text-base font-semibold">Simulated reactions</h3>
        <ol className="mt-2 space-y-2 p-0">
          {quotes.map((q) => (
            <li
              key={q.n}
              data-testid="devsim-quote"
              data-speaking={q.speaking || undefined}
              className={`list-none rounded-lg border-2 px-3 py-2 ${
                q.tone === "neg" ? "border-rose" : "border-ok"
              } ${q.speaking ? "bg-surface" : "bg-card"} ${q.heard ? "" : "border-dashed"}`}
            >
              <figure className="m-0">
                <blockquote
                  className={`m-0 text-[15px] text-fg ${q.heard ? "font-semibold" : "font-normal"}`}
                >
                  “{q.text}”
                </blockquote>
                <figcaption className="mt-0.5 text-xs text-fg-soft">
                  {q.speaker}
                  {q.role ? `, ${q.role}` : ""}
                </figcaption>
              </figure>
              {q.tag && <RouteTag tag={q.tag} />}
            </li>
          ))}
        </ol>
      </div>
      {st.brief && <ResidentsLayer data={plan.residents} t={t} playing={playing} />}
      {st.brief && <ImpactBrief plan={plan} inline />}
    </section>
  );
}
