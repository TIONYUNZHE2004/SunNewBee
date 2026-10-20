import { ERROR_COPY, LOADING_COPY } from "../../devsim/copy";
import { DevsimHud } from "../../devsim/DevsimHud";
import { useDevsim } from "../../devsim/devsimStore";
import { EndCard } from "../../devsim/EndCard";
import { HypotheticalLabel } from "../../devsim/HypotheticalLabel";
import { NOT_AVAILABLE } from "../../devsim/intent";
import { PlaybackBar } from "../../devsim/PlaybackBar";
import { RouteTag } from "../../devsim/RouteTag";
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
 * HUD and player, the acts, the bubbles as quotes with speaker and tag, and the end card.
 */
export function DevsimListSection() {
  useDevsimDriver();
  const plan = useDevsim((s) => s.plan);
  const t = useDevsim((s) => s.t);
  const status = useDevsim((s) => s.status);
  if (status === "idle") return null;
  if (!plan)
    return (
      <section aria-label="Development simulation" data-testid="devsim-list">
        <p
          role={status === "loading" ? "status" : "alert"}
          data-testid="devsim-status"
          className="rounded-lg border border-line bg-card px-4 py-3 text-sm text-fg"
        >
          {status === "unavailable"
            ? NOT_AVAILABLE
            : status === "error"
              ? ERROR_COPY
              : LOADING_COPY}
        </p>
      </section>
    );
  const st = stateAt(t, plan);
  const { acts, quotes } = devsimListModel(plan, t);
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
      <DevsimHud state={st} />
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
      {st.endCard && <EndCard card={plan.end_card} inline />}
    </section>
  );
}
