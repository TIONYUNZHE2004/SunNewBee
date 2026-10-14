import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FloodPathCard } from "./FloodPathPopover";
import { classLabel, demLabel, floodPathView, methodLabel } from "./floodPath";

const scenario = {
  id: "stage_p3m",
  label: "River +3 m (indicative)",
  stage_m: 3,
  method: "REM",
  dem: "Copernicus GLO-30",
  margin_m: 0.5,
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
    expect(v.dataVersion).toBe("2026-09-30");
    expect(floodPathView(edge, { ...scenario, margin_m: undefined as never }).margin).toBeNull();
  });
  it("adds 'indicative' to a label that lacks it", () => {
    expect(floodPathView(edge, { ...scenario, label: "River +3 m" }).scenario).toBe(
      "River +3 m (indicative)",
    );
  });
});

describe("FloodPathCard", () => {
  for (const cls of ["likely_flooded", "possible"]) {
    it(`shows provenance for ${cls} with no depth`, () => {
      const h = renderToStaticMarkup(
        <FloodPathCard
          edge={{ ...edge, flood_class: cls }}
          scenario={scenario}
          onClose={() => {}}
        />,
      );
      expect(h).toContain("Why this path?");
      expect(h).toContain(cls === "possible" ? "Possibly flooded" : "Likely flooded");
      expect(h).toContain("River +3 m (indicative)");
      expect(h).toContain("Relative elevation above mapped OSM drainage (REM)");
      expect(h).toContain("Copernicus GLO-30 (30 m)");
      expect(h).toContain("within 0.5 m of the modelled water surface");
      expect(h).toContain("2026-09-30");
      expect(h).toContain("Indicative scenario, not a forecast.");
      expect(h).toContain('role="dialog"');
      expect(h).toContain("aria-labelledby");
      expect(h.toLowerCase()).not.toContain("depth");
      expect(h.replace(/<[^>]+>/g, " ")).not.toMatch(/\d+\.\d{2}/);
    });
  }
  it("renders without scenario meta, still saying indicative", () => {
    const h = renderToStaticMarkup(
      <FloodPathCard edge={edge} scenario={undefined} onClose={() => {}} />,
    );
    expect(h).toContain("indicative");
    expect(h).not.toContain("modelled water surface");
  });
});
