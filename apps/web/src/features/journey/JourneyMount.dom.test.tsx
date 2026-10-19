// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScene } from "../scene/sceneStore";
import type { Engine, JourneyOverlay } from "../scene/three/engine";
import { createFrame } from "../scene/three/frame";
import demoPlan from "./fixtures/demoPlan.json";
import { JourneyMount } from "./JourneyMount";
import { useJourney } from "./journeyStore";
import { SIM_LABEL } from "./SimulationLabel";
import type { JourneyLayer } from "./three/journeyLayer";
import { buildTimeline, type JourneyPlan } from "./timeline";
import { WatchTripButton } from "./WatchTripButton";

const plan = demoPlan as unknown as JourneyPlan;
const frame = createFrame([101.5135, 3.18]);

function fakeEngine() {
  const camera = new THREE.PerspectiveCamera(45, 1.5, 1, 5000);
  camera.position.set(0, 400, 400);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const frames = new Set<() => void>();
  let current: JourneyOverlay | null = null;
  const engine = {
    setJourney: vi.fn((j: JourneyOverlay | null) => {
      if (current && current !== j) current.dispose();
      current = j;
    }),
    requestRender: vi.fn(),
    onFrame: vi.fn((cb: () => void) => {
      frames.add(cb);
      return () => frames.delete(cb);
    }),
    pickView: () => ({ camera, roots: [], size: [1200, 800] as [number, number] }),
  };
  return {
    engine: engine as unknown as Engine,
    spy: engine,
    frameSubs: () => frames.size,
    fireFrame: () => {
      for (const f of frames) f();
    },
    layer: () => current as JourneyLayer | null,
  };
}

const playIntent = (p: JourneyPlan = plan) =>
  useScene.getState().applyIntent({
    kind: "journey.play",
    route_id: p.route_id,
    start_time: p.start_time,
    journey: p,
  } as never);
/** A second, shorter trip (an older answer): the first 3 events, ending at the third. */
const older: JourneyPlan = (() => {
  const events = plan.events.slice(0, 3);
  const end = (events.at(-1) as JourneyPlan["events"][number]).at_m + 20;
  return {
    ...plan,
    route_id: "rt-older",
    events,
    spans: plan.spans.filter((sp) => sp[0] < end).map((sp) => [sp[0], Math.min(sp[1], end), sp[2]]),
  } as JourneyPlan;
})();

beforeEach(() => {
  useScene.getState().reset();
  useJourney.getState().clear();
});
afterEach(() => {
  useScene.getState().reset();
  useJourney.getState().clear();
  vi.unstubAllGlobals();
});

describe("JourneyMount", () => {
  it("shows nothing and adds no layer until the scene store holds a journey", () => {
    const f = fakeEngine();
    const { container } = render(<JourneyMount engine={f.engine} frame={frame} />);
    expect(container).toBeEmptyDOMElement();
    expect(f.spy.setJourney).not.toHaveBeenCalled();
  });

  it("a journey.play intent mounts the overlay and the ribbon/marker layer, paused at 0 (no auto-play)", () => {
    const f = fakeEngine();
    render(<JourneyMount engine={f.engine} frame={frame} />);
    act(() => playIntent());
    expect(screen.getByRole("note", { name: SIM_LABEL })).toBeInTheDocument();
    expect(screen.getByTestId("journey-hud")).toHaveTextContent("09:00");
    expect(f.layer()?.ribbon.children.length).toBeGreaterThan(0);
    expect(f.layer()?.markers.children).toHaveLength(plan.events.length);
    expect(useJourney.getState().playing).toBe(false);
  });

  it("Clear route, then Watch the trip: ribbon, markers, label and HUD come back with the trip", () => {
    const f = fakeEngine();
    render(
      <>
        <JourneyMount engine={f.engine} frame={frame} />
        <WatchTripButton plan={plan} />
      </>,
    );
    act(() => playIntent());
    act(() => useScene.getState().clearRoute());
    expect(screen.queryByRole("note", { name: SIM_LABEL })).toBeNull();
    expect(f.layer()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Watch the trip" }));
    expect(useJourney.getState().playing).toBe(true);
    expect(screen.getByRole("note", { name: SIM_LABEL })).toBeInTheDocument();
    expect(screen.getByTestId("journey-hud")).toBeInTheDocument();
    expect(f.layer()?.markers.children).toHaveLength(plan.events.length);
    expect(f.layer()?.ribbon.children.length).toBeGreaterThan(0);
  });

  it("watching an older answer's trip shows that trip everywhere (ribbon, markers, mini-map, HUD, cards)", () => {
    const f = fakeEngine();
    render(
      <>
        <JourneyMount engine={f.engine} frame={frame} />
        <WatchTripButton plan={older} />
      </>,
    );
    act(() => playIntent(older));
    act(() => playIntent(plan)); // the newest answer
    expect(f.layer()?.markers.children).toHaveLength(plan.events.length);
    fireEvent.click(screen.getByRole("button", { name: "Watch the trip" }));
    act(() => useJourney.getState().pause());
    // ribbon and markers: the older plan
    expect(f.layer()?.markers.children).toHaveLength(older.events.length);
    expect(f.layer()?.path.planLength).toBe(older.spans.at(-1)?.[1]);
    // mini-map: one event dot per older event (plus the hero dot)
    const mini = screen.getByTestId("journey-minimap");
    expect(mini.querySelectorAll("circle")).toHaveLength(older.events.length + 1);
    // cards: the older plan's events, in order
    const tl = buildTimeline(older);
    for (const p of tl.phases.filter((ph) => ph.kind === "event")) {
      act(() => useJourney.getState().seek((p.t0 + p.t1) / 2));
      expect(within(screen.getByTestId("journey-card")).getByRole("heading")).toHaveTextContent(
        p.event?.title as string,
      );
    }
    // HUD: the older plan's end state
    act(() => useJourney.getState().seek(tl.total));
    const end = tl.phases.at(-1) as (typeof tl.phases)[0];
    expect(screen.getByTestId("hud-walked")).toHaveTextContent(`${Math.round(end.m1)} m`);
  });

  it("the ribbon stays while the Path status (access) lens is off", () => {
    const f = fakeEngine();
    render(<JourneyMount engine={f.engine} frame={frame} />);
    act(() => playIntent());
    const layer = f.layer();
    act(() => useScene.setState((s) => ({ lensVisible: { ...s.lensVisible, access: false } })));
    expect(f.layer()).toBe(layer);
    expect(f.spy.setJourney).toHaveBeenCalledTimes(1);
  });

  it("clearing the journey removes the overlay and the layer", () => {
    const f = fakeEngine();
    render(<JourneyMount engine={f.engine} frame={frame} />);
    act(() => playIntent());
    act(() => useScene.getState().setScenario("stage_p1m"));
    expect(screen.queryByRole("note", { name: SIM_LABEL })).toBeNull();
    expect(f.spy.setJourney).toHaveBeenLastCalledWith(null);
  });

  it("during a hold the card is anchored to the projected marker and the marker is active", () => {
    const f = fakeEngine();
    render(<JourneyMount engine={f.engine} frame={frame} />);
    act(() => playIntent());
    const tl = buildTimeline(plan);
    const hold = tl.phases.find((p) => p.event?.kind === "gap") as (typeof tl.phases)[0];
    act(() => useJourney.getState().seek(hold.t0 + 0.2));
    const card = screen.getByTestId("journey-card");
    expect(card).toHaveTextContent("No mapped rest stop ahead");
    const sprites = f.layer()?.markers.children ?? [];
    const i = hold.eventIndex as number;
    expect(sprites[i]?.scale.x).toBeGreaterThan(sprites[0]?.scale.x ?? 0);
    // a camera move re-places the card on the next rendered frame
    const before = card.style.left;
    act(() => {
      const cam = f.engine.pickView().camera as THREE.PerspectiveCamera;
      cam.position.set(300, 200, 0);
      cam.lookAt(0, 0, 0);
      cam.updateMatrixWorld();
      f.fireFrame();
    });
    expect(screen.getByTestId("journey-card").style.left).not.toBe(before);
  });

  it("follows the camera only while a card is shown (no per-frame work during walks)", () => {
    const f = fakeEngine();
    render(<JourneyMount engine={f.engine} frame={frame} />);
    act(() => playIntent());
    const tl = buildTimeline(plan);
    const walk = tl.phases.find((p) => p.kind === "walk") as (typeof tl.phases)[0];
    const hold = tl.phases.find((p) => p.kind === "event") as (typeof tl.phases)[0];
    act(() => useJourney.getState().seek((walk.t0 + walk.t1) / 2));
    expect(f.frameSubs()).toBe(0);
    act(() => useJourney.getState().seek((hold.t0 + hold.t1) / 2));
    expect(f.frameSubs()).toBe(1);
    act(() => useJourney.getState().seek((walk.t0 + walk.t1) / 2));
    expect(f.frameSubs()).toBe(0);
  });

  it("a change of t asks the engine for a frame (the store drives, the engine renders on demand)", () => {
    const f = fakeEngine();
    render(<JourneyMount engine={f.engine} frame={frame} />);
    act(() => playIntent());
    f.spy.requestRender.mockClear();
    act(() => useJourney.getState().seek(10));
    expect(f.spy.requestRender).toHaveBeenCalled();
  });

  it("while playing, the shared journey driver advances the timeline", () => {
    const queue: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => queue.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const f = fakeEngine();
    render(<JourneyMount engine={f.engine} frame={frame} />);
    act(() => playIntent());
    act(() => useJourney.getState().play());
    let now = 1000;
    for (let k = 0; k < 10; k++)
      act(() => {
        now += 100;
        const cb = queue.shift();
        cb?.(now);
      });
    expect(useJourney.getState().t).toBeGreaterThan(0.5);
    expect(f.spy.requestRender).toHaveBeenCalled();
  });
});
