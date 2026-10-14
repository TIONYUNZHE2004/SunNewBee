import { beforeEach, describe, expect, it, vi } from "vitest";
import { useScene } from "../scene/sceneStore";
import { activeLens, pickSuggestion, type Suggestion, suggestionsFor } from "./suggestions";
import { chatRequestBody } from "./useChatStream";

describe("suggestions", () => {
  it("offers 4 / 3 / 1 chips per lens", () => {
    expect(suggestionsFor("access")).toHaveLength(4);
    expect(suggestionsFor("flood")).toHaveLength(3);
    expect(suggestionsFor("waste")).toHaveLength(1);
  });
  it("has no duplicate questions", () => {
    const all = (["access", "flood", "waste"] as const).flatMap(suggestionsFor).map((s) => s.text);
    expect(new Set(all).size).toBe(all.length);
  });
  it("access chips carry one persona each; flood and waste carry none", () => {
    expect(suggestionsFor("access").map((s) => s.profile)).toEqual([
      "stroller",
      "wheelchair",
      "older_adult_rest",
      "default",
    ]);
    for (const l of ["flood", "waste"] as const)
      for (const s of suggestionsFor(l)) expect(s.profile).toBeUndefined();
  });
  it("picks the active lens: flood, then waste, then access", () => {
    expect(activeLens({ access: true, flood: true, waste: true })).toBe("flood");
    expect(activeLens({ access: true, flood: false, waste: true })).toBe("waste");
    expect(activeLens({ access: false, flood: false, waste: false })).toBe("access");
  });
});

describe("pickSuggestion", () => {
  beforeEach(() => useScene.getState().reset());
  it("wheelchair chip sets the store profile and sends wheelchair in the request", () => {
    const send = vi.fn();
    const chip = suggestionsFor("access")[1] as Suggestion;
    pickSuggestion(chip, send);
    expect(useScene.getState().profile).toBe("wheelchair");
    expect(send).toHaveBeenCalledWith(chip.text, "wheelchair");
    const body = chatRequestBody(chip.text, "wheelchair");
    expect(body.profile).toBe("wheelchair");
  });
  it("flood and waste chips keep the current profile", () => {
    useScene.getState().setProfile("stroller");
    const send = vi.fn();
    pickSuggestion(suggestionsFor("flood")[0] as never, send);
    pickSuggestion(suggestionsFor("waste")[0] as never, send);
    expect(useScene.getState().profile).toBe("stroller");
    expect(send.mock.calls.every((c) => c[1] === undefined)).toBe(true);
    expect(chatRequestBody("q", undefined).profile).toBe("stroller");
  });
});
