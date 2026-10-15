import { useEffect, useMemo, useRef } from "react";
import { useLayer, useScenarios } from "../../lib/api";
import { useScene } from "../scene/sceneStore";
import { type FloodEdge, type FloodScenario, floodPathView } from "./floodPath";

/** Pure card: provenance of a flood-coloured path. Heading is focused on open; Escape closes. */
export function FloodPathCard({
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
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    head.current?.focus();
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);
  // Escape also works after a map click moved focus out of the card (the canvas has no key handler).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const row = (k: string, val: string) => (
    <div className="grid gap-0.5 sm:grid-cols-[9rem_1fr]">
      <dt className="font-medium">{k}</dt>
      <dd>{val}</dd>
    </div>
  );
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="fp-h"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
      className="fixed bottom-[calc(var(--demo-bar-h,0px)+1rem)] left-4 right-4 z-30 max-h-[70vh] overflow-y-auto rounded-lg border border-[#DD6B20] bg-card p-4 shadow-lg sm:left-auto sm:w-96"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id="fp-h" ref={head} tabIndex={-1} className="text-lg font-semibold">
          Why this path?
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 rounded-md border border-line px-3 text-sm"
        >
          Close
        </button>
      </div>
      <p className="mt-1 text-sm text-ink-soft">{v.heading}</p>
      <dl className="mt-3 space-y-2 text-sm">
        {row("Scenario", v.scenario)}
        {row("Class", `${v.className} (indicative)`)}
        {v.method && row("Method", v.method)}
        {v.dem && row("Elevation data", v.dem)}
        {v.margin && row("Margin", v.margin)}
        {row("Data", v.generated)}
        <p className="text-xs text-ink-soft">{v.datesNote}</p>
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
export function FloodPathPopover() {
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
  return (
    <FloodPathCard key={edge.id} edge={edge} scenario={scenario} onClose={() => select(null)} />
  );
}
