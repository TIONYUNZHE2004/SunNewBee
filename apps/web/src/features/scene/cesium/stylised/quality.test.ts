import { describe, expect, it, vi } from "vitest";
import { createFrameMonitor, createFrameSampler, lowerTier, pickTier, TIERS } from "./quality";

describe("quality tiers", () => {
  it("picks high for discrete GPUs, low for software, medium when unknown", () => {
    expect(pickTier("ANGLE (NVIDIA GeForce RTX 3060)", 16)).toBe("high");
    expect(pickTier("ANGLE (Intel(R) Iris(R) Xe Graphics)", 16)).toBe("medium");
    expect(pickTier("Google SwiftShader", 8)).toBe("low");
    expect(pickTier(undefined, 2)).toBe("low");
    expect(pickTier(undefined, undefined)).toBe("medium");
  });
  it("lowerTier steps down and stops at low", () => {
    expect(lowerTier("high")).toBe("medium");
    expect(lowerTier("medium")).toBe("low");
    expect(lowerTier("low")).toBe("low");
  });
  it("tiers match the spec table", () => {
    expect(TIERS.high).toMatchObject({
      shadows: "soft",
      shadowMapSize: 2048,
      ao: "off",
      maxPixelRatio: 2,
    });
    expect(TIERS.medium).toMatchObject({
      shadows: "hard",
      shadowMapSize: 1024,
      ao: "off",
      maxPixelRatio: 1.5,
    });
    expect(TIERS.low).toMatchObject({
      shadows: "off",
      ao: "off",
      bloom: false,
      maxPixelRatio: 1,
      clouds: 0,
    });
  });
  it("the monitor drops once after ~3 s of slow moving frames and ignores idle frames", () => {
    const onDrop = vi.fn();
    const m = createFrameMonitor(onDrop, { windowMs: 3000, minFps: 24 });
    for (let i = 0; i < 200; i++) m.sample(50, false); // idle: ignored
    expect(onDrop).not.toHaveBeenCalled();
    for (let i = 0; i < 70; i++) m.sample(50, true); // 20 fps for 3.5 s
    expect(onDrop).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 30; i++) m.sample(50, true); // window restarted after a drop
    expect(onDrop).toHaveBeenCalledTimes(1);
  });
  it("very slow frames (2 s each) still trigger a drop", () => {
    const onDrop = vi.fn();
    const m = createFrameMonitor(onDrop, { windowMs: 3000, minFps: 24 });
    for (let i = 0; i < 4; i++) m.sample(2000, true);
    expect(onDrop).toHaveBeenCalled();
  });
  it("the sampler does not count an idle pause as a slow frame", () => {
    const sample = vi.fn();
    const s = createFrameSampler({ sample });
    s.frame(0);
    s.moved(10_000); // movement resumes after 10 s idle
    s.frame(10_016);
    expect(sample).toHaveBeenLastCalledWith(16, true);
    s.frame(20_000); // idle again, no movement: reported as not moving
    expect(sample).toHaveBeenLastCalledWith(9984, false);
  });
});
