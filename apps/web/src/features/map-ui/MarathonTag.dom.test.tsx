// @vitest-environment jsdom
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithClient } from "../../test/helpers";
import { MARATHON } from "../closures/fixtures";
import { MarathonCard } from "../closures/MarathonCard";
import { useMarathonPlay } from "../closures/marathonPlayStore";
import { useScene } from "../scene/sceneStore";
import { MarathonTag } from "./MarathonTag";

afterEach(() => {
  useMarathonPlay.getState().stop();
  useScene.getState().reset();
});

describe("Watch the marathon (T-028)", () => {
  it("the card's button puts the course on the map and starts the labelled playback", () => {
    renderWithClient(
      <>
        <MarathonCard m={MARATHON} />
        <MarathonTag />
      </>,
    );
    expect(screen.queryByTestId("marathon-play")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Watch the marathon/ }));
    expect(useScene.getState().closureSim?.result).toBe(MARATHON.impact);
    const tag = screen.getByTestId("marathon-play");
    expect(tag).toHaveTextContent("Simulation · illustrative");
    expect(tag).toHaveTextContent("not crowd sizes, vehicle counts or delays");
    expect(screen.getByTestId("marathon-clock")).toHaveTextContent(/06:00/);
    expect(tag.textContent).not.toMatch(/\bsafe\b|\d+ (runners|vehicles|cars)/i);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(useMarathonPlay.getState().playing).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Close marathon simulation" }));
    expect(screen.queryByTestId("marathon-play")).toBeNull();
  });

  it("a later answer that clears the course ends the playback", () => {
    renderWithClient(<MarathonTag />);
    act(() => {
      useScene.getState().applyIntent({ kind: "marathon.show", marathon: MARATHON } as never);
      useMarathonPlay.getState().start(MARATHON);
    });
    expect(screen.getByTestId("marathon-play")).toBeInTheDocument();
    act(() =>
      useScene.getState().applyIntent({
        kind: "route.highlight",
        route_id: "r1",
        geojson: { type: "LineString", coordinates: [] },
      } as never),
    );
    expect(useMarathonPlay.getState().result).toBeNull();
    expect(screen.queryByTestId("marathon-play")).toBeNull();
  });
});
