import { describe, expect, it } from "vitest";
import { selectView } from "./selectView";

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
