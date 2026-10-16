import { describe, expect, it } from "vitest";
import { heightRefFor } from "./heightRef";

const HR = { CLAMP_TO_GROUND: "ground", CLAMP_TO_3D_TILE: "tile" } as const;

describe("heightRefFor", () => {
  it("stylised always clamps to the (flat ellipsoid) ground, even with a Google key", () => {
    expect(heightRefFor("stylised", true, HR)).toBe("ground");
    expect(heightRefFor("stylised", false, HR)).toBe("ground");
  });
  it("realistic clamps to 3D tiles only when Google tiles are configured", () => {
    expect(heightRefFor("realistic", true, HR)).toBe("tile");
    expect(heightRefFor("realistic", false, HR)).toBe("ground");
  });
});
