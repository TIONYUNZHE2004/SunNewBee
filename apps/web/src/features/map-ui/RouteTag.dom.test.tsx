// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useCompare } from "../journey/compareStore";
import { handCompare } from "../journey/fixtures/compareHand";
import demo from "../journey/fixtures/demoPlan.json";
import type { JourneyPlan } from "../journey/timeline";
import { useScene } from "../scene/sceneStore";
import { RouteTag } from "./RouteTag";

const plan = demo as unknown as JourneyPlan;
const route = () =>
  useScene.getState().applyIntent({
    kind: "route.highlight",
    route_id: "r1",
    geojson: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    },
  } as never);

afterEach(() => {
  useCompare.getState().clear();
  useScene.getState().reset();
});

describe("RouteTag", () => {
  it("a plain route shows the blue Suggested route swatch", () => {
    act(route);
    render(<RouteTag />);
    expect(screen.getByText("Suggested route")).toBeInTheDocument();
    expect(screen.queryByTestId("ribbon-legend")).toBeNull();
  });

  it("with a journey loaded it shows the ribbon legend, and clearing removes the journey too", () => {
    act(() => {
      route();
      useScene.getState().applyIntent({
        kind: "journey.play",
        route_id: plan.route_id,
        start_time: plan.start_time,
        journey: plan,
      } as never);
    });
    render(<RouteTag />);
    const legend = screen.getByTestId("ribbon-legend");
    expect(legend).toHaveTextContent("No known barrier");
    expect(legend).toHaveTextContent("Not checked yet");
    expect(screen.queryByText("Suggested route")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear route from map" }));
    expect(useScene.getState().route).toBeNull();
    expect(useScene.getState().journey).toBeNull();
  });

  it("is hidden while the compare playback plays (it covered the left pill, V2 N-a); Exit brings it back", () => {
    act(route);
    render(<RouteTag />);
    expect(screen.getByText("Suggested route")).toBeInTheDocument();
    act(() => useCompare.getState().load(handCompare()));
    expect(screen.queryByText("Suggested route")).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear route from map" })).toBeNull();
    act(() => useCompare.getState().clear());
    expect(screen.getByText("Suggested route")).toBeInTheDocument();
  });
});
