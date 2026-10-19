import { afterEach, describe, expect, it } from "vitest";
import { moodKeyDir, moodSource, moodWeights } from "./mood";
import { sunPosition } from "./sun";
import {
  applySunPin,
  PINNED_SUN_ISO,
  pinSunClock,
  sunClockPinned,
  sunNow,
  sunPinRequested,
} from "./sunClock";

const LAT = 3.1813;
const LON = 101.5099;

describe("sunClock (B-T4 pinned sun time)", () => {
  afterEach(() => pinSunClock(null));

  it("is 10:30 in Kuala Lumpur (UTC+8) with the sun well up in the east", () => {
    const t = new Date(PINNED_SUN_ISO);
    expect((t.getUTCHours() + 8) * 60 + t.getUTCMinutes()).toBe(10 * 60 + 30);
    const p = sunPosition(t, LAT, LON);
    expect((p.elevationRad * 180) / Math.PI).toBeGreaterThan(40);
    expect((p.azimuthRad * 180) / Math.PI).toBeGreaterThan(45);
    expect((p.azimuthRad * 180) / Math.PI).toBeLessThan(135);
  });
  it("keeps the real clock unless pinned", () => {
    const real = new Date("2026-10-19T14:00:00Z");
    expect(sunClockPinned()).toBe(false);
    expect(sunNow(real)).toBe(real);
    expect(applySunPin("")).toBe(false);
    expect(applySunPin("?acceptance=1")).toBe(false);
    expect(sunClockPinned()).toBe(false);
  });
  it("pins from ?sun=pinned and then ignores the real time", () => {
    expect(sunPinRequested("?acceptance=1&sun=pinned")).toBe(true);
    expect(sunPinRequested("?sun=1")).toBe(false);
    expect(applySunPin("?acceptance=1&sun=pinned")).toBe(true);
    expect(sunNow(new Date("2026-10-19T14:00:00Z")).toISOString()).toBe(
      new Date(PINNED_SUN_ISO).toISOString(),
    );
  });
  it("drives the existing clock mood source and key light: same light whatever the hour", () => {
    applySunPin("?sun=pinned");
    const at = (real: string) => {
      const src = moodSource({
        dayOn: false,
        dayT: 0,
        choice: "auto",
        now: sunNow(new Date(real)),
      });
      return {
        w: moodWeights(src),
        dir: moodKeyDir(src, moodWeights(src), sunNow(new Date(real)), LAT, LON),
      };
    };
    const noon = at("2026-10-19T04:00:00Z");
    const night = at("2026-10-19T15:00:00Z");
    expect(noon.w.day).toBe(1);
    expect(night.w.day).toBe(1);
    for (let i = 0; i < 3; i++) expect(night.dir[i]).toBeCloseTo(noon.dir[i] as number, 9);
  });
});
