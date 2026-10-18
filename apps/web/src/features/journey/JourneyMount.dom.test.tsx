// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
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
    fireFrame: () => {
      for (const f of frames) f();
    },
    layer: () => current as JourneyLayer | null,
  };
}

const playIntent = () =>
  useScene.getState().applyIntent({
    kind: "journey.play",
    route_id: plan.route_id,
    start_time: plan.start_time,
    journey: plan,
  } as never);

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

  it("while playing, frames advance the timeline and ask the engine to render", () => {
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
