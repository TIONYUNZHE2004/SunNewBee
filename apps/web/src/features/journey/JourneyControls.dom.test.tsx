// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useScene } from "../scene/sceneStore";
import demo from "./fixtures/demoPlan.json";
import { JourneyControls } from "./JourneyControls";
import { useJourney } from "./journeyStore";
import type { JourneyPlan } from "./timeline";
import { WatchTripButton } from "./WatchTripButton";

const plan = demo as unknown as JourneyPlan;
const j = () => useJourney.getState();

describe("JourneyControls", () => {
  beforeEach(() => {
    j().clear();
    useScene.setState({ journey: null });
  });
  afterEach(cleanup);

  it("renders nothing without a plan", () => {
    const { container } = render(<JourneyControls />);
    expect(container).toBeEmptyDOMElement();
  });

  it("play/pause, restart, camera mode and scrub change the store", () => {
    j().load(plan);
    render(<JourneyControls />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(j().playing).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(j().playing).toBe(false);
    for (const [name, mode] of [
      ["Overview", "overview"],
      ["Free", "free"],
      ["Follow", "follow"],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(j().camMode).toBe(mode);
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
    }
    const slider = screen.getByRole("slider", { name: "Trip position" });
    expect(Number(slider.getAttribute("max"))).toBeCloseTo(j().timeline?.total ?? 0, 6);
    fireEvent.change(slider, { target: { value: "40" } });
    expect(j().t).toBe(40);
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(j()).toMatchObject({ t: 0, playing: true });
  });

  it("a slider scrub lands on the same state as a store seek", () => {
    j().load(plan);
    render(<JourneyControls />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "55.5" } });
    const viaUi = j().t;
    j().seek(55.5);
    expect(viaUi).toBe(j().t);
  });

  it("has a tick per phase boundary", () => {
    j().load(plan);
    const { container } = render(<JourneyControls />);
    expect(container.querySelectorAll("datalist option")).toHaveLength(
      (j().timeline?.phases.length ?? 0) - 1,
    );
  });

  it("Watch the trip loads the scene's plan and plays from the start", () => {
    useScene.setState({ journey: plan });
    render(<WatchTripButton />);
    fireEvent.click(screen.getByRole("button", { name: "Watch the trip" }));
    expect(j().plan).toBe(plan);
    expect(j()).toMatchObject({ t: 0, playing: true });
  });

  it("Watch the trip is absent without a journey", () => {
    render(<WatchTripButton />);
    expect(screen.queryByRole("button", { name: "Watch the trip" })).toBeNull();
  });
});
