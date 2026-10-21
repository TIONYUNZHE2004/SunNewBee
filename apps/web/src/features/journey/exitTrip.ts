import { useScene } from "../scene/sceneStore";
import { useJourney } from "./journeyStore";

/**
 * Leaves the trip player: the simulation (hero, HUD, mini-map, follow camera) goes, the route stays
 * on the map and the camera flies back to it. `clearRoute` (the legend's x) drops both.
 */
export function exitTrip(): void {
  const plan = useJourney.getState().plan;
  useJourney.getState().clear();
  const route = useScene.getState().route;
  if (plan && route?.id === plan.route_id) useScene.getState().requestRouteFocus(route.id);
}
