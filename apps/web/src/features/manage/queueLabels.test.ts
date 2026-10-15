import { describe, expect, it } from "vitest";
import { attributeLabel } from "./attributeCatalogue";
import { edgeNames, reasonLabel } from "./queueLabels";

describe("attributeLabel", () => {
  it("uses catalogue labels with units and falls back to the option label", () => {
    expect(attributeLabel("incline_pct")).toBe("Incline (%)");
    expect(attributeLabel("step_height_cm")).toBe("Step height (cm)");
    expect(attributeLabel("width_m")).toBe("Width (m)");
    expect(attributeLabel("tactile_paving")).toBe("Tactile paving");
    expect(attributeLabel("something_new")).toBe("Something new");
  });
});

describe("reasonLabel", () => {
  it("spells reasons as words", () => {
    expect(reasonLabel("unknown")).toBe("Unknown");
    expect(reasonLabel("stale")).toBe("Stale");
    expect(reasonLabel("no_route_unverified_segment")).toBe("No route: unverified segment");
    expect(reasonLabel("user_report")).toBe("User report");
    expect(reasonLabel("brand_new")).toBe("Brand new");
  });
});

describe("edgeNames", () => {
  const line = (id: string, type: string, name?: string | null) => ({
    type: "Feature",
    geometry: { type: "LineString", coordinates: [] },
    properties: { id, type, name },
  });
  it("names edges, or says unnamed footway / street / major road", () => {
    const m = edgeNames({
      features: [
        line("seg-a", "footway", "Jalan Kiosk"),
        line("seg-b", "footway", null),
        line("seg-c", "street"),
        line("seg-d", "major_road", ""),
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [0, 0] },
          properties: { id: "p" },
        },
      ],
    });
    expect(m.get("seg-a")).toBe("Jalan Kiosk");
    expect(m.get("seg-b")).toBe("Unnamed footway");
    expect(m.get("seg-c")).toBe("Unnamed street");
    expect(m.get("seg-d")).toBe("Unnamed major road");
    expect(m.has("p")).toBe(false);
  });
  it("tolerates missing data", () => {
    expect(edgeNames(undefined).size).toBe(0);
  });
});
