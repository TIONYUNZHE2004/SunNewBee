import { describe, expect, it } from "vitest";
import { classLabel, demLabel, floodPathView, methodLabel } from "./floodPath";

const scenario = {
  id: "stage_p3m",
  label: "River +3 m (indicative)",
  stage_m: 3,
  method: "REM",
  dem: "Copernicus GLO-30",
  margin_m: 0.5 as number | null | undefined,
  created: "2026-09-30",
  disclaimer: "Indicative scenario, not a forecast.",
  links: [],
};
const edge = { id: "seg-cd", name: "Jalan Tasik", flood_class: "likely_flooded" };

describe("floodPathView", () => {
  it("maps classes to plain words", () => {
    expect(classLabel("likely_flooded")).toBe("Likely flooded");
    expect(classLabel("possible")).toBe("Possibly flooded");
  });
  it("labels the method and DEM", () => {
    expect(methodLabel("REM")).toBe("Relative elevation above mapped OSM drainage (REM)");
    expect(methodLabel("HAND")).toBe("Height above nearest drainage (HAND)");
    expect(methodLabel("other")).toBe("other");
    expect(demLabel("Copernicus GLO-30")).toBe("Copernicus GLO-30 (30 m)");
    expect(demLabel("Copernicus GLO-30 (30 m)")).toBe("Copernicus GLO-30 (30 m)");
  });
  it("builds the view, omitting a missing margin", () => {
    const v = floodPathView(edge, scenario);
    expect(v.scenario).toBe("River +3 m (indicative)");
    expect(v.margin).toBe("within 0.5 m of the modelled water surface");
    expect(v.generated).toBe("Scenario generated 2026-09-30");
    expect(v.datesNote).toBe("Source data dates are not recorded.");
    expect(floodPathView(edge, { ...scenario, created: null }).generated).toBe(
      "Generation date not recorded",
    );
    expect(floodPathView(edge, { ...scenario, margin_m: null }).margin).toBeNull();
    expect(floodPathView(edge, { ...scenario, margin_m: undefined }).margin).toBeNull();
  });
  it("adds 'indicative' to a label that lacks it", () => {
    expect(floodPathView(edge, { ...scenario, label: "River +3 m" }).scenario).toBe(
      "River +3 m (indicative)",
    );
  });
});
