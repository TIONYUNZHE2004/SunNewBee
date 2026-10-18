import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOTION_FRAME_MS } from "../motion/motionClock";
import { PLAYBACK_MS, playbackActive, startPlayback } from "./useResidents";

describe("rollout playback driver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("requests a render every motion frame until stopped, whatever the Motion setting", () => {
    const request = vi.fn();
    const stop = startPlayback(request);
    expect(PLAYBACK_MS).toBe(MOTION_FRAME_MS);
    vi.advanceTimersByTime(1000);
    expect(request.mock.calls.length).toBeGreaterThanOrEqual(29);
    stop();
    const n = request.mock.calls.length;
    vi.advanceTimersByTime(2000);
    expect(request).toHaveBeenCalledTimes(n);
  });

  it("runs only while on, loaded, someone is walking, the tab is visible and the map on screen", () => {
    const base = {
      on: true,
      loaded: true,
      walking: true,
      visible: true,
      onScreen: true,
      clockRunning: false,
    };
    expect(playbackActive(base)).toBe(true);
    for (const k of ["on", "loaded", "walking", "visible", "onScreen"] as const)
      expect(playbackActive({ ...base, [k]: false })).toBe(false);
  });

  it("yields to the motion clock: no second timer while it already renders at ~30 fps", () => {
    const base = { on: true, loaded: true, walking: true, visible: true, onScreen: true };
    expect(playbackActive({ ...base, clockRunning: true })).toBe(false);
  });
});
