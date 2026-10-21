// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScene } from "../scene/sceneStore";
import demoPlan from "./fixtures/demoPlan.json";
import { useJourney } from "./journeyStore";
import { TripBar } from "./TripBar";
import type { JourneyPlan } from "./timeline";

const plan = demoPlan as unknown as JourneyPlan;

beforeEach(() => {
  useJourney.getState().clear();
  useJourney.getState().load(plan);
});
afterEach(() => {
  useJourney.getState().clear();
  vi.restoreAllMocks();
});

describe("TripBar (leaving the trip player)", () => {
  it("offers Exit trip while playing, and Trip finished + Replay at the end", () => {
    render(<TripBar />);
    expect(screen.getByRole("button", { name: "Exit trip" })).toBeInTheDocument();
    expect(screen.queryByText("Trip finished")).toBeNull();
    act(() => {
      const total = useJourney.getState().timeline?.total ?? 0;
      useJourney.getState().seek(total);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Trip finished");
  });

  it("Exit trip clears the trip, keeps the route and flies back to it", () => {
    const focus = vi.spyOn(useScene.getState(), "requestRouteFocus");
    useScene.setState({
      route: { id: plan.route_id } as NonNullable<ReturnType<typeof useScene.getState>["route"]>,
      requestRouteFocus: focus,
    });
    render(<TripBar />);
    fireEvent.click(screen.getByRole("button", { name: "Exit trip" }));
    expect(useJourney.getState().plan).toBeNull();
    expect(useScene.getState().route?.id).toBe(plan.route_id);
    expect(focus).toHaveBeenCalledWith(plan.route_id);
    useScene.setState({ route: null });
  });
});
