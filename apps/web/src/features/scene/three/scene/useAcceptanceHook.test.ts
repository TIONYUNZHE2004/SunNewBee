import { describe, expect, it } from "vitest";
import { acceptanceEnabled, frameSummary, maskCode } from "./useAcceptanceHook";

describe("acceptanceEnabled", () => {
  it("is on in dev builds", () => {
    expect(acceptanceEnabled(true, "")).toBe(true);
  });
  it("is off in production builds unless ?acceptance=1", () => {
    expect(acceptanceEnabled(false, "")).toBe(false);
    expect(acceptanceEnabled(false, "?acceptance=0")).toBe(false);
    expect(acceptanceEnabled(false, "?bookmark=hero-mid&acceptance=1")).toBe(true);
  });
});

describe("maskCode", () => {
  it("one character per kind, and every kind distinct", () => {
    const kinds = ["sky", "ground", "road", "building", "other"] as const;
    const codes = kinds.map(maskCode);
    expect(new Set(codes).size).toBe(kinds.length);
    for (const c of codes) expect(c).toHaveLength(1);
  });
});

describe("frameSummary", () => {
  it("median fps and p95 frame time from frame gaps", () => {
    const dts = [...Array.from({ length: 18 }, () => 10), 50, 50];
    const s = frameSummary(dts);
    expect(s.frames).toBe(20);
    expect(s.medianFps).toBeCloseTo(100, 6);
    expect(s.p95FrameMs).toBe(50);
    expect(s.meanFps).toBeCloseTo(1000 / 14, 6);
  });
  it("ignores idle gaps (0 and > 500 ms) like frameStats", () => {
    const s = frameSummary([0, 16, 16, 900, 16]);
    expect(s.frames).toBe(3);
    expect(s.medianFps).toBeCloseTo(62.5, 6);
  });
  it("no frames: zeros, never NaN", () => {
    expect(frameSummary([])).toEqual({ frames: 0, medianFps: 0, meanFps: 0, p95FrameMs: 0 });
  });
});
