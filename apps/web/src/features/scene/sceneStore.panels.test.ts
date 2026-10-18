import { beforeEach, describe, expect, it } from "vitest";
import { useScene } from "./sceneStore";

describe("one detail panel at a time", () => {
  beforeEach(() => useScene.getState().reset());
  it("opening a flood path closes the place card", () => {
    useScene.getState().selectPlace("p1");
    useScene.getState().selectFloodEdge("e1");
    expect(useScene.getState()).toMatchObject({ selectedPlaceId: null, selectedFloodEdgeId: "e1" });
  });
  it("opening a place closes the flood path popover", () => {
    useScene.getState().selectFloodEdge("e1");
    useScene.getState().selectPlace("p1");
    expect(useScene.getState()).toMatchObject({ selectedPlaceId: "p1", selectedFloodEdgeId: null });
  });
  it("closing one does not touch the other", () => {
    useScene.getState().selectFloodEdge("e1");
    useScene.getState().selectPlace(null);
    expect(useScene.getState().selectedFloodEdgeId).toBe("e1");
  });
  it("changing scenario clears the path", () => {
    useScene.getState().selectFloodEdge("e1");
    useScene.getState().setScenario("stage_p3m");
    expect(useScene.getState().selectedFloodEdgeId).toBeNull();
  });
  it("a picked building joins the four mutually exclusive selections", () => {
    const st = () => useScene.getState();
    const sel = () => ({
      p: st().selectedPlaceId,
      e: st().selectedFloodEdgeId,
      s: st().selectedSignId,
      b: st().selectedBuildingId,
    });
    st().selectPlace("p1");
    st().selectBuilding("b1");
    expect(sel()).toEqual({ p: null, e: null, s: null, b: "b1" });
    for (const open of [
      () => st().selectPlace("p1"),
      () => st().selectFloodEdge("e1"),
      () => st().selectSign("s1"),
    ]) {
      st().selectBuilding("b1");
      open();
      expect(st().selectedBuildingId).toBeNull();
    }
    st().selectSign("s1");
    st().selectBuilding(null);
    expect(sel()).toEqual({ p: null, e: null, s: "s1", b: null });
  });
});
