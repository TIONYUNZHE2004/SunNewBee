import { useScene } from "../scene/sceneStore";
import { useCompare } from "./compareStore";
import { useJourney } from "./journeyStore";

/**
 * Leaves the trip player (journey or compare playback): the simulation (walkers, HUD, mini-map,
 * split screen, follow cameras) goes, the route stays on the map and the camera flies back to it.
 * `clearRoute` (the legend's x) drops both.
 */
export function exitTrip(): void {
  const plan = useJourney.getState().plan;
  const cmp = useCompare.getState().payload;
  useJourney.getState().clear();
  useCompare.getState().clear();
  const route = useScene.getState().route;
  const ids = [plan?.route_id, cmp?.recommended?.id, cmp?.fastest?.id];
  if (route && ids.includes(route.id)) useScene.getState().requestRouteFocus(route.id);
}
