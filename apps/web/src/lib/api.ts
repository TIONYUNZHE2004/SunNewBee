import { useQuery } from "@tanstack/react-query";
import { makeClient } from "@tl/api-client";
import type { Lens, Profile } from "../features/scene/sceneStore";

export const api = makeClient("/api");

function unwrap<T>(r: { data?: T; error?: unknown }): T {
  if (r.data === undefined) throw new Error("Request failed");
  return r.data;
}

export const useSite = () =>
  useQuery({ queryKey: ["site"], queryFn: async () => unwrap(await api.GET("/site")) });

export const useLayer = (lens: Lens, profile: Profile, scenarioId: string | null) =>
  useQuery({
    queryKey: ["layer", lens, profile, scenarioId],
    queryFn: async () =>
      unwrap(
        await api.GET("/layers/{lens}", {
          params: { path: { lens }, query: { profile, scenario_id: scenarioId } },
        }),
      ),
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
  near = "lakeside-mall",
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
export const usePlace = (
  id: string | null,
  reach?: { scenarioId: string; profile: Profile; near?: string },
) =>
  useQuery({
    queryKey: ["place", id, reach?.scenarioId ?? null, reach?.profile ?? null],
    enabled: !!id,
    retry: false,
    queryFn: async () =>
      unwrap(
        await api.GET("/places/{place_id}", {
          params: {
            path: { place_id: id as string },
            query: reach
              ? {
                  scenario_id: reach.scenarioId,
                  profile: reach.profile,
                  near: reach.near ?? "lakeside-mall",
                }
              : {},
          },
        }),
      ),
  });
