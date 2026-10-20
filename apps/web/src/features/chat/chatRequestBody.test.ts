import { beforeEach, describe, expect, it } from "vitest";
import { useMode } from "../../app/modeStore";
import { useScene } from "../scene/sceneStore";
import { chatRequestBody } from "./useChatStream";

describe("chatRequestBody", () => {
  beforeEach(() => {
    useScene.getState().reset();
    useScene.getState().setProfile("drive");
    useScene.getState().setScenario("stage_p1m");
    useMode.getState().setMode("resident");
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
  it("names the panel that asks: resident by default, management on the staff screen", () => {
    expect(chatRequestBody("q").panel).toBe("resident");
    useMode.getState().setMode("management");
    expect(chatRequestBody("q").panel).toBe("management");
  });
  it("sends one stable session id that matches the server's pattern", () => {
    const a = chatRequestBody("q").session_id;
    expect(a).toBe(chatRequestBody("other").session_id);
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });
});
