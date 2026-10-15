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
});
