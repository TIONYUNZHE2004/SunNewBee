import { describe, expect, it } from "vitest";
import { fitFor, overviewPose } from "../cameraFit";
import { createFrame } from "../frame";
import { boundaryOf } from "../ground/boundary";
import { overviewOnFit } from "./useCameraOps";

const frame = createFrame([101.5, 3.18]);
const ring = [
  [-1200, -2000],
  [1200, -2000],
  [1200, 2000],
  [-1200, 2000],
  [-1200, -2000],
].map(([x, z]) => frame.toLonLat(x as number, z as number));
const fit = fitFor(boundaryOf({ type: "Polygon", coordinates: [ring] }, frame)!);

describe("overviewOnFit (A-T5 fix round 2)", () => {
  it("re-poses a camera still on the overview stand-in to the derived overview", () => {
    expect(overviewOnFit({ serial: 3 }, 3, fit)).toEqual(overviewPose(fit));
  });
  it("leaves the camera alone after user input, or with nothing pending", () => {
    expect(overviewOnFit({ serial: 3 }, 4, fit)).toBeNull();
    expect(overviewOnFit(null, 0, fit)).toBeNull();
  });
});
