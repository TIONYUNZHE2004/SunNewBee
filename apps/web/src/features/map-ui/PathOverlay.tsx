import { useMemo, useRef } from "react";
import { useLayer, useScenarios } from "../../lib/api";
import { StatusChip } from "../../ui/StatusChip";
import { type FloodEdge, type FloodScenario, floodPathView } from "../flood/floodPath";
import { useScene } from "../scene/sceneStore";
import { OVERLAY_CLASS, useOverlayA11y } from "./overlayA11y";

/** Pure card: provenance of a flood-coloured path. */
export function PathCard({
  edge,
  scenario,
  onClose,
}: {
  edge: FloodEdge;
  scenario: FloodScenario | undefined;
  onClose: () => void;
}) {
  const v = floodPathView(edge, scenario);
  const head = useRef<HTMLHeadingElement>(null);
  useOverlayA11y(head, onClose);
  const row = (k: string, val: string) => (
    <div className="grid gap-0.5">
      <dt className="font-medium">{k}</dt>
      <dd className="text-fg-soft">{val}</dd>
    </div>
  );
  const how = [v.method, v.dem, v.margin].filter(Boolean).join(". ");
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="path-overlay-h"
      className={OVERLAY_CLASS}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id="path-overlay-h" ref={head} tabIndex={-1} className="text-lg font-semibold">
          Why this path?
        </h2>
        <button
          type="button"
          aria-label="Close path details"
          onClick={onClose}
          className="min-h-11 min-w-11 shrink-0 rounded-lg border border-edge px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <p className="mt-1 text-sm text-fg-soft">{v.heading}</p>
      <dl className="mt-3 space-y-2 text-sm">
        {row("Scenario", v.scenario)}
        <div className="grid gap-1">
          <dt className="font-medium">Classification</dt>
          <dd>
            <StatusChip status={edge.flood_class === "likely_flooded" ? "likely" : "possibly"} />
          </dd>
        </div>
        {how && row("How it was worked out", how)}
        {row("Data", v.generated)}
        <p className="text-xs text-fg-soft">{v.datesNote}</p>
      </dl>
      <p className="mt-3 text-sm">
        <strong>Indicative only. </strong>
        {v.disclaimer}
      </p>
    </div>
  );
}

type Feature = { properties?: Record<string, unknown> | null };

/** Connected: opens for the selected flood path (map click or list row). */
export function PathOverlay() {
  const id = useScene((s) => s.selectedFloodEdgeId);
  const select = useScene((s) => s.selectFloodEdge);
  const scenarioId = useScene((s) => s.scenarioId);
  const profile = useScene((s) => s.profile);
  const layer = useLayer("flood", profile, scenarioId, !!id && !!scenarioId);
  const scenarios = useScenarios();
  const edge = useMemo<FloodEdge | null>(() => {
    if (!id) return null;
    const f = ((layer.data as { features?: Feature[] } | undefined)?.features ?? []).find(
      (x) => x?.properties?.id === id && x.properties?.flood_class,
    );
    return f
      ? {
          id,
          name: String(f.properties?.name ?? ""),
          flood_class: String(f.properties?.flood_class),
        }
      : null;
  }, [id, layer.data]);
  if (!edge) return null;
  const scenario = scenarios.data?.find((s) => s.id === scenarioId);
  return <PathCard key={edge.id} edge={edge} scenario={scenario} onClose={() => select(null)} />;
}
