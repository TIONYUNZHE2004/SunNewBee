import { describe, expect, it } from "vitest";
import { MARATHON } from "../../../closures/fixtures";
import { shotStart, TOTAL_S } from "../../../closures/marathonCinematic";
import { createFrame } from "../frame";
import { createCinematicCamera, HEAD_ON } from "./cinematicCamera";

const frame = createFrame([101.5, 3.1]);

describe("T-031 marathon cinematic camera", () => {
  it("holds the overview while the course draws, then a head-on shot ahead of the lead", () => {
    const cam = createCinematicCamera(MARATHON, frame);
    expect(cam).not.toBeNull();
    const c = cam as NonNullable<typeof cam>;
    expect(c(0)).toEqual(c(1.5));
    const run = c(shotStart("run") + 9); // lead half way along an eastward course (~555 m)
    expect(run.pos[0]).toBeGreaterThan(run.look[0]); // ahead of the lead, looking back
    expect(run.pos[1]).toBeCloseTo(HEAD_ON.upM);
    // without a rerouted trip the car shot holds the overview; the pull ends on it
    expect(c(TOTAL_S)).toEqual(c(0));
  });

  it("no drawable course, no camera", () => {
    const none = { ...MARATHON, animation: { ...MARATHON.animation, course_coordinates: [] } };
    expect(createCinematicCamera(none, frame)).toBeNull();
  });
});
