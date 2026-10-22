import { describe, expect, it } from "vitest";
import { MARATHON } from "./fixtures";
import { CAR_LOOP_S, canPlay, carsAt, PLAY_S, RUNNERS, runnersAt, simClock } from "./marathonPlay";
import { useMarathonPlay } from "./marathonPlayStore";

const course = [
  [101.5, 3.1],
  [101.51, 3.1],
];
const trip = {
  from_id: "a",
  to_id: "b",
  profile: "drive",
  before_coordinates: course,
  after_coordinates: [
    [101.5, 3.1],
    [101.5, 3.11],
  ],
};

describe("Watch the marathon playback model (T-028)", () => {
  it("runners start together, spread out, and all finish by the end", () => {
    const start = runnersAt(course, 0);
    expect(start).toHaveLength(RUNNERS);
    expect(start.every(([lon]) => lon === 101.5)).toBe(true);
    const mid = runnersAt(course, PLAY_S * 0.4).map(([lon]) => lon);
    expect(Math.min(...mid)).toBeLessThan(Math.max(...mid)); // different decorative paces
    expect(runnersAt(course, PLAY_S).every(([lon]) => Math.abs(lon - 101.51) < 1e-9)).toBe(true);
    expect(runnersAt([course[0] as number[]], 3)).toEqual([]);
  });

  it("one car per rerouted trip drives its after route, looping; empty routes skip", () => {
    const [a] = carsAt([trip], 0);
    const [b] = carsAt([trip], CAR_LOOP_S / 2);
    expect(a?.[0]).toBe(101.5); // on the after (north) line, never the before line
    expect(a?.[1]).not.toBe(b?.[1]);
    expect(carsAt([{ ...trip, after_coordinates: [] }], 1)).toEqual([]);
  });

  it("the clock runs across the engine's closure window in Elmina time", () => {
    // closure 2026-10-25T22:00Z .. 2026-10-26T02:00Z = Mon 06:00 .. 10:00 MYT
    expect(simClock(MARATHON, 0)).toMatch(/Mon.*06:00/);
    expect(simClock(MARATHON, PLAY_S / 2)).toMatch(/Mon.*08:00/);
    expect(simClock(MARATHON, PLAY_S * 2)).toMatch(/Mon.*10:00/);
    const none = {
      ...MARATHON,
      impact: { ...MARATHON.impact, event: { ...MARATHON.impact.event, closures: [] } },
    };
    expect(simClock(none, 1)).toBeNull();
    expect(canPlay(MARATHON)).toBe(true);
  });

  it("the store plays from 0, stops at the end, and restarts on play", () => {
    const s = useMarathonPlay.getState();
    s.start(MARATHON);
    s.advance(5);
    expect(useMarathonPlay.getState().t).toBe(5);
    s.advance(PLAY_S);
    expect(useMarathonPlay.getState()).toMatchObject({ t: PLAY_S, playing: false });
    s.play();
    expect(useMarathonPlay.getState()).toMatchObject({ t: 0, playing: true });
    s.stop();
    expect(useMarathonPlay.getState().result).toBeNull();
  });
});
