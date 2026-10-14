import { describe, expect, it } from "vitest";
import { toPlaceView } from "./placeModel";

const ok = (data: unknown) => ({ ok: true, data });

describe("toPlaceView", () => {
  it("returns null when the result is not ok or has no place", () => {
    expect(toPlaceView(undefined)).toBeNull();
    expect(toPlaceView({ ok: false, data: null })).toBeNull();
    expect(toPlaceView(ok(null))).toBeNull();
    expect(toPlaceView(ok({ name: "x" }))).toBeNull();
  });

  it("handles empty or missing claims", () => {
    const v = toPlaceView(ok({ id: "p", name: "Car Park B", type: "parking", claims: {} }));
    expect(v?.name).toBe("Car Park B");
    expect(v?.typeLabel).toBe("Parking");
    expect(v?.rows).toEqual([]);
    expect(toPlaceView(ok({ id: "p", name: "N", type: "parking" }))?.rows).toEqual([]);
  });

  it("builds rows with label, value, status, date and source", () => {
    const v = toPlaceView(
      ok({
        id: "b",
        name: "Bench",
        type: "seating",
        claims: {
          step_free: {
            value: true,
            status: "verified",
            verified_at: "2026-10-18T09:00:00Z",
            evidence_type: "field_survey",
          },
        },
      }),
    );
    expect(v?.rows[0]).toMatchObject({
      attr: "step_free",
      label: "Step free",
      value: "Yes",
      isUnknown: false,
      status: "verified",
      statusLabel: "Verified",
      verifiedAt: "2026-10-18",
      source: "field_survey",
      placeholder: false,
    });
  });

  it("shows unknown values and unknown status safely", () => {
    const v = toPlaceView(
      ok({ id: "b", name: "B", type: "t", claims: { width_m: { value: null, status: "weird" } } }),
    );
    expect(v?.rows[0]).toMatchObject({
      value: "unknown",
      isUnknown: true,
      status: "unknown",
      statusLabel: "Not checked yet",
      verifiedAt: null,
      source: null,
    });
  });

  it("flags team_survey_placeholder and formats numbers and false", () => {
    const v = toPlaceView(
      ok({
        id: "b",
        name: "B",
        type: "t",
        claims: {
          b_flag: { value: false, status: "reported", evidence_type: "team_survey_placeholder" },
          a_width: { value: 1.2, status: "stale" },
        },
      }),
    );
    expect(v?.rows.map((r) => r.attr)).toEqual(["a_width", "b_flag"]);
    expect(v?.rows[1]).toMatchObject({ value: "No", placeholder: true, source: null });
    expect(v?.rows[0]?.value).toBe("1.2");
  });
});
