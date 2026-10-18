import { describe, expect, it } from "vitest";
import { heightRefFor } from "./heightRef";

const HR = { CLAMP_TO_GROUND: "ground", CLAMP_TO_3D_TILE: "tile" } as const;

describe("heightRefFor", () => {
  it("clamps to 3D tiles only when Google tiles are configured", () => {
    expect(heightRefFor(true, HR)).toBe("tile");
    expect(heightRefFor(false, HR)).toBe("ground");
  });
});
