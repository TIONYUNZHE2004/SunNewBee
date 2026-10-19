// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScene } from "../scene/sceneStore";
import demo from "./fixtures/demoPlan.json";
import { JourneyControls } from "./JourneyControls";
import { useJourney } from "./journeyStore";
import { OwnJourneyControls } from "./OwnJourneyControls";
import type { JourneyPlan } from "./timeline";
import { WatchTripButton } from "./WatchTripButton";

// The 3D view (the player) unless a test switches to the List view.
const eff = vi.hoisted(() => ({ view: "cesium" }));
vi.mock("../scene/useMapStyle", async (orig) => ({
  ...(await orig<typeof import("../scene/useMapStyle")>()),
  useEffectiveView: () => eff.view,
}));

const plan = demo as unknown as JourneyPlan;
const j = () => useJourney.getState();

describe("JourneyControls", () => {
  beforeEach(() => {
    j().clear();
    useScene.setState({ journey: null, route: null });
    eff.view = "cesium";
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

  it("Watch the trip loads its own plan and plays from the start", () => {
    render(<WatchTripButton plan={plan} />);
    fireEvent.click(screen.getByRole("button", { name: "Watch the trip" }));
    expect(j().plan).toBe(plan);
    expect(j()).toMatchObject({ t: 0, playing: true });
  });

  it("two journey answers: each Watch plays its own trip; controls only on the loaded one", () => {
    const other = { ...plan, route_id: "other" } as JourneyPlan;
    const view = (
      <>
        <div data-testid="a">
          <WatchTripButton plan={plan} />
          <OwnJourneyControls plan={plan} />
        </div>
        <div data-testid="b">
          <WatchTripButton plan={other} />
          <OwnJourneyControls plan={other} />
        </div>
      </>
    );
    render(view);
    expect(screen.queryAllByTestId("journey-controls")).toHaveLength(0);
    const a = within(screen.getByTestId("a"));
    const b = within(screen.getByTestId("b"));
    fireEvent.click(b.getByRole("button", { name: "Watch the trip" }));
    expect(j().plan).toBe(other);
    expect(screen.getAllByTestId("journey-controls")).toHaveLength(1);
    expect(b.getByTestId("journey-controls")).toBeTruthy();
    expect(a.queryByTestId("journey-controls")).toBeNull();
    fireEvent.click(a.getByRole("button", { name: "Watch the trip" }));
    expect(j().plan).toBe(plan);
    expect(a.getByTestId("journey-controls")).toBeTruthy();
    expect(b.queryByTestId("journey-controls")).toBeNull();
    act(() => j().clear());
    expect(screen.queryAllByTestId("journey-controls")).toHaveLength(0);
  });

  it("an older answer's Watch is disabled while a newer route is on the map", () => {
    const line = {
      type: "LineString",
      coordinates: [
        [101.5, 3.18],
        [101.51, 3.18],
      ],
    };
    render(<WatchTripButton plan={plan} />);
    act(() =>
      useScene.getState().applyIntent({
        kind: "route.highlight",
        route_id: "rt-newer",
        geojson: line,
      } as never),
    );
    const watch = screen.getByRole("button", { name: "Watch the trip" });
    expect(watch).toBeDisabled();
    expect(watch).toHaveAccessibleDescription("This route is no longer on the map.");
    fireEvent.click(watch);
    expect(j().plan).toBeNull();
    act(() =>
      useScene.getState().applyIntent({
        kind: "route.highlight",
        route_id: plan.route_id,
        geojson: line,
      } as never),
    );
    expect(screen.getByRole("button", { name: "Watch the trip" })).toBeEnabled();
  });

  it("List view: no Play/Pause or Restart (no player); Watch loads the trip paused", () => {
    eff.view = "list";
    render(
      <>
        <WatchTripButton plan={plan} />
        <OwnJourneyControls plan={plan} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Watch the trip" }));
    expect(j().plan).toBe(plan);
    expect(j()).toMatchObject({ t: 0, playing: false });
    const controls = screen.getByTestId("journey-controls");
    expect(within(controls).queryByRole("button", { name: /^(Play|Pause|Restart)$/ })).toBeNull();
    expect(within(controls).getByRole("slider", { name: "Trip position" })).toBeTruthy();
  });

  it("datalist ids are unique across instances", () => {
    j().load(plan);
    const { container } = render(
      <>
        <JourneyControls />
        <JourneyControls />
      </>,
    );
    const ids = [...container.querySelectorAll("datalist")].map((d) => d.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("the slider announces the clock and event, and arrow keys step one second", () => {
    j().load(plan);
    render(<JourneyControls />);
    const slider = screen.getByRole("slider", { name: "Trip position" });
    expect(slider.getAttribute("aria-valuetext")).toMatch(/^09:00 /);
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(j().t).toBe(1);
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(j().t).toBe(0);
  });
});
