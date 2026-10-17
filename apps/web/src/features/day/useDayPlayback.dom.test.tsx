// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useMode } from "../../app/modeStore";
import { newQueryClient, renderWithClient } from "../../test/helpers";
import { useScene } from "../scene/sceneStore";
import { useDayPlayback } from "./useDayPlayback";

function Host() {
  useDayPlayback();
  return null;
}

function seeded() {
  const qc = newQueryClient();
  qc.setQueryData(["day", "storm"], {
    scenario: {
      stages: [
        [0, null],
        [400, "stage_p1m"],
        [430, "stage_p3m"],
      ],
    },
    tracks: { nodes: [], trips: [], shown: 0, of: 0 },
  });
  return qc;
}

beforeEach(() => {
  useScene.getState().reset();
  useMode.setState({ mode: "management" });
  useScene.setState({ scenarioId: "stage_p2m" }); // the user's own choice before the day
});

describe("Elmina Day playback", () => {
  it("follows the clock's river level and restores the user's scenario on stop", () => {
    renderWithClient(<Host />, seeded());
    act(() => useScene.getState().setDay({ on: true, t: 410, scenario: "storm" }));
    expect(useScene.getState().scenarioId).toBe("stage_p1m");
    act(() => useScene.getState().setDay({ playing: false })); // pause, then play again
    act(() => useScene.getState().setDay({ playing: true, t: 440 }));
    expect(useScene.getState().scenarioId).toBe("stage_p3m");
    act(() => useScene.getState().setDay({ on: false, playing: false }));
    expect(useScene.getState().scenarioId).toBe("stage_p2m");
  });

  it("ends when the user leaves Management mode, restoring the scenario", () => {
    renderWithClient(<Host />, seeded());
    act(() => useScene.getState().setDay({ on: true, t: 410, scenario: "storm" }));
    act(() => useMode.setState({ mode: "resident" }));
    expect(useScene.getState().day.on).toBe(false);
    expect(useScene.getState().scenarioId).toBe("stage_p2m");
  });

  it("a river level the user picks during the day ends it and stays", () => {
    renderWithClient(<Host />, seeded());
    act(() => useScene.getState().setDay({ on: true, t: 410, scenario: "storm" }));
    act(() => useScene.getState().setScenario("stage_p5m"));
    expect(useScene.getState().day.on).toBe(false);
    expect(useScene.getState().scenarioId).toBe("stage_p5m");
  });

  it("the assistant's day.show opens the day at its peak, also when the day was already open", () => {
    renderWithClient(<Host />, seeded());
    act(() => useScene.getState().setDay({ on: true, t: 360, scenario: "storm" }));
    expect(useScene.getState().scenarioId).toBe(null); // 06:00: the river at its normal level
    act(() =>
      useScene.getState().applyIntent({
        kind: "day.show",
        day: "storm",
        t_min: 445,
        scenario_id: "stage_p3m",
      } as never),
    );
    const s = useScene.getState();
    expect(s.day).toMatchObject({ on: true, t: 445, scenario: "storm", playing: false });
    expect(s.scenarioId).toBe("stage_p3m");
    act(() => useScene.getState().setDay({ on: false, playing: false }));
    expect(useScene.getState().scenarioId).toBe("stage_p2m"); // the user's choice comes back
  });

  it("day.show on a closed day restores the user's level on close (review C16)", () => {
    renderWithClient(<Host />, seeded());
    act(() =>
      useScene.getState().applyIntent({
        kind: "day.show",
        day: "storm",
        t_min: 445,
        scenario_id: "stage_p3m",
      } as never),
    );
    expect(useScene.getState().day.on).toBe(true);
    expect(useScene.getState().scenarioId).toBe("stage_p3m");
    act(() => useScene.getState().setDay({ on: false, playing: false }));
    expect(useScene.getState().scenarioId).toBe("stage_p2m");
    expect(useScene.getState().day.before).toBe(null);
  });

  it("day.show in Resident mode shows only the river stage", () => {
    useMode.setState({ mode: "resident" });
    renderWithClient(<Host />, seeded());
    act(() =>
      useScene.getState().applyIntent({
        kind: "day.show",
        day: "storm",
        t_min: 445,
        scenario_id: "stage_p3m",
      } as never),
    );
    expect(useScene.getState().day.on).toBe(false);
    expect(useScene.getState().scenarioId).toBe("stage_p3m");
  });

  it("a resident's own trip (day.trip) plays in Resident mode; switching mode ends it", () => {
    useMode.setState({ mode: "resident" });
    renderWithClient(<Host />, seeded());
    const geojson = { type: "FeatureCollection", features: [], meta: { leave: "07:30" } };
    act(() =>
      useScene.getState().applyIntent({
        kind: "day.trip",
        day: "storm",
        t_min: 450,
        scenario_id: "stage_p3m",
        geojson,
      } as never),
    );
    expect(useScene.getState().day).toMatchObject({ on: true, t: 450, scenario: "storm" });
    expect(useScene.getState().myTrip).not.toBeNull();
    expect(useScene.getState().scenarioId).toBe("stage_p3m");
    act(() => useMode.setState({ mode: "management" }));
    expect(useScene.getState().day.on).toBe(false);
    expect(useScene.getState().myTrip).toBeNull(); // the trip belonged to that day
    expect(useScene.getState().scenarioId).toBe("stage_p2m"); // the user's level comes back
  });

  it("a river level picked during a resident's trip ends the day and clears the trip", () => {
    useMode.setState({ mode: "resident" });
    renderWithClient(<Host />, seeded());
    act(() =>
      useScene.getState().applyIntent({
        kind: "day.trip",
        day: "storm",
        t_min: 450,
        scenario_id: "stage_p3m",
        geojson: { type: "FeatureCollection", features: [], meta: {} },
      } as never),
    );
    act(() => useScene.getState().setScenario("stage_p5m"));
    expect(useScene.getState().day.on).toBe(false);
    expect(useScene.getState().myTrip).toBeNull();
    expect(useScene.getState().scenarioId).toBe("stage_p5m");
  });
});
