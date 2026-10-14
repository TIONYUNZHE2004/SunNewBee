import { describe, expect, it } from "vitest";
import { toPlaceView } from "./placeModel";

const ok = (data: unknown) => ({ ok: true, data });

describe("toPlaceView: evacuation centres", () => {
  it("labels an OSM candidate as not an official relief centre", () => {
    const v = toPlaceView(
      ok({
        id: "evc-hall",
        kind: "evac_centre",
        type: "evacuation_centre",
        name: "Hall",
        source: "osm_candidate",
        claims: { source: { value: "x", status: "unknown" } },
      }),
    );
    expect(v?.kind).toBe("evac_centre");
    expect(v?.sourceLabel).toBe("Candidate (OSM), not an official relief centre");
    expect(v?.sourceTone).toBe("candidate");
    expect(v?.rows.find((r) => r.attr === "source")).toBeUndefined();
  });

  it("labels an official PPS centre", () => {
    const v = toPlaceView(
      ok({ id: "evc-s", kind: "evac_centre", name: "School", source: "official_pps", claims: {} }),
    );
    expect(v?.sourceLabel).toBe("Official PPS");
    expect(v?.sourceTone).toBe("official");
  });

  it("never reads an unknown source as official", () => {
    const v = toPlaceView(ok({ id: "evc-s", kind: "evac_centre", name: "S", source: "???" }));
    expect(v?.sourceTone).toBe("candidate");
  });

  it("reports reachability, treating no_data as a data gap rather than blocked", () => {
    const v = toPlaceView(
      ok({
        id: "evc-s",
        kind: "evac_centre",
        name: "S",
        source: "official_pps",
        reachability: {
          reachable: false,
          route_status: "no_data",
          disclaimer: "Indicative scenario, not a forecast.",
        },
      }),
    );
    expect(v?.reachability?.label).toBe("No mapped connection (data gap)");
    expect(v?.reachability?.disclaimer).toContain("not a forecast");
  });
});

describe("toPlaceView: waste points", () => {
  it("shows status and never invents a collection day", () => {
    const v = toPlaceView(
      ok({
        id: "wp-1",
        kind: "waste_point",
        type: "recycling_drop_off",
        name: "Bins",
        status: "reported",
        source_label: "Waste point: reported",
        collection_day: null,
        claims: { status: { value: "reported", status: "reported" } },
      }),
    );
    expect(v?.kind).toBe("waste_point");
    expect(v?.sourceLabel).toBe("Waste point: reported");
    expect(v?.collectionDay).toBe("Collection day: unknown, ask MBSA");
  });

  it("keeps access places unchanged", () => {
    const v = toPlaceView(ok({ id: "p", name: "Car Park", type: "parking", claims: {} }));
    expect(v?.kind).toBe("place");
    expect(v?.sourceLabel).toBeNull();
    expect(v?.collectionDay).toBeNull();
    expect(v?.reachability).toBeNull();
  });
});
