import { beforeEach, describe, expect, it } from "vitest";
import { useScene } from "../scene/sceneStore";
import { MARATHON } from "./fixtures";
import { useMarathonPlay } from "./marathonPlayStore";

beforeEach(() => useScene.getState().reset());

describe("ambient traffic switch (T-031, shared by scenario playbacks)", () => {
  it("is on by default, settable, and back on after a reset", () => {
    expect(useScene.getState().ambientTraffic).toBe(true);
    useScene.getState().setAmbientTraffic(false);
    expect(useScene.getState().ambientTraffic).toBe(false);
    useScene.getState().reset();
    expect(useScene.getState().ambientTraffic).toBe(true);
  });

  it("the marathon playback turns it off on start and on again on exit", () => {
    useMarathonPlay.getState().start(MARATHON);
    expect(useScene.getState().ambientTraffic).toBe(false);
    useMarathonPlay.getState().stop();
    expect(useScene.getState().ambientTraffic).toBe(true);
  });
});
