import { describe, expect, it } from "vitest";
import { availableViews, effectiveView, selectView } from "./selectView";

describe("selectView", () => {
  it("falls back to list with no keys", () => {
    expect(selectView({ googleKey: "", cesiumToken: "", mapboxToken: "" }, true)).toBe("list");
  });
  it("prefers cesium with a google key or ion token", () => {
    expect(selectView({ googleKey: "g", cesiumToken: "", mapboxToken: "" }, true)).toBe("cesium");
    expect(selectView({ googleKey: "", cesiumToken: "c", mapboxToken: "" }, true)).toBe("cesium");
  });
  it("uses mapbox when only a mapbox token", () => {
    expect(selectView({ googleKey: "", cesiumToken: "", mapboxToken: "pk.x" }, true)).toBe(
      "mapbox",
    );
  });
  it("list without webgl", () => {
    expect(selectView({ googleKey: "g", cesiumToken: "c", mapboxToken: "pk.x" }, false)).toBe(
      "list",
    );
  });
  it("respects a preferred view when available", () => {
    expect(
      selectView({ googleKey: "g", cesiumToken: "", mapboxToken: "pk.x" }, true, "mapbox"),
    ).toBe("mapbox");
  });
});

describe("selectView with stylised buildings", () => {
  const none = { googleKey: "", cesiumToken: "", mapboxToken: "" };
  it("cesium is available keyless when the world has buildings", () => {
    expect(selectView(none, true, undefined, true)).toBe("cesium");
    expect(availableViews(none, true, true)).toEqual(["cesium", "list"]);
  });
  it("buildings never beat a missing WebGL", () => {
    expect(selectView(none, false, undefined, true)).toBe("list");
    expect(availableViews(none, false, true)).toEqual(["list"]);
  });
  it("without buildings behaviour is unchanged", () => {
    expect(selectView(none, true, undefined, false)).toBe("list");
    expect(availableViews(none, true, false)).toEqual(["list"]);
    expect(selectView({ ...none, mapboxToken: "pk.x" }, true, undefined, false)).toBe("mapbox");
    expect(availableViews({ ...none, googleKey: "g" }, true)).toEqual(["cesium", "list"]);
  });
  it("buildings keep cesium first ahead of mapbox, and a preferred view still wins", () => {
    const mb = { ...none, mapboxToken: "pk.x" };
    expect(selectView(mb, true, undefined, true)).toBe("cesium");
    expect(selectView(mb, true, "mapbox", true)).toBe("mapbox");
  });
});

describe("effectiveView", () => {
  it("is the chosen view only when available and the renderer has not failed", async () => {
    const { effectiveView } = await import("./selectView");
    expect(effectiveView("cesium", ["cesium", "list"], false)).toBe("cesium");
    expect(effectiveView("cesium", ["list"], false)).toBe("list");
    expect(effectiveView("cesium", ["cesium", "list"], true)).toBe("list");
  });
});

describe("effectiveView on renderer failure", () => {
  it("cesium falls to mapbox when available", () => {
    expect(effectiveView("cesium", ["cesium", "mapbox", "list"], true)).toBe("mapbox");
  });
  it("cesium falls to list without mapbox", () => {
    expect(effectiveView("cesium", ["cesium", "list"], true)).toBe("list");
  });
  it("mapbox falls to list", () => {
    expect(effectiveView("mapbox", ["cesium", "mapbox", "list"], true)).toBe("list");
  });
});
