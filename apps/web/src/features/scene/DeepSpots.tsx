import type { SceneIntent } from "@tl/api-client";
import { useSite } from "../../lib/api";
import { type Lens, useScene } from "./sceneStore";

export interface DeepSpot {
  id: string;
  lens: Lens;
  name: string;
  bbox: number[];
}

const FLOOD_SPOT_SCENARIO = "stage_p3m";

/** Camera range (metres) that frames a [west, south, east, north] box. */
export function flyRangeM(bbox: number[]): number {
  const [w = 0, s = 0, e = 0, n = 0] = bbox;
  const lat = ((s + n) / 2) * (Math.PI / 180);
  const widthM = Math.abs(e - w) * 111_320 * Math.cos(lat);
  const heightM = Math.abs(n - s) * 110_574;
  return Math.max(500, Math.round(Math.max(widthM, heightM) * 1.6));
}

export function goToDeepSpot(spot: DeepSpot, applyIntent: (i: SceneIntent) => void): void {
  const [w = 0, s = 0, e = 0, n = 0] = spot.bbox;
  applyIntent({
    kind: "camera.fly_to",
    center: [(w + e) / 2, (s + n) / 2],
    range_m: flyRangeM(spot.bbox),
  });
  applyIntent({ kind: "layer.toggle", lens: spot.lens, visible: true });
  if (spot.lens === "flood") {
    applyIntent({ kind: "flood.set_level", scenario_id: FLOOD_SPOT_SCENARIO });
  }
}

/** Shortcut buttons for the site's deep spots. Renders nothing when the site has none. */
export function DeepSpots() {
  const site = useSite();
  const applyIntent = useScene((s) => s.applyIntent);
  const spots = (site.data?.deep_spots ?? []) as DeepSpot[];
  if (spots.length === 0) return null;
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-1 block text-sm font-medium">Jump to</legend>
      <ul className="flex flex-wrap gap-2">
        {spots.map((sp) => (
          <li key={sp.id}>
            <button
              type="button"
              onClick={() => goToDeepSpot(sp, applyIntent)}
              className="min-h-11 rounded-lg border border-line bg-card px-3 text-left text-sm font-medium text-brand hover:bg-brand-tint"
            >
              {sp.name}
            </button>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
