import { useScenarios } from "../../lib/api";
import { isPlaceholderSource } from "../../lib/evidence";
import { Icon } from "../../ui/icons";
import { StatusChip } from "../../ui/StatusChip";
import type { StatusKey } from "../../ui/status";
import type { AssistantMessage } from "../chat/chatReducer";
import { useElementNames } from "../chat/useElementNames";
import { useScene } from "../scene/sceneStore";
import { useEffectiveView } from "../scene/useMapStyle";
import { RouteSketch } from "./RouteSketch";

/** Route status -> chip. OSM-derived "confirmed" is never called Verified (honesty rule). */
export const ROUTE_CHIP: Record<string, { status: StatusKey; label: string }> = {
  confirmed: { status: "clear", label: "No known barrier" },
  likely_ok: { status: "unchecked", label: "Likely OK (estimated)" },
  partly_unverified: { status: "unchecked", label: "Some parts not checked yet" },
  blocked: { status: "blocked", label: "Not passable" },
  no_data: { status: "gap", label: "No mapped connection (data gap)" },
};

export function RouteSummary({ m }: { m: AssistantMessage }) {
  const scenarios = useScenarios().data ?? [];
  const r = m.route;
  const chip = r?.status ? ROUTE_CHIP[r.status] : undefined;
  const sc = m.scenarioId ? scenarios.find((s) => s.id === m.scenarioId) : undefined;
  const flood =
    sc && typeof sc.stage_m === "number" && sc.stage_m > 0
      ? `River +${sc.stage_m} m · indicative`
      : null;
  // A bare "No known barrier" must never read as surveyed fact when the evidence is demo data.
  const demo = m.citations.some((c) => isPlaceholderSource(c.source_type));
  // "Show on map" flies to the scene's current route, so it is offered only on that route's card,
  // and only in the 3D view (List and Mapbox ignore focusRouteRequest).
  const isCurrent = useScene((s) => s.route?.id) === r?.id;
  const in3d = useEffectiveView() === "cesium";
  const names = useElementNames();
  if (!chip && !flood && !demo) return null;
  // From/to names come from the plan_route call's ids, looked up in the map layers.
  const plan = [...m.tools].reverse().find((t) => t.name === "plan_route");
  const nameOf = (v: unknown) => (typeof v === "string" ? names.get(v) : undefined);
  const canShow = Boolean(chip && r && isCurrent && in3d);
  const meters = chip && typeof r?.distanceM === "number" ? Math.round(r.distanceM) : null;
  const minutes =
    chip && typeof r?.minutes === "number" ? Math.max(1, Math.round(r.minutes)) : null;
  return (
    <div className="space-y-3 rounded-2xl border border-edge bg-raised p-3.5">
      {chip && r?.coords && (
        <RouteSketch
          coords={r.coords}
          from={nameOf(plan?.args?.from_id)}
          to={nameOf(plan?.args?.to_id)}
          onShow={canShow && r ? () => useScene.getState().requestRouteFocus(r.id) : undefined}
        />
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {chip && <StatusChip status={chip.status} label={chip.label} />}
        {demo && <StatusChip status="demo" />}
        {flood && <StatusChip status="likely" label={flood} />}
      </div>
      {(meters !== null || minutes !== null) && (
        <dl className="m-0 grid grid-cols-2 gap-3">
          {meters !== null && (
            <div>
              <dt className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-fg-soft">
                Distance
              </dt>
              <dd className="m-0 text-2xl font-semibold tracking-tight text-fg tabular-nums motion-safe:animate-[rise_420ms_cubic-bezier(.2,.7,.2,1)_both]">
                {meters.toLocaleString("en-US")} m
              </dd>
            </div>
          )}
          {minutes !== null && (
            <div>
              <dt className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-fg-soft">
                Walk
              </dt>
              <dd className="m-0 text-2xl font-semibold tracking-tight text-fg tabular-nums motion-safe:animate-[rise_420ms_120ms_cubic-bezier(.2,.7,.2,1)_both]">
                {minutes} min
              </dd>
            </div>
          )}
        </dl>
      )}
      {canShow && r && (
        <button
          type="button"
          onClick={() => useScene.getState().requestRouteFocus(r.id)}
          className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-accent px-3 text-sm font-medium text-on-accent transition hover:opacity-90"
        >
          <Icon name="route" className="size-4" />
          Show on map
        </button>
      )}
    </div>
  );
}
