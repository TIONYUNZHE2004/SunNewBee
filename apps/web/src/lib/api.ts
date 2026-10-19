import { useQuery } from "@tanstack/react-query";
import { makeClient, type Schemas } from "@tl/api-client";
import type { Lens, Profile } from "../features/scene/sceneStore";
import { DEMO_ORIGIN_ID, type PlaceReach, placeQueryParams } from "./placeQuery";

export const api = makeClient("/api");

function unwrap<T>(r: { data?: T; error?: unknown }): T {
  if (r.data === undefined) throw new Error("Request failed");
  return r.data;
}

export const useSite = () =>
  useQuery({ queryKey: ["site"], queryFn: async () => unwrap(await api.GET("/site")) });

/** What the resident assistant covers (T-011). Features outside access and flood, such as
 * Rehearse my trip, show in the resident screen only under "all"; until the answer arrives the
 * screen keeps to the default scope. */
export const useAssistantScope = () =>
  useQuery({
    queryKey: ["assistant-scope"],
    queryFn: async () => unwrap(await api.GET("/assistant/scope")).scope,
    staleTime: Number.POSITIVE_INFINITY,
  });

export const showsResidentTrip = (scope: string | undefined) => scope === "all";

export const useLayer = (lens: Lens, profile: Profile, scenarioId: string | null, enabled = true) =>
  useQuery({
    enabled,
    queryKey: ["layer", lens, profile, scenarioId],
    queryFn: async () =>
      unwrap(
        await api.GET("/layers/{lens}", {
          params: { path: { lens }, query: { profile, scenario_id: scenarioId } },
        }),
      ),
  });

/** Gap map payload: per edge and place, how many facts are not yet checked. */
export const useGaps = (profile: Profile, enabled = true) =>
  useQuery({
    enabled,
    queryKey: ["layer", "gaps", profile],
    queryFn: async () => unwrap(await api.GET("/layers/gaps", { params: { query: { profile } } })),
  });

export const useScenarios = () =>
  useQuery({ queryKey: ["scenarios"], queryFn: async () => unwrap(await api.GET("/scenarios")) });

export const useScenarioWater = (id: string | null) =>
  useQuery({
    queryKey: ["scenario", id],
    enabled: !!id,
    queryFn: async () =>
      unwrap(
        await api.GET("/scenarios/{scenario_id}", {
          params: { path: { scenario_id: id as string } },
        }),
      ),
  });

/** Evacuation centres reachability. May 404/empty under API stubs: callers treat errors as "none". */
export const useEvacCentres = (
  scenarioId: string | null,
  profile: Profile,
  near = DEMO_ORIGIN_ID,
) =>
  useQuery({
    queryKey: ["evac", scenarioId, profile, near],
    enabled: !!scenarioId,
    retry: false,
    queryFn: async () =>
      unwrap(
        await api.GET("/evacuation-centres", {
          params: { query: { scenario_id: scenarioId, profile, near } },
        }),
      ),
  });

/** Centres also take a scenario/profile so the card can show reachability from the demo start. */
export const usePlace = (id: string | null, reach?: PlaceReach) =>
  useQuery({
    queryKey: ["place", id, reach?.scenarioId ?? null, reach?.profile ?? null],
    enabled: !!id,
    retry: false,
    queryFn: async () =>
      unwrap(
        await api.GET("/places/{place_id}", {
          params: { path: { place_id: id as string }, query: placeQueryParams(reach) },
        }),
      ),
  });

/** Staff-reported closures in force now (public). Every row is labelled "Reported closure (staff)". */
export const useClosures = () =>
  useQuery({
    queryKey: ["closures", "active"],
    queryFn: async () =>
      unwrap(await api.GET("/closures", { params: { query: { active: true } } })),
  });

export type BuildingsLayer = Schemas["BuildingsLayer"];

/** Plain fetch (not the typed client) so a 404 is data, not an error: worlds without a buildings
 * seed simply render the plain scene. Any other failure throws. */
export async function fetchBuildings(
  fetchFn: typeof fetch = (...a) => fetch(...a),
): Promise<BuildingsLayer | null> {
  const r = await fetchFn("/api/layers/buildings");
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`buildings request failed (${r.status})`);
  return (await r.json()) as BuildingsLayer;
}

/** OSM buildings and trees for the stylised city; null when the world has none. Static per boot. */
export const useBuildings = () =>
  useQuery({
    queryKey: ["buildings"],
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    queryFn: () => fetchBuildings(),
  });

export type StreetFurnitureLayer = Schemas["StreetFurnitureLayer"];

/** Plain fetch, like `fetchBuildings`: a 404 (no street furniture seed) is data (null), not an error. */
export async function fetchStreetFurniture(
  fetchFn: typeof fetch = (...a) => fetch(...a),
): Promise<StreetFurnitureLayer | null> {
  const r = await fetchFn("/api/layers/street_furniture");
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`street furniture request failed (${r.status})`);
  return (await r.json()) as StreetFurnitureLayer;
}

/** Fact-bearing street furniture for the stylised city (B-T7, display only); null when absent. */
export const useStreetFurniture = (enabled = true) =>
  useQuery({
    queryKey: ["street-furniture"],
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    queryFn: () => fetchStreetFurniture(),
  });

/** Rising-river rollout (synthetic residents per persona at every river stage). Deterministic per
 * world version and cached by the API; the first call on the seed takes about 15 s. */
export const useRiverRollout = (enabled: boolean) =>
  useQuery({
    queryKey: ["river-rollout"],
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => unwrap(await api.GET("/river-rollout", { params: { query: {} } })),
  });

/** Elmina Day: one simulated day of 5,000 synthetic residents (rehearsal, not a forecast).
 * Cached by the API per world version; the first call on the seed takes a few seconds. */
export const useDay = (scenario: string, enabled: boolean) =>
  useQuery({
    queryKey: ["day", scenario],
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () =>
      unwrap(await api.GET("/day/{scenario_id}", { params: { path: { scenario_id: scenario } } })),
  });

export const useDayScenarios = (enabled: boolean) =>
  useQuery({
    queryKey: ["day-scenarios"],
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => unwrap(await api.GET("/day/scenarios")),
  });
