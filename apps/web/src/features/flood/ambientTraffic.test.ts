import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useScene } from "../scene/sceneStore";
import type { FloodStory } from "./floodStoryData";
import { useFloodStory } from "./floodStoryStore";

const story: FloodStory = {
  stages: [],
  resident: null,
  residentGap: "No mapped connection (data gap).",
};

beforeEach(() => useScene.getState().reset());
afterEach(() => useFloodStory.getState().close());

describe("flood playback ambient traffic", () => {
  it("hides decorative cars when ready, keeps them hidden while paused, and restores them on exit", () => {
    expect(useScene.getState().ambientTraffic).toBe(true);
    useFloodStory.getState().load(story);
    expect(useFloodStory.getState().status).toBe("ready");
    expect(useScene.getState().ambientTraffic).toBe(false);

    useFloodStory.getState().play();
    useFloodStory.getState().pause();
    useFloodStory.getState().seek(28);
    expect(useScene.getState().ambientTraffic).toBe(false);

    useFloodStory.getState().close();
    expect(useScene.getState().ambientTraffic).toBe(true);
  });
});
