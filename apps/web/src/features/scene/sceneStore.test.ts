import { beforeEach, describe, expect, it } from "vitest";
import { useMode } from "../../app/modeStore";
import { defaultMapStyle, resolveMapStyle, useScene } from "./sceneStore";

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
  it("changing profile or scenario drops a route planned for the old one", () => {
    const route = {
      kind: "route.highlight",
      route_id: "rt-1",
      geojson: { type: "LineString", coordinates: [[101.5, 3.18]] },
    } as never;
    useScene.getState().applyIntent(route);
    useScene.getState().setProfile("wheelchair");
    expect(useScene.getState().route).toBeNull();
    useScene.getState().applyIntent(route);
    useScene.getState().setScenario("stage_p3m");
    expect(useScene.getState().route).toBeNull();
  });
  it("day.show opens that rehearsal paused at its minute, with its river level", () => {
    useMode.setState({ mode: "management" });
    useScene
      .getState()
      .applyIntent({ kind: "day.show", day: "event", t_min: 1230, scenario_id: null } as never);
    const s = useScene.getState();
    expect(s.day).toMatchObject({ on: true, scenario: "event", t: 1230, playing: false });
    expect(s.scenarioId).toBe(null);
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

describe("redesign additions", () => {
  it("mapStyle defaults to realistic and can be set", () => {
    useScene.getState().reset();
    expect(useScene.getState().mapStyle).toBe("realistic");
    useScene.getState().setMapStyle("stylised");
    expect(useScene.getState().mapStyle).toBe("stylised");
  });
  it("clearRoute drops the highlighted route only", () => {
    useScene.getState().reset();
    useScene.getState().setScenario("stage_p3m");
    useScene.getState().applyIntent({
      kind: "route.highlight",
      route_id: "r1",
      geojson: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    } as never);
    expect(useScene.getState().route?.id).toBe("r1");
    useScene.getState().clearRoute();
    expect(useScene.getState().route).toBeNull();
    expect(useScene.getState().scenarioId).toBe("stage_p3m");
  });
});

describe("map style default", () => {
  beforeEach(() => useScene.getState().reset());
  it("defaultMapStyle: Stylised (Three.js) when buildings exist, else Realistic (Cesium)", () => {
    expect(defaultMapStyle(true, false)).toBe("stylised");
    expect(defaultMapStyle(true, true)).toBe("stylised");
    expect(defaultMapStyle(false, true)).toBe("realistic");
    expect(defaultMapStyle(false, false)).toBe("realistic");
  });
  it("applies the default once buildings load, unless the user chose", () => {
    expect(useScene.getState().mapStyleChosen).toBe(false);
    useScene.getState().applyDefaultMapStyle(true, false);
    expect(useScene.getState().mapStyle).toBe("stylised");
    useScene.getState().reset();
    useScene.getState().setMapStyle("realistic");
    expect(useScene.getState().mapStyleChosen).toBe(true);
    useScene.getState().applyDefaultMapStyle(true, true);
    expect(useScene.getState().mapStyle).toBe("realistic");
  });
  it("changing the map style retries a crashed renderer; re-picking the same one does not", () => {
    useScene.getState().setMapStyle("stylised");
    useScene.getState().setRendererFailed(true);
    useScene.getState().setMapStyle("stylised");
    expect(useScene.getState().rendererFailed).toBe(true);
    useScene.getState().setMapStyle("realistic");
    expect(useScene.getState().rendererFailed).toBe(false);
  });
  it("reset clears the user's choice", () => {
    useScene.getState().setMapStyle("stylised");
    useScene.getState().reset();
    expect(useScene.getState().mapStyleChosen).toBe(false);
    expect(useScene.getState().mapStyle).toBe("realistic");
  });
  it("resolveMapStyle never shows stylised without buildings or realistic without a Google key", () => {
    const s = (mapStyle: "realistic" | "stylised", mapStyleChosen: boolean) => ({
      mapStyle,
      mapStyleChosen,
    });
    // Not chosen: the default rule, even before the store default was applied.
    expect(resolveMapStyle(s("realistic", false), true, true)).toBe("stylised");
    expect(resolveMapStyle(s("realistic", false), false, true)).toBe("realistic");
    // Chosen and possible: the choice.
    expect(resolveMapStyle(s("realistic", true), true, true)).toBe("realistic");
    expect(resolveMapStyle(s("stylised", true), true, true)).toBe("stylised");
    // Chosen but impossible.
    expect(resolveMapStyle(s("stylised", true), false, true)).toBe("realistic");
    expect(resolveMapStyle(s("realistic", true), true, false)).toBe("stylised");
  });
});

describe("what-if diff", () => {
  it("flood.set_level keeps a diff simulated at that level and clears one from another level", () => {
    const at = (sid: string) => ({
      type: "FeatureCollection",
      features: [],
      meta: { scenario_id: sid, summary: {} },
    });
    useScene.getState().applyIntent({ kind: "whatif.diff", geojson: at("stage_p3m") } as never);
    useScene.getState().applyIntent({ kind: "flood.set_level", scenario_id: "stage_p3m" } as never);
    expect(useScene.getState().whatIf).not.toBeNull();
    useScene.getState().applyIntent({ kind: "flood.set_level", scenario_id: "stage_p5m" } as never);
    expect(useScene.getState().whatIf).toBeNull();
  });

  it("whatif.diff stores the imagined diff; a persona change or clear removes it", () => {
    const fc = { type: "FeatureCollection", features: [] };
    useScene.getState().reset();
    useScene.getState().applyIntent({ kind: "whatif.diff", geojson: fc } as never);
    expect(useScene.getState().whatIf?.geojson).toEqual(fc);
    useScene.getState().setProfile("stroller");
    expect(useScene.getState().whatIf).toBeNull();
    useScene.getState().applyIntent({ kind: "whatif.diff", geojson: fc } as never);
    useScene.getState().clearWhatIf();
    expect(useScene.getState().whatIf).toBeNull();
    useScene.getState().applyIntent({ kind: "whatif.diff" } as never);
    expect(useScene.getState().whatIf).toBeNull(); // nothing to draw without geometry
  });
});

describe("what-if diff is never left under newer state", () => {
  it("a new route or a scenario change clears the old diff", () => {
    const fc = { type: "FeatureCollection", features: [] };
    useScene.getState().reset();
    useScene.getState().applyIntent({ kind: "whatif.diff", geojson: fc } as never);
    useScene.getState().applyIntent({
      kind: "route.highlight",
      route_id: "rt-1",
      geojson: {
        type: "LineString",
        coordinates: [
          [1, 2],
          [3, 4],
        ],
      },
    } as never);
    expect(useScene.getState().whatIf).toBeNull();
    useScene.getState().applyIntent({ kind: "whatif.diff", geojson: fc } as never);
    useScene.getState().setScenario("stage_p3m");
    expect(useScene.getState().whatIf).toBeNull();
  });
});
