// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScene } from "../scene/sceneStore";
import { CompareControlsView } from "./CompareControls";
import { CompareListSection } from "./compare/CompareListSection";
import { COMPARE_TOTAL_S, useCompare } from "./compareStore";
import { handCompare } from "./fixtures/compareHand";
import demoPlan from "./fixtures/demoPlan.json";
import { useJourney } from "./journeyStore";
import { TripBar } from "./TripBar";
import type { JourneyPlan } from "./timeline";
import { WatchTripButton } from "./WatchTripButton";

const eff = vi.hoisted(() => ({ view: "three" }));
vi.mock("../scene/useMapStyle", async (orig) => ({
  ...(await orig<typeof import("../scene/useMapStyle")>()),
  useEffectiveView: () => eff.view,
}));

const plan = demoPlan as unknown as JourneyPlan;
const wrap = (ui: ReactNode) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
type Route = NonNullable<ReturnType<typeof useScene.getState>["route"]>;

beforeEach(() => {
  eff.view = "three";
  useScene.setState({ profile: "default", route: null });
  useCompare.getState().clear();
  useJourney.getState().clear();
});
afterEach(() => {
  useCompare.getState().clear();
  useJourney.getState().clear();
  vi.restoreAllMocks();
});

describe("Watch the trip routing (AC-N1)", () => {
  it("with a route.compare it starts the compare playback, not the journey", () => {
    const cmp = handCompare();
    wrap(<WatchTripButton plan={plan} compare={cmp} />);
    expect(screen.getByTestId("planned-for")).toHaveTextContent("Planned for: Wheelchair");
    fireEvent.click(screen.getByRole("button", { name: "Watch the trip" }));
    expect(useCompare.getState()).toMatchObject({ payload: cmp, t: 0, playing: true });
    expect(useJourney.getState().plan).toBeNull();
    expect(useScene.getState().profile).toBe("wheelchair");
  });

  it("without a compare it plays today's journey unchanged and leaves the compare store empty", () => {
    wrap(<WatchTripButton plan={plan} />);
    fireEvent.click(screen.getByRole("button", { name: "Watch the trip" }));
    expect(useJourney.getState().plan).toBe(plan);
    expect(useJourney.getState().playing).toBe(true);
    expect(useCompare.getState().payload).toBeNull();
  });

  it("a same-path compare skips the split screen: the journey plays", () => {
    wrap(<WatchTripButton plan={plan} compare={handCompare({ same_path: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "Watch the trip" }));
    expect(useJourney.getState().plan).toBe(plan);
    expect(useCompare.getState().payload).toBeNull();
  });

  it("a journey Watch drops a compare playback that was shown", () => {
    useCompare.getState().load(handCompare());
    wrap(<WatchTripButton plan={plan} />);
    fireEvent.click(screen.getByRole("button", { name: "Watch the trip" }));
    expect(useCompare.getState().payload).toBeNull();
    expect(useJourney.getState().plan).toBe(plan);
  });

  it("List view: loads the compare paused at the start (no player)", () => {
    eff.view = "list";
    const cmp = handCompare();
    wrap(<WatchTripButton compare={cmp} />);
    fireEvent.click(screen.getByRole("button", { name: "Watch the trip" }));
    expect(useCompare.getState()).toMatchObject({ payload: cmp, t: 0, playing: false });
  });

  it("is disabled while another route is on the map", () => {
    useScene.setState({ route: { id: "rt-zzz" } as Route });
    wrap(<WatchTripButton compare={handCompare()} />);
    expect(screen.getByRole("button", { name: "Watch the trip" })).toBeDisabled();
    useScene.setState({ route: null });
  });
});

describe("compare controls (AC-N10)", () => {
  beforeEach(() => useCompare.getState().load(handCompare()));

  it("play / pause, scrub, restart", () => {
    render(<CompareControlsView player />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(useCompare.getState().playing).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(useCompare.getState().playing).toBe(false);
    fireEvent.change(screen.getByRole("slider", { name: "Trip position" }), {
      target: { value: "17.6" },
    });
    expect(useCompare.getState().t).toBeCloseTo(17.6);
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(useCompare.getState()).toMatchObject({ t: 0, playing: true });
  });

  it("Exit trip clears the compare, keeps the route and flies back to it", () => {
    const focus = vi.fn();
    useScene.setState({ route: { id: "rt-rec" } as Route, requestRouteFocus: focus });
    render(<CompareControlsView player />);
    fireEvent.click(screen.getByRole("button", { name: "Exit trip" }));
    expect(useCompare.getState().payload).toBeNull();
    expect(useScene.getState().route?.id).toBe("rt-rec");
    expect(focus).toHaveBeenCalledWith("rt-rec");
    useScene.setState({ route: null });
  });

  it("no player (List view): only Exit trip", () => {
    render(<CompareControlsView player={false} />);
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.getByRole("button", { name: "Exit trip" })).toBeInTheDocument();
  });

  it("TripBar: Trip finished + Replay at the end restarts the compare", () => {
    render(<TripBar />);
    expect(screen.queryByText("Trip finished")).toBeNull();
    act(() => useCompare.getState().seek(COMPARE_TOTAL_S));
    expect(screen.getByRole("status")).toHaveTextContent("Trip finished");
    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    expect(useCompare.getState()).toMatchObject({ t: 0, playing: true });
    fireEvent.click(screen.getByRole("button", { name: "Exit trip" }));
    expect(useCompare.getState().payload).toBeNull();
  });
});

describe("List view compare (AC-N9)", () => {
  it("shows the ticket toast and the reasons card as text, with no split screen", () => {
    eff.view = "list";
    useCompare.getState().load(handCompare());
    wrap(<CompareListSection />);
    const sec = screen.getByTestId("compare-list");
    expect(within(sec).getByRole("status")).toHaveTextContent(
      "Survey ticket queued for staff · Incline on 40 m of the recommended path is not checked yet. Checking it would confirm 7 wheelchair trips.",
    );
    const card = sec.querySelector('[data-beat="reasons"]') as HTMLElement;
    expect(card).toHaveTextContent("Recommended: the step-free route (+1.7 min)");
    for (const row of [
      "Steps",
      "Steepest slope",
      "Narrowest point",
      "Covered from sun and rain",
      "Rest stop on the way",
    ])
      expect(within(card).getByRole("rowheader", { name: row })).toBeInTheDocument();
    expect(card).toHaveTextContent("Reasons use checked facts only.");
    expect(card).toHaveTextContent("Demo values · not surveyed");
    expect(document.querySelector('[data-beat="split"]')).toBeNull();
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("no ticket: no toast; a null fact reads Not checked yet", () => {
    const base = handCompare();
    useCompare.getState().load(
      handCompare({
        vr: null,
        reasons: {
          fastest: base.reasons.fastest,
          recommended: { ...(base.reasons.recommended ?? ({} as never)), min_width_m: null },
        },
      }),
    );
    wrap(<CompareListSection />);
    expect(screen.queryByText(/Survey ticket queued/)).toBeNull();
    const row = screen.getByRole("rowheader", { name: "Narrowest point" }).closest("tr");
    expect(row).toHaveTextContent("Not checked yet");
  });

  it("shows nothing without a compare", () => {
    wrap(<CompareListSection />);
    expect(screen.queryByTestId("compare-list")).toBeNull();
  });
});
