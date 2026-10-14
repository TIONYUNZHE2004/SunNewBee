import { beforeEach, describe, expect, it } from "vitest";
import { useScene } from "./sceneStore";

describe("sceneStore.applyIntent", () => {
  beforeEach(() => useScene.getState().reset());
  it("route.highlight stores geojson", () => {
    useScene.getState().applyIntent({
      kind: "route.highlight",
      route_id: "rt-1",
      geojson: {
        type: "LineString",
        coordinates: [
          [101.5, 3.18],
          [101.51, 3.18],
        ],
      },
    } as never);
    expect(useScene.getState().route?.id).toBe("rt-1");
  });
  it("flood.set_level sets scenario and shows the flood lens", () => {
    useScene.getState().applyIntent({ kind: "flood.set_level", scenario_id: "stage_p3m" } as never);
    expect(useScene.getState().scenarioId).toBe("stage_p3m");
    expect(useScene.getState().lensVisible.flood).toBe(true);
  });
  it("records intents for replay", () => {
    useScene.getState().applyIntent({ kind: "place.focus", place_id: "playground" } as never);
    expect(useScene.getState().intents).toHaveLength(1);
  });
  it("camera.fly_to and layer.toggle update state", () => {
    useScene
      .getState()
      .applyIntent({ kind: "camera.fly_to", center: [101.5, 3.18], range_m: 900 } as never);
    expect(useScene.getState().camera).toEqual({ center: [101.5, 3.18], rangeM: 900 });
    useScene
      .getState()
      .applyIntent({ kind: "layer.toggle", lens: "waste", visible: true } as never);
    expect(useScene.getState().lensVisible.waste).toBe(true);
  });
});
