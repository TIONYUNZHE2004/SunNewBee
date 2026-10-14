import type { Profile } from "../features/scene/sceneStore";

/** Fixed demo start point for evacuation reachability. Not the user's location. */
export const DEMO_ORIGIN_ID = "lakeside-mall";
export const DEMO_ORIGIN_NAME = "Elmina Lakeside Mall";

export const originName = (id: string | null | undefined): string =>
  !id || id === DEMO_ORIGIN_ID ? DEMO_ORIGIN_NAME : id;

export interface PlaceReach {
  scenarioId: string;
  profile: Profile;
  near?: string;
}

/** Only evacuation centres, and only while a scenario is on, ask for reachability. */
export function placeReach(
  id: string,
  scenarioId: string | null,
  profile: Profile,
): PlaceReach | undefined {
  return id.startsWith("evc-") && scenarioId ? { scenarioId, profile } : undefined;
}

export function placeQueryParams(reach?: PlaceReach) {
  return reach
    ? {
        scenario_id: reach.scenarioId,
        profile: reach.profile,
        near: reach.near ?? DEMO_ORIGIN_ID,
      }
    : {};
}
