import { beforeEach, describe, expect, it } from "vitest";
import { useScene } from "../features/scene/sceneStore";
import { loadProfile, saveProfile } from "./profileStore";

const fake = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
};
const throwing = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("denied");
  },
};

describe("profileStore", () => {
  it("round-trips a valid profile", () => {
    const st = fake();
    saveProfile("wheelchair", st);
    expect(loadProfile(st)).toBe("wheelchair");
  });
  it("defaults on invalid value or blocked storage", () => {
    const st = fake();
    st.setItem("tl.profile", "bogus");
    expect(loadProfile(st)).toBe("default");
    expect(loadProfile(throwing)).toBe("default");
    expect(() => saveProfile("drive", throwing)).not.toThrow();
  });
});

describe("sceneStore.setProfile", () => {
  beforeEach(() => useScene.getState().reset());
  it("does not throw without storage (node env)", () => {
    useScene.getState().setProfile("stroller");
    expect(useScene.getState().profile).toBe("stroller");
  });
});
