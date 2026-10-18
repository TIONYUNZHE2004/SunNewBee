import { describe, expect, it } from "vitest";
import { createFrame } from "./frame";

const f = createFrame([101.5099, 3.1813]);
describe("createFrame", () => {
  it("puts the origin at 0,0", () => expect(f.toLocal(101.5099, 3.1813)).toEqual([0, 0]));
  it("maps 0.01° north to about 1105.8 m along −z", () => {
    const [x, z] = f.toLocal(101.5099, 3.1913);
    expect(x).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(-1105.8, 0);
  });
  it("maps 0.01° east to about 1111.5 m along +x", () => {
    expect(f.toLocal(101.5199, 3.1813)[0]).toBeCloseTo(1111.5, 0);
  });
  it("round-trips", () => {
    const [lon, lat] = f.toLonLat(...f.toLocal(101.47, 3.23));
    expect(lon).toBeCloseTo(101.47, 9);
    expect(lat).toBeCloseTo(3.23, 9);
  });
});
