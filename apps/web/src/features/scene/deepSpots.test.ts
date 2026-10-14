import { beforeEach, describe, expect, it } from "vitest";
import { flyRangeM, goToDeepSpot } from "./DeepSpots";
import { useScene } from "./sceneStore";

const corridor = {
  id: "subang-corridor",
  lens: "flood" as const,
  name: "Sungai Subang corridor",
  bbox: [101.495, 3.15, 101.56, 3.23],
};
const park = {
  id: "urban-park",
  lens: "access" as const,
  name: "Urban park",
  bbox: [101.5055, 3.1775, 101.5135, 3.1835],
};

describe("goToDeepSpot", () => {
  beforeEach(() => useScene.getState().reset());

  it("flies to the bbox centre, enables the flood lens and selects stage_p3m", () => {
    goToDeepSpot(corridor, useScene.getState().applyIntent);
    const s = useScene.getState();
    const fly = s.intents.find((i) => i.kind === "camera.fly_to");
    expect(fly?.center?.[0]).toBeCloseTo(101.5275, 4);
    expect(fly?.center?.[1]).toBeCloseTo(3.19, 4);
    expect(s.lensVisible.flood).toBe(true);
    expect(s.scenarioId).toBe("stage_p3m");
    expect(s.camera?.rangeM).toBeGreaterThan(5000);
  });

  it("access spot turns on access only and leaves the scenario alone", () => {
    goToDeepSpot(park, useScene.getState().applyIntent);
    const s = useScene.getState();
    expect(s.lensVisible.access).toBe(true);
    expect(s.scenarioId).toBeNull();
  });

  it("range grows with bbox size and has a floor", () => {
    expect(flyRangeM(corridor.bbox)).toBeGreaterThan(flyRangeM(park.bbox));
    expect(flyRangeM([101.5, 3.1, 101.5001, 3.1001])).toBeGreaterThanOrEqual(500);
  });
});
