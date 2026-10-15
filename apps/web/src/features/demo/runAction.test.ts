import { beforeEach, describe, expect, it, vi } from "vitest";
import { useScene } from "../scene/sceneStore";
import { dwellMs, runAction } from "./runAction";

const spot = { id: "urban-park", lens: "access" as const, name: "Park", bbox: [1, 2, 3, 4] };
const floodSpot = { id: "sub", lens: "flood" as const, name: "Sub", bbox: [1, 2, 3, 4] };

function deps() {
  return {
    spots: [spot, floodSpot],
    applyIntent: vi.fn(),
    setProfile: vi.fn(),
    setScenario: vi.fn(),
    ask: vi.fn(),
    navigate: vi.fn(),
  };
}

describe("runAction", () => {
  beforeEach(() => useScene.getState().reset());

  it("jump flies via the deep-spot intents on the resident page", () => {
    const d = deps();
    expect(runAction({ kind: "jump", deepSpotId: "urban-park" }, d)).toBe("ok");
    expect(d.navigate).toHaveBeenCalledWith("/");
    expect(d.applyIntent.mock.calls.map((c) => c[0].kind)).toEqual([
      "camera.fly_to",
      "layer.toggle",
    ]);
  });
  it("a flood spot also sets the +3 m scenario", () => {
    const d = deps();
    runAction({ kind: "jump", deepSpotId: "sub" }, d);
    expect(d.applyIntent).toHaveBeenLastCalledWith({
      kind: "flood.set_level",
      scenario_id: "stage_p3m",
    });
  });
  it("a missing deep spot is unavailable and changes nothing", () => {
    const d = deps();
    expect(runAction({ kind: "jump", deepSpotId: "nope" }, d)).toBe("unavailable");
    expect(d.applyIntent).not.toHaveBeenCalled();
  });
  it("setProfile, setScenario and setLens use the store setters / intents", () => {
    const d = deps();
    runAction({ kind: "setProfile", profile: "stroller" }, d);
    expect(d.setProfile).toHaveBeenCalledWith("stroller");
    runAction({ kind: "setScenario", scenarioId: "stage_p1m" }, d);
    expect(d.setScenario).toHaveBeenCalledWith("stage_p1m");
    runAction({ kind: "setScenario", scenarioId: null }, d);
    expect(d.setScenario).toHaveBeenLastCalledWith(null);
    runAction({ kind: "setLens", lens: "waste", on: true }, d);
    expect(d.applyIntent).toHaveBeenCalledWith({
      kind: "layer.toggle",
      lens: "waste",
      visible: true,
    });
  });
  it("ask switches persona like a chip, then queues the question", () => {
    const d = deps();
    runAction({ kind: "ask", text: "Q?", profile: "wheelchair" }, d);
    expect(useScene.getState().profile).toBe("wheelchair");
    expect(d.ask).toHaveBeenCalledWith("Q?");
  });
  it("openManage navigates to the tab", () => {
    const d = deps();
    runAction({ kind: "openManage", tab: "flood" }, d);
    expect(d.navigate).toHaveBeenCalledWith("/manage?tab=flood");
  });
  it("wait does nothing; dwell uses its ms", () => {
    const d = deps();
    expect(runAction({ kind: "wait", ms: 500 }, d)).toBe("ok");
    expect(d.navigate).not.toHaveBeenCalled();
    expect(dwellMs({ kind: "wait", ms: 500 })).toBe(500);
    expect(dwellMs({ kind: "setProfile", profile: "default" })).toBeGreaterThan(1000);
  });
});
