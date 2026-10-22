import { describe, expect, it } from "vitest";
import { createFrame } from "../scene/three/frame";
import { boundaryOf, outsideBy } from "../scene/three/ground/boundary";
import { floodShapes } from "./floodPresentation";

const frame = createFrame([0, 0]);
const square = (a: number, b: number, c: number, d: number) => [
  [a, b],
  [c, b],
  [c, d],
  [a, d],
  [a, b],
];
const input = {
  features: [
    {
      properties: { class: "possible" },
      geometry: {
        type: "Polygon",
        coordinates: [square(0, 0, 0.001, 0.001), square(0.0004, 0.0004, 0.0006, 0.0006)],
      },
    },
  ],
};

describe("display-only flood geometry", () => {
  it("rounds corners without filling holes or extending the checked footprint", () => {
    const shapes = floodShapes(input, frame);
    expect(shapes).toHaveLength(1);
    expect(shapes[0]!.kind).toBe("possible");
    expect(shapes[0]!.rings).toHaveLength(2);
    expect(shapes[0]!.rings[0]!.length).toBeGreaterThan(4);
    const original = boundaryOf(input.features[0]!.geometry, frame)!;
    for (const s of shapes)
      for (const r of s.rings)
        for (const [x, z] of r) expect(outsideBy(original, x, z)).toBeLessThan(1e-6);
    expect(input.features[0]!.geometry.coordinates[0]).toHaveLength(5);
  });

  it("clips both classes to a township boundary cutting through the polygon", () => {
    const boundary = boundaryOf(
      { type: "Polygon", coordinates: [square(0, 0, 0.0007, 0.001)] },
      frame,
    )!;
    for (const kind of ["possible", "likely_flooded"]) {
      const data = structuredClone(input);
      data.features[0]!.properties.class = kind;
      const shapes = floodShapes(data, frame, boundary);
      expect(shapes.length).toBeGreaterThan(0);
      for (const s of shapes)
        for (const r of s.rings)
          for (const [x, z] of r) expect(outsideBy(boundary, x, z)).toBeLessThan(1e-6);
    }
  });
});
