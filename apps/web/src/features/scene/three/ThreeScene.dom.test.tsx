// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { Component, type ReactNode, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { json, newQueryClient, renderWithClient, stubFetch } from "../../../test/helpers";
import { useTheme } from "../../../ui/theme";
import { usePanel } from "../../main/panelStore";
import { PANEL_INSET_PX, panelWidthPx } from "../../main/viewport";
import { useScene } from "../sceneStore";
import { BOOKMARKS, type BookmarkId, DEFAULT_BOOKMARK } from "./bookmarks";
import type { Pose } from "./cameraRig";
import type { Engine } from "./engine";
import { createFrame } from "./frame";
import { LIGHT_PRESETS } from "./lighting";
import ThreeScene from "./ThreeScene";

const CENTER: [number, number] = [101.5099, 3.1813];
const SITE = {
  id: "tiny",
  name: "Tiny",
  center: CENTER,
  bbox: [101.505, 3.175, 101.515, 3.185],
  timezone: "Asia/Kuala_Lumpur",
};
const frame = createFrame(CENTER);

// The typed client builds a relative `Request`, which cannot run outside a browser: serve /site and
// the access layer as query results. `useBuildings` stays real (plain fetch of /api/layers/buildings).
const ok = (data: unknown) => ({ data, isPending: false, isError: false, isSuccess: true });
vi.mock("../../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../../lib/api")>()),
  useSite: () => ok(SITE),
  useLayer: () => ok({ type: "FeatureCollection", features: [] }),
}));
const ring = [
  [0, 0],
  [20, 0],
  [20, -20],
  [0, -20],
  [0, 0],
].map(([x, z]) => frame.toLonLat(x as number, z as number));
const BUILDINGS = {
  attribution: [],
  buildings: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: { kind: "residential", height: 9 },
      },
    ],
  },
  parks: { type: "FeatureCollection", features: [] },
  water: { type: "FeatureCollection", features: [] },
  trees: { type: "FeatureCollection", features: [] },
};

function fakeEngine() {
  let pose: Pose = { target: [0, 0], rangeM: 800, pitchDeg: -45, headingDeg: 0 };
  const e = {
    frames: 0,
    setCity: vi.fn(),
    setBounds: vi.fn(),
    setRoute: vi.fn(),
    setLighting: vi.fn(),
    setTier: vi.fn(),
    setViewOffset: vi.fn(),
    resize: vi.fn(),
    rig: {
      get: vi.fn(() => pose),
      set: vi.fn((p: Pose) => {
        pose = p;
      }),
      flyTo: vi.fn(),
      pick: vi.fn(() => null),
    },
    requestRender: vi.fn(),
    onFrame: vi.fn(() => () => {}),
    fatal: null as ((err: Error) => void) | null,
    onFatal: vi.fn((cb: (err: Error) => void) => {
      e.fatal = cb;
      return () => {
        e.fatal = null;
      };
    }),
    gl: vi.fn(() => ({ getExtension: () => null }) as unknown as WebGL2RenderingContext),
    dispose: vi.fn(),
  };
  return e;
}
type Fake = ReturnType<typeof fakeEngine>;

function mount(engine: Fake = fakeEngine(), onOps?: (o: unknown) => void) {
  const createEngineFn = vi.fn(() => engine as unknown as Engine);
  const r = renderWithClient(<ThreeScene createEngineFn={createEngineFn} onOps={onOps} />);
  return { ...r, engine, createEngineFn };
}

function bookmarkPose(id: BookmarkId): Pose {
  const b = BOOKMARKS[id];
  return {
    target: frame.toLocal(b.centre[0], b.centre[1]),
    rangeM: b.rangeM,
    pitchDeg: b.pitchDeg,
    headingDeg: b.headingDeg,
  };
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <p>renderer failed</p> : this.props.children;
  }
}

const route = {
  type: "LineString",
  coordinates: [
    [101.509, 3.181],
    [101.51, 3.182],
  ],
};

beforeEach(() => {
  stubFetch((url) => (url.includes("/layers/buildings") ? json(BUILDINGS) : json({}, 404)));
  useScene.setState({
    route: null,
    camera: null,
    focusPlaceId: null,
    whatIf: null,
    focusRouteRequest: null,
  });
  usePanel.setState({ open: false });
  history.replaceState(null, "", "/");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ThreeScene", () => {
  it("mounts a focusable 3D map section with the CesiumScene aria-label", () => {
    mount();
    const s = screen.getByTestId("three-scene");
    expect(s.tagName).toBe("SECTION");
    expect(s).toHaveAttribute("tabindex", "0");
    expect(s).toHaveAttribute(
      "aria-label",
      "3D map. Arrow keys or WASD move, Q and E rotate, R and F tilt, plus and minus zoom, N faces north.",
    );
    expect(s).toHaveAttribute("data-frames", "0");
    expect(s).toHaveAttribute("data-route", "off");
  });

  it("calls setCity once buildings data arrives", async () => {
    const { engine } = mount();
    await waitFor(() => expect(engine.setCity).toHaveBeenCalledTimes(1));
    const g = engine.setCity.mock.calls[0]?.[0] as {
      buildings: { getAttribute(n: string): unknown };
    };
    expect(g.buildings.getAttribute("position")).toBeTruthy();
  });

  it('route.highlight sets a route (data-route="on") and clearRoute removes it (setRoute(null), "off")', async () => {
    const { engine } = mount();
    await waitFor(() => expect(engine.setCity).toHaveBeenCalled());
    act(() =>
      useScene.getState().applyIntent({
        kind: "route.highlight",
        route_id: "r1",
        geojson: route,
      } as never),
    );
    const s = screen.getByTestId("three-scene");
    await waitFor(() => expect(s).toHaveAttribute("data-route", "on"));
    const pos = engine.setRoute.mock.calls.at(-1)?.[0] as Float32Array;
    expect(pos).toBeInstanceOf(Float32Array);
    expect(pos.length).toBe(6);
    act(() => useScene.getState().clearRoute());
    await waitFor(() => expect(s).toHaveAttribute("data-route", "off"));
    expect(engine.setRoute).toHaveBeenLastCalledWith(null);
  });

  it("camera.fly_to calls rig.flyTo with the goal converted to a Pose (pitch -45, range from the intent)", async () => {
    const { engine } = mount();
    await waitFor(() => expect(engine.rig.set).toHaveBeenCalled());
    act(() =>
      useScene.getState().applyIntent({
        kind: "camera.fly_to",
        center: [101.51, 3.182],
        range_m: 900,
      } as never),
    );
    expect(engine.rig.flyTo).toHaveBeenCalledTimes(1);
    const [p] = engine.rig.flyTo.mock.calls[0] as unknown as [Pose, number];
    const [x, z] = frame.toLocal(101.51, 3.182);
    expect(p.target[0]).toBeCloseTo(x);
    expect(p.target[1]).toBeCloseTo(z);
    expect(p.rangeM).toBe(900);
    expect(p.pitchDeg).toBe(-45);
  });

  it("?bookmark=hero-near frames that bookmark first; without it, DEFAULT_BOOKMARK", async () => {
    history.replaceState(null, "", "/?bookmark=hero-near");
    const a = mount();
    await waitFor(() => expect(a.engine.rig.set).toHaveBeenCalled());
    const first = a.engine.rig.set.mock.calls[0]?.[0] as Pose;
    const want = bookmarkPose("hero-near");
    expect(first.rangeM).toBe(want.rangeM);
    expect(first.pitchDeg).toBe(want.pitchDeg);
    expect(first.target[0]).toBeCloseTo(want.target[0]);
    expect(first.target[1]).toBeCloseTo(want.target[1]);
    a.unmount();

    history.replaceState(null, "", "/");
    const b = mount();
    await waitFor(() => expect(b.engine.rig.set).toHaveBeenCalled());
    expect(b.engine.rig.set.mock.calls[0]?.[0]?.rangeM).toBe(bookmarkPose(DEFAULT_BOOKMARK).rangeM);
  });

  it("theme change calls setLighting with LIGHT_PRESETS[theme]", async () => {
    act(() => useTheme.setState({ theme: "day" }));
    const { engine } = mount();
    await waitFor(() => expect(engine.setLighting).toHaveBeenCalled());
    expect(engine.setLighting.mock.calls.at(-1)?.[0]).toBe(LIGHT_PRESETS.day);
    act(() => useTheme.setState({ theme: "night" }));
    expect(engine.setLighting.mock.calls.at(-1)?.[0]).toBe(LIGHT_PRESETS.night);
    const dir = engine.setLighting.mock.calls.at(-1)?.[1] as unknown as number[];
    expect(Math.hypot(...dir)).toBeCloseTo(1);
  });

  it("unmount calls dispose exactly once", async () => {
    const { engine, unmount } = mount();
    await waitFor(() => expect(engine.setCity).toHaveBeenCalled());
    unmount();
    expect(engine.dispose).toHaveBeenCalledTimes(1);
  });

  it("createEngineFn throwing propagates to an error boundary", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const createEngineFn = vi.fn(() => {
      throw new Error("WebGL2 unavailable");
    });
    renderWithClient(
      <Boundary>
        <ThreeScene createEngineFn={createEngineFn} />
      </Boundary>,
    );
    expect(screen.getByText("renderer failed")).toBeInTheDocument();
    // The canvas made for the failed engine is not left behind.
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("a runtime fatal error (context lost, shader error) propagates to the error boundary", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const engine = fakeEngine();
    renderWithClient(
      <Boundary>
        <ThreeScene createEngineFn={() => engine as unknown as Engine} />
      </Boundary>,
    );
    await waitFor(() => expect(engine.fatal).toBeTypeOf("function"));
    act(() => engine.fatal?.(new Error("WebGL context lost")));
    expect(screen.getByText("renderer failed")).toBeInTheDocument();
    expect(engine.dispose).toHaveBeenCalledTimes(1);
  });

  it("StrictMode remount gives each engine its own canvas and disposes each once", async () => {
    const engines: Fake[] = [];
    const createEngineFn = vi.fn((_canvas: HTMLCanvasElement) => {
      const e = fakeEngine();
      engines.push(e);
      return e as unknown as Engine;
    });
    // StrictMode at the root, as in main.tsx (nested under a non-strict root, React 19 does not
    // replay effects).
    const { unmount } = render(
      <StrictMode>
        <QueryClientProvider client={newQueryClient()}>
          <ThreeScene createEngineFn={createEngineFn as never} />
        </QueryClientProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(createEngineFn).toHaveBeenCalledTimes(2));
    const [first, second] = createEngineFn.mock.calls.map((c) => c[0]);
    expect(first).not.toBe(second);
    expect(first?.isConnected).toBe(false);
    expect(second?.isConnected).toBe(true);
    expect(engines[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(engines[1]?.dispose).not.toHaveBeenCalled();
    unmount();
    expect(engines[1]?.dispose).toHaveBeenCalledTimes(1);
    expect(second?.isConnected).toBe(false);
  });

  it("opening the panel calls setViewOffset with panelWidthPx(innerWidth) + 2 × PANEL_INSET_PX on wide screens", async () => {
    vi.stubGlobal(
      "matchMedia",
      (q: string) =>
        ({
          matches: q.includes("min-width"),
          media: q,
          addEventListener() {},
          removeEventListener() {},
        }) as unknown as MediaQueryList,
    );
    const { engine } = mount();
    await waitFor(() => expect(engine.setViewOffset).toHaveBeenCalled());
    expect(engine.setViewOffset).toHaveBeenLastCalledWith(0);
    act(() => usePanel.setState({ open: true }));
    expect(engine.setViewOffset).toHaveBeenLastCalledWith(
      panelWidthPx(innerWidth) + 2 * PANEL_INSET_PX,
    );
  });

  it("hands camera ops to onOps and clears them on unmount", async () => {
    const onOps = vi.fn();
    const { unmount } = mount(fakeEngine(), onOps);
    await waitFor(() =>
      expect(onOps).toHaveBeenCalledWith(expect.objectContaining({ zoom: expect.any(Function) })),
    );
    unmount();
    expect(onOps).toHaveBeenLastCalledWith(null);
  });
});
