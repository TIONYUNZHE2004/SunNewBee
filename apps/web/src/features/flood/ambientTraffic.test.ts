import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MARATHON } from "../closures/fixtures";
import { useMarathonPlay } from "../closures/marathonPlayStore";
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

  it("a marathon start that closes the story keeps the cars hidden", () => {
    useFloodStory.getState().load(story);
    // FloodStoryScene closes the story when a marathon result arrives
    const off = useMarathonPlay.subscribe((s, p) => {
      if (s.result && s.result !== p.result) useFloodStory.getState().close();
    });
    useMarathonPlay.getState().start(MARATHON);
    off();
    expect(useScene.getState().ambientTraffic).toBe(false);
    useMarathonPlay.getState().stop();
    expect(useScene.getState().ambientTraffic).toBe(true);
  });

  it("closing a story that never loaded leaves the switch alone", () => {
    useScene.getState().setAmbientTraffic(false);
    useFloodStory.getState().close();
    expect(useScene.getState().ambientTraffic).toBe(false);
  });
});
