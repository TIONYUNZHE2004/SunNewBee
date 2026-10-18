// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEMO_CHIP, journeyCardContent } from "./cardContent";
import { EventCard } from "./EventCard";
import demoPlan from "./fixtures/demoPlan.json";
import { JourneyHud } from "./JourneyHud";
import { JourneyMiniMap } from "./JourneyMiniMap";
import { JourneyOverlay } from "./JourneyOverlay";
import { useJourney } from "./journeyStore";
import { miniMapLayout } from "./miniMap";
import { SIM_LABEL, SimulationLabel } from "./SimulationLabel";
import { buildTimeline, type JourneyEvent, type JourneyPlan, stateAt } from "./timeline";

const plan = demoPlan as unknown as JourneyPlan;
const tl = buildTimeline(plan);
const VIEW = { w: 1200, h: 800 };

beforeEach(() => {
  useJourney.getState().clear();
  useJourney.setState({ vrElements: [] });
});
afterEach(() => useJourney.getState().clear());

describe("SimulationLabel", () => {
  it("says exactly the spec wording", () => {
    render(<SimulationLabel />);
    expect(SIM_LABEL).toBe("Simulation · indicative times, not a prediction");
    expect(screen.getByRole("note", { name: SIM_LABEL })).toHaveTextContent(
      "Simulation · indicative times, not a prediction",
    );
  });
});

describe("JourneyHud", () => {
  it("shows clock, distance walked, minutes outdoors and rests from the timeline state", () => {
    const at = tl.phases.find(
      (p) => p.event?.title === "Urban Park bench 2",
    ) as (typeof tl.phases)[0];
    render(<JourneyHud state={stateAt(tl, at.t0 + 0.1)} covered={tl.covered} />);
    const hud = screen.getByTestId("journey-hud");
    expect(within(hud).getByTestId("hud-clock")).toHaveTextContent("09:13");
    expect(within(hud).getByTestId("hud-walked")).toHaveTextContent("836 m");
    expect(within(hud).getByTestId("hud-outdoors")).toHaveTextContent("13 min");
    expect(within(hud).getByTestId("hud-rests")).toHaveTextContent("2");
    expect(hud).not.toHaveTextContent(/demo/i); // the demo route has no verified roof
  });

  it("a demo roof pause is labelled as a demo value", () => {
    render(<JourneyHud state={stateAt(tl, 0)} covered={[{ from_m: 0, to_m: 10, demo: true }]} />);
    expect(screen.getByTestId("journey-hud")).toHaveTextContent(DEMO_CHIP);
  });
});

describe("JourneyMiniMap", () => {
  it("draws the route by span status with a legend and puts the hero dot at the walked distance", () => {
    render(<JourneyMiniMap plan={plan} distanceM={573.5} />);
    const map = screen.getByTestId("journey-minimap");
    const lines = map.querySelectorAll("polyline[data-eval]");
    expect([...lines].map((l) => l.getAttribute("data-eval"))).toEqual([
      "UNKNOWN",
      "PASS",
      "UNKNOWN",
      "PASS",
    ]);
    expect(lines[0]?.getAttribute("stroke-dasharray")).toBeTruthy();
    expect(lines[1]?.getAttribute("stroke-dasharray")).toBeNull();
    expect(map).toHaveTextContent("No known barrier");
    expect(map).toHaveTextContent("Not checked yet");
    const dot = screen.getByTestId("journey-minimap-hero");
    const [x, y] = miniMapLayout(plan, 220, 10).heroAt(573.5);
    expect(Number(dot.getAttribute("cx"))).toBeCloseTo(x, 6);
    expect(Number(dot.getAttribute("cy"))).toBeCloseTo(y, 6);
  });
});

describe("EventCard", () => {
  const step = plan.events.find((e) => e.kind === "verified") as JourneyEvent;
  const ramp = plan.events.find((e) => e.title === "Ramp") as JourneyEvent;
  const gap = plan.events.find((e) => e.kind === "gap") as JourneyEvent;

  it("shows title, body, source line and element id from the plan", () => {
    render(<EventCard event={step} anchor={{ x: 600, y: 400 }} viewport={VIEW} />);
    const card = screen.getByTestId("journey-card");
    const c = journeyCardContent(step);
    expect(within(card).getByRole("heading")).toHaveTextContent(step.title);
    expect(card).toHaveTextContent(step.body);
    expect(within(card).getByTestId("card-source")).toHaveTextContent(c.source);
    expect(within(card).getByTestId("card-element")).toHaveTextContent("seg-1318133037-3");
  });

  it("demo chip exactly when demo; never 'Verified' on a demo event", () => {
    for (const e of plan.events) {
      const { unmount } = render(<EventCard event={e} anchor={null} viewport={VIEW} />);
      const card = screen.getByTestId("journey-card");
      expect(within(card).queryByText(DEMO_CHIP) !== null).toBe(e.demo);
      if (e.demo) expect(card.textContent).not.toMatch(/\bverified\b/i);
      unmount();
    }
  });

  it("an UNKNOWN card says Not checked yet, and VR filed only when one was filed", () => {
    const { rerender } = render(<EventCard event={ramp} anchor={null} viewport={VIEW} />);
    expect(screen.getByTestId("card-source")).toHaveTextContent(/^Not checked yet$/);
    rerender(<EventCard event={ramp} anchor={null} viewport={VIEW} vrFiled />);
    expect(screen.getByTestId("card-source")).toHaveTextContent(
      "Not checked yet · verification request filed",
    );
  });

  it("the gap card names the gap as a gap; no element id line without one", () => {
    render(<EventCard event={gap} anchor={null} viewport={VIEW} />);
    const card = screen.getByTestId("journey-card");
    expect(card).toHaveTextContent("Data gap");
    expect(card).toHaveTextContent("No mapped rest stop ahead");
    expect(card.textContent).not.toMatch(/blocked|unsafe/i);
    expect(within(card).queryByTestId("card-element")).toBeNull();
  });

  it("is positioned inside the viewport even for an off-screen anchor", () => {
    render(<EventCard event={gap} anchor={{ x: -500, y: 5000 }} viewport={VIEW} />);
    const card = screen.getByTestId("journey-card");
    const left = Number.parseFloat(card.style.left);
    const top = Number.parseFloat(card.style.top);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(left).toBeLessThanOrEqual(VIEW.w);
    expect(top).toBeLessThanOrEqual(VIEW.h);
  });
});

describe("JourneyOverlay", () => {
  const project = () => ({ x: 600, y: 400 });

  it("renders nothing without a journey", () => {
    const { container } = render(<JourneyOverlay project={project} viewport={VIEW} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("the label is on screen at every sampled time; exactly one card per hold, none otherwise", () => {
    act(() => useJourney.getState().load(plan));
    const { container } = render(<JourneyOverlay project={project} viewport={VIEW} />);
    // every 0.5 s (each hold lasts >= 3 s) plus the first instant of every phase
    const times = [...tl.phases.map((p) => p.t0)];
    for (let t = 0; t <= tl.total; t += 0.5) times.push(t);
    for (const t of times) {
      act(() => useJourney.getState().seek(t));
      const label = container.querySelector('[data-testid="journey-sim-label"]');
      expect(label?.getAttribute("aria-label")).toBe(SIM_LABEL);
      const st = stateAt(tl, t);
      const cards = container.querySelectorAll('[data-testid="journey-card"]');
      if (st.phase.kind === "event") {
        expect(cards).toHaveLength(1);
        expect(cards[0]?.querySelector("h3")?.textContent).toBe(st.event?.title);
      } else expect(cards).toHaveLength(0);
    }
  }, 30_000);

  it("every hold shows its own event card (one per plan event, in order)", () => {
    act(() => useJourney.getState().load(plan));
    render(<JourneyOverlay project={project} viewport={VIEW} />);
    const seen: string[] = [];
    for (const p of tl.phases.filter((p) => p.kind === "event")) {
      act(() => useJourney.getState().seek((p.t0 + p.t1) / 2));
      seen.push(screen.getByTestId("journey-card").getAttribute("data-event-index") as string);
    }
    expect(seen).toEqual(plan.events.map((_, i) => String(i)));
  });

  it("marks the ramp card VR-filed after a verification.requested for its element", () => {
    act(() => {
      useJourney.getState().load(plan);
      useJourney.getState().noteVr("seg-1306543755-2");
    });
    render(<JourneyOverlay project={project} viewport={VIEW} />);
    const ramp = tl.phases.find((p) => p.event?.title === "Ramp") as (typeof tl.phases)[0];
    act(() => useJourney.getState().seek(ramp.t0 + 0.5));
    expect(screen.getByTestId("card-source")).toHaveTextContent("verification request filed");
    const cross = tl.phases.find((p) => p.event?.title === "Crossing Persiaran Elmina");
    act(() => useJourney.getState().seek((cross?.t0 ?? 0) + 0.5));
    expect(screen.getByTestId("card-source")).not.toHaveTextContent("verification request");
  });
});
