import { useScenarios } from "../../lib/api";
import { isPlaceholderSource } from "../../lib/evidence";
import { Icon } from "../../ui/icons";
import { StatusChip } from "../../ui/StatusChip";
import type { StatusKey } from "../../ui/status";
import type { AssistantMessage } from "../chat/chatReducer";
import { useScene } from "../scene/sceneStore";

/** Route status -> chip. OSM-derived "confirmed" is never called Verified (honesty rule). */
export const ROUTE_CHIP: Record<string, { status: StatusKey; label: string }> = {
  confirmed: { status: "clear", label: "No known barrier" },
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
    sc && typeof sc.stage_m === "number" && sc.stage_m > 0 ? `+${sc.stage_m} m · indicative` : null;
  if (!chip && !flood) return null;
  // A bare "No known barrier" must never read as surveyed fact when the evidence is demo data.
  const demo = m.citations.some((c) => isPlaceholderSource(c.source_type));
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-brand-tint px-3 py-2">
      {chip && <StatusChip status={chip.status} label={chip.label} />}
      {chip && demo && <StatusChip status="demo" />}
      {chip && typeof r?.distanceM === "number" && (
        <span className="text-xs font-semibold text-fg">{Math.round(r.distanceM)} m</span>
      )}
      {chip && typeof r?.minutes === "number" && (
        <span className="text-xs font-semibold text-fg">
          {Math.max(1, Math.round(r.minutes))} min
        </span>
      )}
      {flood && <StatusChip status="likely" label={flood} />}
      {chip && r && (
        <button
          type="button"
          onClick={() => useScene.getState().requestRouteFocus(r.id)}
          className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-full border border-edge px-3 text-xs font-semibold text-fg hover:border-accent"
        >
          <Icon name="route" className="size-4" />
          Show on map
        </button>
      )}
    </div>
  );
}
