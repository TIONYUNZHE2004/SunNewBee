import { useQuery } from "@tanstack/react-query";
import { makeClient } from "@tl/api-client";
import type { Lens, Profile } from "../features/scene/sceneStore";
import { DEMO_ORIGIN_ID, type PlaceReach, placeQueryParams } from "./placeQuery";

export const api = makeClient("/api");

function unwrap<T>(r: { data?: T; error?: unknown }): T {
  if (r.data === undefined) throw new Error("Request failed");
  return r.data;
}

export const useSite = () =>
  useQuery({ queryKey: ["site"], queryFn: async () => unwrap(await api.GET("/site")) });

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
