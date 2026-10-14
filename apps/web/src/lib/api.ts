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
