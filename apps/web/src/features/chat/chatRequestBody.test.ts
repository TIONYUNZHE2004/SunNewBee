import { beforeEach, describe, expect, it } from "vitest";
import { useScene } from "../scene/sceneStore";
import { chatRequestBody } from "./useChatStream";

describe("chatRequestBody", () => {
  beforeEach(() => {
    useScene.getState().reset();
    useScene.getState().setProfile("drive");
    useScene.getState().setScenario("stage_p1m");
  });
  it("falls back to the store", () => {
    expect(chatRequestBody("q")).toMatchObject({ profile: "drive", scenario_id: "stage_p1m" });
  });
  it("explicit profile and scenario (including null) win over the store", () => {
    expect(chatRequestBody("q", "stroller", null)).toMatchObject({
      profile: "stroller",
      scenario_id: null,
    });
    expect(chatRequestBody("q", "wheelchair", "stage_p3m").scenario_id).toBe("stage_p3m");
  });
});
