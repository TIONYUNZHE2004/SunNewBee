import type { Schemas } from "@tl/api-client";
import type { JourneyPlan } from "../journey/timeline";
import type { AffectedResult } from "./impactModel";

export interface RiverStage {
  scenario: Schemas["Scenario"];
  water: unknown;
  affected: AffectedResult;
}
export interface ResidentTrip {
  origin: { id: string; name: string };
  centre: Schemas["CentreReachability"];
  plan: JourneyPlan;
  route: Schemas["RouteResult"];
  baseline: Schemas["RouteResult"] | null;
  missingCentres: number;
}
export interface FloodStory {
  stages: RiverStage[];
  resident: ResidentTrip | null;
  residentGap: string | null;
}

async function json<T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    signal,
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!response.ok) throw new Error(`Township data unavailable (${response.status}).`);
  return response.json() as Promise<T>;
}

/** Select the actual available river stages, not low-lying/combined scenarios with similar labels. */
export function riverStages(scenarios: Schemas["Scenario"][]): Schemas["Scenario"][] {
  return [0, 1, 2, 3].map((stage) => {
    const s = scenarios.find(
      (s) => (s.kind ?? "river_stage") === "river_stage" && s.stage_m === stage,
    );
    if (!s) throw new Error("The Normal to River +3 m sequence is not available in this township.");
    return s;
  });
}

/** A story example resolved against the current world. Names/ids never stand in for API facts. */
async function residentTrip(stage: string, signal: AbortSignal): Promise<ResidentTrip> {
  const search = await json<Schemas["ToolResult"]>("/places?q=Pangsapuri%20Cendana", signal);
  if (!search.ok || !Array.isArray(search.data))
    throw new Error("The residential starting place could not be checked.");
  const homes = (search.data as { id: string; name: string; type: string }[] | null) ?? [];
  const origin = homes.find((p) => p.type === "residential" && p.name === "Pangsapuri Cendana");
  if (!origin) throw new Error("No residential starting place is mapped for this story.");
  const centres = await json<Schemas["CentreReachability"][]>(
    `/evacuation-centres?scenario_id=${encodeURIComponent(stage)}&profile=wheelchair&near=${encodeURIComponent(origin.id)}`,
    signal,
  );
  const centre = nearestMappedCentre(centres);
  if (!centre)
    throw new Error(
      "No mapped wheelchair route to an evacuation candidate is available at River +3 m.",
    );
  const target = `__centre__${centre.centre.id}`;
  const [plan, route, baseline] = await Promise.all([
    json<JourneyPlan>("/journeys", signal, {
      from_id: origin.id,
      to_id: target,
      profile: "wheelchair",
      scenario_id: stage,
      start_time: "08:00",
    }),
    json<Schemas["RouteResult"]>("/routes", signal, {
      from: origin.id,
      to: target,
      profile: "wheelchair",
      scenario_id: stage,
    }),
    json<Schemas["RouteResult"]>("/routes", signal, {
      from: origin.id,
      to: target,
      profile: "wheelchair",
      scenario_id: "baseline",
    }).catch(() => null),
  ]);
  if (!plan.polyline.length || !plan.spans.length || !(plan.pace_m_per_s > 0))
    throw new Error("The mapped route has no playable journey data.");
  const sameRoute = route.routes.find((r) => r.id === plan.route_id);
  if (
    plan.profile !== "wheelchair" ||
    !sameRoute ||
    sameRoute.profile !== "wheelchair" ||
    sameRoute.from_place !== origin.id ||
    sameRoute.to_place !== target ||
    sameRoute.scenario_id !== stage
  )
    throw new Error("The route data changed while loading. Please try the story again.");
  return {
    origin,
    centre,
    plan,
    route,
    baseline,
    missingCentres: centres.filter((c) => c.route_status === "no_data").length,
  };
}

export function nearestMappedCentre(centres: Schemas["CentreReachability"][]) {
  return (
    centres
      .filter(
        (c) =>
          c.reachable &&
          c.distance_m != null &&
          Number.isFinite(c.distance_m) &&
          ["confirmed", "likely_ok", "partly_unverified"].includes(c.route_status),
      )
      .sort(
        (a, b) =>
          (a.distance_m as number) - (b.distance_m as number) ||
          a.centre.id.localeCompare(b.centre.id),
      )[0] ?? null
  );
}

/** No per-frame network calls. All stage counters come from affected(profile=wheelchair). */
export async function loadFloodStory(signal: AbortSignal): Promise<FloodStory> {
  const scenarios = riverStages(await json<Schemas["Scenario"][]>("/scenarios", signal));
  const stages = await Promise.all(
    scenarios.map(async (scenario) => {
      const path = `/scenarios/${encodeURIComponent(scenario.id)}`;
      const [water, affected] = await Promise.all([
        json<unknown>(path, signal),
        json<AffectedResult>(`${path}/affected?profile=wheelchair`, signal),
      ]);
      return { scenario, water, affected };
    }),
  );
  try {
    return { stages, resident: await residentTrip(scenarios[3]!.id, signal), residentGap: null };
  } catch (error) {
    if (signal.aborted) throw error;
    return {
      stages,
      resident: null,
      residentGap: error instanceof Error ? error.message : "Resident route data unavailable.",
    };
  }
}
