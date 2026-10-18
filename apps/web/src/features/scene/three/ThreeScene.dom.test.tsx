// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Component, type ReactNode, StrictMode } from "react";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeGlb } from "../../../test/glbFixture";
import { json, newQueryClient, renderWithClient, stubFetch } from "../../../test/helpers";
import { useTheme } from "../../../ui/theme";
import { usePanel } from "../../main/panelStore";
import { PANEL_INSET_PX, panelWidthPx } from "../../main/viewport";
import { usePerfStats } from "../cesium/PerfOverlay";
import { useSceneSettings } from "../sceneSettingsStore";
import { useScene } from "../sceneStore";
import type { CityInstances } from "./assets/cityInstances";
import type { Manifest } from "./assets/manifest";
import { createMotionUniforms } from "./assets/roleMaterial";
import { BOOKMARKS, type BookmarkId, DEFAULT_BOOKMARK, HERO_CENTRE } from "./bookmarks";
import type { Pose } from "./cameraRig";
import { useCityInfo } from "./cityInfo";
import type { Engine, LodTick } from "./engine";
import { createFrame } from "./frame";
import { LIGHT_PRESETS } from "./lighting";
import type { PickHit } from "./pick";
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
// Lets a test make the instance build throw (Review Focus 2: a build error keeps the full city).
const instancesFault = vi.hoisted(() => ({ on: false }));
vi.mock("./assets/cityInstances", async (orig) => {
  const mod = await orig<typeof import("./assets/cityInstances")>();
  return {
    ...mod,
    createCityInstances: (...a: Parameters<typeof mod.createCityInstances>) => {
      if (instancesFault.on) throw new Error("instance build failed");
      tierFakes.kits.push(a[4]?.kits);
      const inst = mod.createCityInstances(...a);
      // One build per city: later kits (props) reach the same instances through setKits.
      const setKits = inst.setKits;
      inst.setKits = (kits, scale) => {
        tierFakes.kits.push(kits ?? undefined);
        setKits(kits, scale);
      };
      return inst;
    },
  };
});
// Lets a test hand back a library that ignores the abort signal (resolves after unmount).
const libraryHook = vi.hoisted(() => ({
  next: null as null | (() => Promise<import("./assets/library").AssetLibrary>),
}));
vi.mock("./assets/library", async (orig) => {
  const mod = await orig<typeof import("./assets/library")>();
  return {
    ...mod,
    loadAssetLibrary: (...a: Parameters<typeof mod.loadAssetLibrary>) =>
      libraryHook.next ? libraryHook.next() : mod.loadAssetLibrary(...a),
  };
});
// Captures the role uniforms the scene creates, so a test can read the glow values.
const uniformSpy = vi.hoisted(() => ({
  last: null as null | import("./assets/roleMaterial").RoleUniforms,
}));
vi.mock("./assets/roleMaterial", async (orig) => {
  const mod = await orig<typeof import("./assets/roleMaterial")>();
  return {
    ...mod,
    createRoleUniforms: () => {
      uniformSpy.last = mod.createRoleUniforms();
      return uniformSpy.last;
    },
  };
});
// Task 8b: a test can swap in tier-aware fakes for the props and agent planners, and record the
// kits handed to createCityInstances and the tier handed to the ground layer.
const tierFakes = vi.hoisted(() => ({
  on: false,
  kits: [] as (Map<string, unknown[]> | undefined)[],
  groundTiers: [] as string[],
  layers: [] as { disposed: number }[],
}));
vi.mock("./props/propsPlan", async (orig) => {
  const mod = await orig<typeof import("./props/propsPlan")>();
  return {
    ...mod,
    planProps: (input: Parameters<typeof mod.planProps>[0]) => {
      if (!tierFakes.on) return mod.planProps(input);
      const lamp = {
        id: "lamp1",
        asset: "furniture",
        variant: "lamp_single",
        x: 0,
        z: 0,
        yaw: 0,
        sx: 1,
        sy: 1,
        sz: 1,
        palette: ["#111111", "#222222", "#333333"],
      };
      return {
        kits: input.tier === "low" ? new Map() : new Map([["furniture/lamp_single", [lamp]]]),
        stats: {},
      };
    },
  };
});
// Final fix E4: counts pointFeatures calls (the place lookup must not rebuild on every render).
const geoCalls = vi.hoisted(() => ({ points: 0 }));
vi.mock("../geo", async (orig) => {
  const mod = await orig<typeof import("../geo")>();
  return {
    ...mod,
    pointFeatures: (...args: Parameters<typeof mod.pointFeatures>) => {
      geoCalls.points++;
      return mod.pointFeatures(...args);
    },
  };
});
// Final fix E1: a fake sign plan and layer, counted, so a tier change's effect on signs is visible.
const signFakes = vi.hoisted(() => ({ on: false, plans: 0 }));
vi.mock("./signs/signPlan", async (orig) => {
  const mod = await orig<typeof import("./signs/signPlan")>();
  return {
    ...mod,
    planSigns: (...args: Parameters<typeof mod.planSigns>) => {
      if (!signFakes.on) return mod.planSigns(...args);
      signFakes.plans++;
      return { signs: [{ id: "s1" }], dropped: { no_source: 0, no_building: 0 }, outside: 0 };
    },
  };
});
vi.mock("./signs/signLayer", async (orig) => {
  const mod = await orig<typeof import("./signs/signLayer")>();
  return {
    ...mod,
    createSignLayer: (...args: Parameters<typeof mod.createSignLayer>) =>
      signFakes.on
        ? ({ group: new THREE.Group(), dispose: () => {} } as unknown as ReturnType<
            typeof mod.createSignLayer
          >)
        : mod.createSignLayer(...args),
  };
});
vi.mock("./motion/agents", async (orig) => {
  const mod = await orig<typeof import("./motion/agents")>();
  return {
    ...mod,
    planAgents: (input: Parameters<typeof mod.planAgents>[0]) => {
      if (!tierFakes.on) return mod.planAgents(input);
      return input.tier === "low"
        ? []
        : [
            {
              id: "a",
              kind: "person" as const,
              variant: "v",
              path: new Float32Array([0, 0, 10, 0]),
              length: 10,
              speed: 1,
              offset: 0,
            },
          ];
    },
  };
});
vi.mock("./motion/motionLayer", async (orig) => {
  const mod = await orig<typeof import("./motion/motionLayer")>();
  const T = await import("three");
  return {
    ...mod,
    createMotionLayer: (...a: Parameters<typeof mod.createMotionLayer>) => {
      if (!tierFakes.on) return mod.createMotionLayer(...a);
      const layer = {
        group: new T.Group(),
        tick: () => {},
        setOpacity: () => {},
        setDensity: () => {},
        disposed: 0,
        dispose() {
          layer.disposed++;
        },
      };
      tierFakes.layers.push(layer);
      return layer;
    },
  };
});
vi.mock("./ground/groundLayer", async (orig) => {
  const mod = await orig<typeof import("./ground/groundLayer")>();
  return {
    ...mod,
    createGroundLayer: (...a: Parameters<typeof mod.createGroundLayer>) => {
      tierFakes.groundTiers.push(a[2]);
      return mod.createGroundLayer(...a);
    },
  };
});
// The picker is stubbed: these tests cover the click handling and the dispatch, pick.test.ts the rays.
const pickStub = vi.hoisted(() => ({
  hit: null as null | import("./pick").PickHit,
  calls: [] as unknown[][],
}));
vi.mock("./pick", async (orig) => {
  const mod = await orig<typeof import("./pick")>();
  return {
    ...mod,
    pickAt: (...a: unknown[]) => {
      pickStub.calls.push(a);
      return pickStub.hit;
    },
  };
});
const accessLayer = vi.hoisted(() => ({
  data: { type: "FeatureCollection", features: [] } as unknown,
}));
vi.mock("../../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../../lib/api")>()),
  useSite: () => ok(SITE),
  useLayer: () => ok(accessLayer.data),
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
    setAssets: vi.fn(),
    setGround: vi.fn(),
    setDecor: vi.fn(),
    setMotion: vi.fn(),
    motion: createMotionUniforms(),
    setBounds: vi.fn(),
    setOverlays: vi.fn(),
    setLighting: vi.fn(),
    setFogRange: vi.fn(),
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
    frameCbs: new Set<(dt: number, info: { calls: number; moving: boolean }) => void>(),
    onFrame: vi.fn((cb: (dt: number, info: { calls: number; moving: boolean }) => void) => {
      e.frameCbs.add(cb);
      return () => {
        e.frameCbs.delete(cb);
      };
    }),
    /** Simulates one rendered frame. */
    tick(dt = 0, calls = 7) {
      e.frames++;
      for (const cb of e.frameCbs) cb(dt, { calls, moving: false });
    },
    // The LOD schedule (Task 4): a requested tick runs on a 0 ms timer; a listener that reports
    // more work gets another one, like the engine's trailing LOD wake.
    lodCbs: new Set<(t: LodTick) => boolean | undefined>(),
    lodTimer: null as ReturnType<typeof setTimeout> | null,
    onLodTick: vi.fn((cb: (t: LodTick) => boolean | undefined) => {
      e.lodCbs.add(cb);
      e.requestLodTick();
      return () => {
        e.lodCbs.delete(cb);
      };
    }),
    requestLodTick: vi.fn(() => {
      if (e.lodTimer) return;
      e.lodTimer = setTimeout(() => {
        e.lodTimer = null;
        e.lodTick();
      }, 0);
    }),
    /** One LOD tick at the rig's pose. */
    lodTick() {
      let more = false;
      const t = { target: { x: pose.target[0], z: pose.target[1] }, rangeM: pose.rangeM, nowMs: 0 };
      for (const cb of [...e.lodCbs]) if (cb(t)) more = true;
      if (more) e.requestLodTick();
    },
    fatal: null as ((err: Error) => void) | null,
    onFatal: vi.fn((cb: (err: Error) => void) => {
      e.fatal = cb;
      return () => {
        e.fatal = null;
      };
    }),
    gl: vi.fn(() => ({ getExtension: () => null }) as unknown as WebGL2RenderingContext),
    pickView: vi.fn(() => ({
      camera: new THREE.PerspectiveCamera(),
      roots: [] as THREE.Object3D[],
      size: [800, 600] as [number, number],
    })),
    dispose: vi.fn(),
  };
  return e;
}
const reducedMq = () => ({
  matches: true,
  addEventListener: () => {},
  removeEventListener: () => {},
});

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
  // No manifest by default: the scene falls back to the full extruded city with one warning.
  vi.spyOn(console, "warn").mockImplementation(() => {});
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
  instancesFault.on = false;
  libraryHook.next = null;
  pickStub.hit = null;
  pickStub.calls = [];
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

  it("shows an experimental-engine chip whose link switches back to Cesium on the same page", () => {
    history.replaceState(null, "", "/?bookmark=hero-near&engine=three#x");
    mount();
    expect(screen.getByText(/Experimental 3D engine/)).toHaveTextContent(
      "Experimental 3D engine · Switch back",
    );
    expect(screen.getByRole("link", { name: "Switch back" })).toHaveAttribute(
      "href",
      "/?bookmark=hero-near&engine=cesium#x",
    );
  });

  it("draws the roads after the first frame even when the world has no land cover", async () => {
    const home = frame.toLonLat(0, 0);
    const east = frame.toLonLat(80, 0);
    accessLayer.data = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { type: "street" },
          geometry: { type: "LineString", coordinates: [home, east] },
        },
      ],
    };
    try {
      const { engine } = mount();
      await waitFor(() => expect(engine.setCity).toHaveBeenCalled());
      act(() => engine.tick());
      // Roads are streamed per tile into their own decor slot (Task 4).
      await waitFor(() => {
        const last = engine.setDecor.mock.calls.filter((c) => c[0] === "roads").at(-1)?.[1] as
          | { group: { children: { geometry: { getAttribute(n: string): { count: number } } }[] } }
          | null
          | undefined;
        expect(last?.group.children.length).toBeGreaterThanOrEqual(1);
        expect(last?.group.children[0]?.geometry.getAttribute("position").count).toBeGreaterThan(0);
      });
    } finally {
      accessLayer.data = { type: "FeatureCollection", features: [] };
    }
  });

  it("data-tiles is the streamer's active tile count (25 at the 800 m default view)", async () => {
    const { engine } = mount();
    const s = screen.getByTestId("three-scene");
    expect(s).toHaveAttribute("data-tiles", "0");
    await waitFor(() => expect(engine.setCity).toHaveBeenCalled());
    act(() => engine.tick());
    await waitFor(() => expect(s).toHaveAttribute("data-tiles", "25"));
    expect(engine.onLodTick).toHaveBeenCalled();
  });

  it("calls setCity once buildings data arrives", async () => {
    const { engine } = mount();
    await waitFor(() => expect(engine.setCity).toHaveBeenCalledTimes(1));
    const g = engine.setCity.mock.calls[0]?.[0] as {
      buildings: { getAttribute(n: string): unknown };
    };
    expect(g.buildings.getAttribute("position")).toBeTruthy();
  });

  it('route.highlight sets a route (data-route="on") and clearRoute removes it ("off"); the line is drawn by the overlay layer', async () => {
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
    const layer = engine.setOverlays.mock.calls.find((c: unknown[]) => c[0])?.[0];
    expect(layer).toBeTruthy();
    const routeLines = () => {
      const out: { renderOrder: number; count: number }[] = [];
      layer.group.traverse(
        (o: {
          renderOrder: number;
          isLineSegments2?: boolean;
          visible: boolean;
          geometry: { attributes: { instanceStart: { count: number } } };
        }) => {
          if (o.isLineSegments2 && o.renderOrder === 13)
            out.push({
              renderOrder: o.renderOrder,
              count: o.geometry.attributes.instanceStart.count,
            });
        },
      );
      return out;
    };
    expect(routeLines()).toEqual([{ renderOrder: 13, count: 1 }]);
    act(() => useScene.getState().clearRoute());
    await waitFor(() => expect(s).toHaveAttribute("data-route", "off"));
    expect(routeLines()).toEqual([]);
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

  it("a pinned theme change calls setLighting with that keyframe (reduced motion: at once)", async () => {
    vi.stubGlobal("matchMedia", reducedMq);
    act(() => useTheme.setState({ choice: "day", theme: "day" }));
    const { engine } = mount();
    await waitFor(() => expect(engine.setLighting).toHaveBeenCalled());
    expect(engine.setLighting.mock.calls.at(-1)?.[0]).toBe(LIGHT_PRESETS.day);
    act(() => useTheme.setState({ choice: "night", theme: "night" }));
    expect(engine.setLighting.mock.calls.at(-1)?.[0]).toBe(LIGHT_PRESETS.night);
    const dir = engine.setLighting.mock.calls.at(-1)?.[1] as unknown as number[];
    expect(Math.hypot(...dir)).toBeCloseTo(1);
    vi.unstubAllGlobals();
  });

  it("Elmina Day playback drives the light even with the theme pinned to day", async () => {
    vi.stubGlobal("matchMedia", reducedMq);
    act(() => useTheme.setState({ choice: "day", theme: "day" }));
    const { engine } = mount();
    await waitFor(() => expect(engine.setLighting).toHaveBeenCalled());
    act(() => useScene.setState({ day: { ...useScene.getState().day, on: true, t: 21 * 60 } }));
    const p = engine.setLighting.mock.calls.at(-1)?.[0] as unknown as typeof LIGHT_PRESETS.night;
    expect(p).toBe(LIGHT_PRESETS.night);
    act(() => useScene.setState({ day: { ...useScene.getState().day, on: false } }));
    vi.unstubAllGlobals();
  });

  it("Day playback re-renders do not rebuild the place lookup (memoised on the access data)", async () => {
    const { engine } = mount();
    await waitFor(() => expect(engine.setCity).toHaveBeenCalled());
    act(() => useScene.setState({ day: { ...useScene.getState().day, on: true, t: 600 } }));
    const before = geoCalls.points;
    for (const t of [601, 602, 603, 604, 605])
      act(() => useScene.setState({ day: { ...useScene.getState().day, t } }));
    expect(geoCalls.points).toBe(before);
    act(() => useScene.setState({ day: { ...useScene.getState().day, on: false } }));
  });

  it("the container background follows the blended preset during Day playback", async () => {
    vi.stubGlobal("matchMedia", reducedMq);
    act(() => useTheme.setState({ choice: "day", theme: "day" }));
    const { engine } = mount();
    await waitFor(() => expect(engine.setLighting).toHaveBeenCalled());
    const el = screen.getByTestId("three-scene");
    const toRgb = (hex: string) => {
      const c = document.createElement("div");
      c.style.background = hex;
      return c.style.background;
    };
    expect(el.style.background).toBe(toRgb(LIGHT_PRESETS.day.background));
    act(() => useScene.setState({ day: { ...useScene.getState().day, on: true, t: 21 * 60 } }));
    expect(el.style.background).toBe(toRgb(LIGHT_PRESETS.night.background));
    act(() => useScene.setState({ day: { ...useScene.getState().day, on: false } }));
    vi.unstubAllGlobals();
  });

  it("role uniforms follow glowFor", async () => {
    vi.stubGlobal("matchMedia", reducedMq);
    act(() => useTheme.setState({ choice: "night", theme: "night" }));
    const { engine } = mount();
    await waitFor(() => expect(engine.setLighting).toHaveBeenCalled());
    expect(uniformSpy.last?.uWindowGlow.value).toBe(1.6);
    expect(uniformSpy.last?.uLitShare.value).toBeCloseTo(0.58);
    expect(uniformSpy.last?.uLightGlow.value).toBe(1);
    act(() => useTheme.setState({ choice: "day", theme: "day" }));
    expect(uniformSpy.last?.uWindowGlow.value).toBe(0);
    expect(uniformSpy.last?.uLitShare.value).toBeCloseTo(0.35);
    vi.unstubAllGlobals();
  });

  it("the sources crossfade over several frames when motion is allowed", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    act(() => useTheme.setState({ choice: "day", theme: "day" }));
    const { engine } = mount();
    await vi.waitFor(() => expect(engine.setLighting).toHaveBeenCalled());
    act(() => useTheme.setState({ choice: "night", theme: "night" }));
    expect(engine.setLighting.mock.calls.at(-1)?.[0]).toBe(LIGHT_PRESETS.day);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    const mid = engine.setLighting.mock.calls.at(-1)?.[0] as unknown as typeof LIGHT_PRESETS.day;
    expect(mid.sunIntensity).toBeLessThan(LIGHT_PRESETS.day.sunIntensity);
    expect(mid.sunIntensity).toBeGreaterThan(LIGHT_PRESETS.night.sunIntensity);
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(engine.setLighting.mock.calls.at(-1)?.[0]).toBe(LIGHT_PRESETS.night);
    vi.useRealTimers();
  });

  describe("motion", () => {
    type Driver = import("./motion/motionClock").MotionDriver;
    const driverOf = (e: Fake) => e.setMotion.mock.calls.at(-1)?.[0] as Driver | null;
    const runningOf = (e: Fake) => e.setMotion.mock.calls.at(-1)?.[1] as () => boolean;
    const cam = new THREE.Vector3();
    afterEach(() => {
      act(() => {
        useScene.setState({ day: { ...useScene.getState().day, on: false } });
        useScene.setState({ rollout: { ...useScene.getState().rollout, on: false } });
        useSceneSettings.setState({ motion: true });
      });
    });

    it("hands the engine one motion driver, gated by Motion, and clears it on unmount", async () => {
      act(() => useSceneSettings.setState({ motion: true }));
      const { engine, unmount } = mount();
      await waitFor(() => expect(driverOf(engine)).toBeTruthy());
      expect(runningOf(engine)()).toBe(true);
      const renders = engine.requestRender.mock.calls.length;
      act(() => useSceneSettings.setState({ motion: false }));
      expect(runningOf(engine)()).toBe(false);
      // One final frame at the static pose.
      expect(engine.requestRender.mock.calls.length).toBeGreaterThan(renders);
      unmount();
      expect(engine.setMotion).toHaveBeenLastCalledWith(null, expect.any(Function));
    });

    it("reduced motion stops the clock", async () => {
      vi.stubGlobal("matchMedia", reducedMq);
      const { engine } = mount();
      await waitFor(() => expect(driverOf(engine)).toBeTruthy());
      expect(runningOf(engine)()).toBe(false);
    });

    it("day.on fades people and vehicles toward 0 over 1 s, and back once it ends", async () => {
      const { engine } = mount();
      await waitFor(() => expect(driverOf(engine)).toBeTruthy());
      const d = driverOf(engine) as Driver;
      d.tick(0, cam);
      expect(d.opacity).toBe(1);
      act(() => useScene.setState({ day: { ...useScene.getState().day, on: true } }));
      expect(d.target).toBe(0);
      d.tick(500, cam);
      expect(d.opacity).toBeGreaterThan(0);
      expect(d.opacity).toBeLessThan(1);
      d.tick(1100, cam);
      expect(d.opacity).toBe(0);
      act(() => useScene.setState({ day: { ...useScene.getState().day, on: false } }));
      expect(d.target).toBe(1);
    });

    it("rollout.on does the same, and the fade holds until both playbacks end", async () => {
      const { engine } = mount();
      await waitFor(() => expect(driverOf(engine)).toBeTruthy());
      const d = driverOf(engine) as Driver;
      act(() => useScene.setState({ rollout: { ...useScene.getState().rollout, on: true } }));
      expect(d.target).toBe(0);
      act(() => useScene.setState({ day: { ...useScene.getState().day, on: true } }));
      act(() => useScene.setState({ rollout: { ...useScene.getState().rollout, on: false } }));
      expect(d.target).toBe(0);
      act(() => useScene.setState({ day: { ...useScene.getState().day, on: false } }));
      expect(d.target).toBe(1);
    });

    it("a hidden tab pauses the clock", async () => {
      const { engine } = mount();
      await waitFor(() => expect(driverOf(engine)).toBeTruthy());
      expect(runningOf(engine)()).toBe(true);
      const vis = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(runningOf(engine)()).toBe(false);
      vis.mockReturnValue("visible");
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(runningOf(engine)()).toBe(true);
    });

    it("the map off screen pauses the clock (IntersectionObserver)", async () => {
      const observers: ((e: { isIntersecting: boolean }[]) => void)[] = [];
      vi.stubGlobal(
        "IntersectionObserver",
        class {
          constructor(cb: (e: { isIntersecting: boolean }[]) => void) {
            observers.push(cb);
          }
          observe() {}
          disconnect() {}
        },
      );
      const { engine } = mount();
      await waitFor(() => expect(driverOf(engine)).toBeTruthy());
      expect(observers.length).toBeGreaterThan(0);
      act(() => {
        for (const cb of observers) cb([{ isIntersecting: false }]);
      });
      expect(runningOf(engine)()).toBe(false);
      act(() => {
        for (const cb of observers) cb([{ isIntersecting: true }]);
      });
      expect(runningOf(engine)()).toBe(true);
    });
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

  it("data-frames reflects the first rendered frames without interaction, and perf gets draw calls", async () => {
    const { engine } = mount();
    await waitFor(() => expect(engine.frameCbs.size).toBeGreaterThan(0));
    act(() => {
      engine.tick();
      engine.tick();
    });
    const s = screen.getByTestId("three-scene");
    await waitFor(() => expect(s).toHaveAttribute("data-frames", "2"), { timeout: 1000 });
    expect(usePerfStats.getState().drawCalls).toBe(7);
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

  describe("city assets", () => {
    const local = (pts: [number, number][]) => [
      [...pts, pts[0]!].map(([x, z]) => frame.toLonLat(x, z)),
    ];
    /** 6.4 m frontage along x, 15.5 m deep along z, centred on (cx, 100). */
    const link = (id: string, cx: number) => ({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: local([
          [cx - 3.2, 100 - 7.75],
          [cx + 3.2, 100 - 7.75],
          [cx + 3.2, 100 + 7.75],
          [cx - 3.2, 100 + 7.75],
        ]),
      },
      properties: {
        id,
        kind: "residential",
        height_m: 8.5,
        archetype: "link_intermediate",
        precinct: "Elmina Valley 2",
      },
    });
    const CITY = {
      ...BUILDINGS,
      buildings: {
        type: "FeatureCollection",
        features: [
          { ...BUILDINGS.buildings.features[0], properties: { id: "plain", height_m: 9 } },
          link("l1", 50),
          link("l2", 80),
        ],
      },
    };
    const lodNodes = ["link_intermediate__gable__LOD0", "link_intermediate__gable__LOD1"];
    const MANIFEST: Manifest = {
      version: 1,
      as_of: "2026-10-17",
      precinctGroups: [["valley", "elmina valley"]],
      assets: {
        link_intermediate: {
          group: "archetype",
          file: "link_intermediate.glb",
          bytes: 1,
          repeat: "none",
          frontage: "short",
          fit: { xz: [0.75, 1.35], y: [0.6, 1.6] },
          decorative: false,
          placement: null,
          jitter: {},
          variantByGroup: { default: "gable" },
          palettes: { default: [["#111111", "#222222", "#333333"]] },
          variants: {
            gable: {
              size: [6.4, 8.5, 15.5],
              lods: [
                { node: lodNodes[0]!, tris: 1, maxM: 300 },
                { node: lodNodes[1]!, tris: 1, maxM: null },
              ],
            },
          },
        },
      },
      landmarks: {},
    };
    const glb = () => new Response(makeGlb(lodNodes.map((name) => ({ name }))));

    function serve(over: { manifest?: () => Response; glb?: () => Response | Promise<Response> }) {
      return stubFetch((url) => {
        if (url.includes("/layers/buildings")) return json(CITY);
        if (url.endsWith("/city/manifest.json"))
          return over.manifest ? over.manifest() : json(MANIFEST);
        if (url.includes("/city/link_intermediate.glb?")) return over.glb ? over.glb() : glb();
        return json({}, 404);
      });
    }
    type Geo = { buildings: THREE.BufferGeometry };
    const vertsOf = (engine: Fake, call: number) =>
      (engine.setCity.mock.calls.at(call)![0] as Geo).buildings.getAttribute("position").count;

    it("a runtime switch to Low drops kits, lamp pools, agents, birds and markings; Medium restores them", async () => {
      tierFakes.on = true;
      tierFakes.kits.length = 0;
      tierFakes.groundTiers.length = 0;
      tierFakes.layers.length = 0;
      act(() => useSceneSettings.setState({ quality: "medium" }));
      try {
        serve({});
        const { engine } = mount();
        const s = screen.getByTestId("three-scene");
        await waitFor(() => expect(s).toHaveAttribute("data-assets", "ready"));
        act(() => engine.tick());
        const lastDecor = (slot: string) =>
          engine.setDecor.mock.calls.filter((c) => c[0] === slot).at(-1)?.[1];
        const driver = () =>
          engine.setMotion.mock.calls.at(-1)?.[0] as { group: THREE.Group } | null;
        const kitCount = () => {
          const k = tierFakes.kits.at(-1);
          return k ? [...k.values()].reduce((n, l) => n + l.length, 0) : 0;
        };
        await waitFor(() => expect(lastDecor("lamp-pools")).toBeTruthy());
        expect(kitCount()).toBe(1);
        expect(lastDecor("ambient")).toBeTruthy();
        expect(driver()?.group.children).toHaveLength(1);
        expect(tierFakes.groundTiers.at(-1)).toBe("medium");
        const cityCalls = engine.setCity.mock.calls.length;

        act(() => useSceneSettings.setState({ quality: "low" }));
        await waitFor(() => expect(lastDecor("lamp-pools")).toBeNull());
        expect(kitCount()).toBe(0);
        expect(lastDecor("ambient")).toBeNull();
        expect(driver()?.group.children).toHaveLength(0);
        expect(tierFakes.layers[0]?.disposed).toBe(1);
        expect(tierFakes.groundTiers.at(-1)).toBe("low");
        // The city mesh is never rebuilt for a tier change.
        expect(engine.setCity.mock.calls.length).toBe(cityCalls);

        act(() => useSceneSettings.setState({ quality: "medium" }));
        await waitFor(() => expect(lastDecor("lamp-pools")).toBeTruthy());
        expect(kitCount()).toBe(1);
        expect(lastDecor("ambient")).toBeTruthy();
        expect(driver()?.group.children).toHaveLength(1);
        expect(tierFakes.groundTiers.at(-1)).toBe("medium");
        expect(engine.setCity.mock.calls.length).toBe(cityCalls);
      } finally {
        tierFakes.on = false;
        act(() => useSceneSettings.setState({ quality: "auto" }));
      }
    });

    it("a Medium to High change keeps the signs and an open sign card; Low drops both", async () => {
      signFakes.on = true;
      act(() => useSceneSettings.setState({ quality: "medium" }));
      try {
        serve({});
        const { engine } = mount();
        await waitFor(() =>
          expect(screen.getByTestId("three-scene")).toHaveAttribute("data-assets", "ready"),
        );
        act(() => engine.tick());
        const lastSigns = () =>
          engine.setDecor.mock.calls.filter((c) => c[0] === "signs").at(-1)?.[1];
        await waitFor(() => expect(lastSigns()).toBeTruthy());
        const plans = signFakes.plans;
        const layer = lastSigns();
        act(() => useScene.getState().selectSign("s1"));
        act(() => useSceneSettings.setState({ quality: "high" }));
        act(() => engine.tick());
        expect(useScene.getState().selectedSignId).toBe("s1");
        expect(signFakes.plans).toBe(plans);
        expect(lastSigns()).toBe(layer);
        act(() => useSceneSettings.setState({ quality: "low" }));
        await waitFor(() => expect(lastSigns()).toBeNull());
        expect(useScene.getState().selectedSignId).toBeNull();
      } finally {
        signFakes.on = false;
        act(() => useScene.getState().selectSign(null));
        act(() => useSceneSettings.setState({ quality: "auto" }));
      }
    });

    it('assets load: setCity with only plan.extrude, setAssets once, data-assets="ready"', async () => {
      // Hold the glb until the buildings are drawn, so the order is deterministic.
      let open: () => void = () => {};
      const gate = new Promise<void>((r) => (open = r));
      serve({ glb: () => gate.then(glb) });
      const { engine } = mount();
      const s = screen.getByTestId("three-scene");
      await waitFor(() => expect(engine.setCity).toHaveBeenCalledTimes(1));
      expect(s).toHaveAttribute("data-assets", "loading");
      open();
      await waitFor(() => expect(s).toHaveAttribute("data-assets", "ready"));
      expect(engine.setAssets).toHaveBeenCalledTimes(1);
      // The full city first (no holes while loading), then only the plain building (one box).
      expect(vertsOf(engine, 0)).toBe(90);
      // 30 plus the styled fallback's trim band (6 per ring edge).
      expect(vertsOf(engine, -1)).toBe(54);
      const inst = engine.setAssets.mock.calls[0]?.[0] as CityInstances;
      expect(inst.group).toBeInstanceOf(THREE.Group);
      expect(console.warn).not.toHaveBeenCalled();
    });

    it("data-instances equals the placed unit count", async () => {
      serve({});
      mount();
      const s = screen.getByTestId("three-scene");
      await waitFor(() => expect(s).toHaveAttribute("data-assets", "ready"));
      expect(s).toHaveAttribute("data-instances", "2");
    });

    it("data-fallback is no_fit,generic_fill,no_archetype,no_asset from plan.stats.fallback", async () => {
      serve({});
      mount();
      const s = screen.getByTestId("three-scene");
      expect(s).toHaveAttribute("data-fallback", "0,0,0,0");
      await waitFor(() => expect(s).toHaveAttribute("data-assets", "ready"));
      // The plain building has no archetype; both links are placed.
      expect(s).toHaveAttribute("data-fallback", "0,0,1,0");
      expect(usePerfStats.getState().fallback).toEqual([0, 0, 1, 0]);
    });

    it.each([
      ["manifest 404", () => json({}, 404)],
      ["malformed manifest", () => json({ version: 2, assets: {} })],
      ["non-JSON manifest (dev server index.html)", () => new Response("<!doctype html><html>")],
      ["missing glb", undefined],
    ])(
      '%s: data-assets="failed", full city, setAssets never called, one warning',
      async (_n, manifest) => {
        serve(manifest ? { manifest } : { glb: () => json({}, 404) });
        const { engine } = mount();
        const s = screen.getByTestId("three-scene");
        await waitFor(() => expect(s).toHaveAttribute("data-assets", "failed"));
        expect(engine.setCity).toHaveBeenCalled();
        for (let i = 0; i < engine.setCity.mock.calls.length; i++)
          expect(vertsOf(engine, i)).toBe(90);
        expect(engine.setAssets).not.toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalledTimes(1);
        expect(s).toHaveAttribute("data-instances", "0");
      },
    );

    it("unmount while glbs are pending: no setAssets after dispose, library geometries disposed", async () => {
      let release: (r: Response) => void = () => {};
      const fetchFn = serve({ glb: () => new Promise<Response>((r) => (release = r)) });
      const disposed = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
      const { engine, unmount } = mount();
      await waitFor(() =>
        expect(fetchFn.mock.calls.some(([u]) => String(u).includes(".glb?"))).toBe(true),
      );
      expect(screen.getByTestId("three-scene")).toHaveAttribute("data-assets", "loading");
      unmount();
      expect(engine.dispose).toHaveBeenCalledTimes(1);
      const before = disposed.mock.calls.length;
      await act(async () => {
        release(glb());
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(engine.setAssets).not.toHaveBeenCalled();
      // Both baked LOD geometries were released by the aborted library.
      expect(disposed.mock.calls.length - before).toBeGreaterThanOrEqual(2);
      expect(console.warn).not.toHaveBeenCalled();
    });

    it("a library that resolves after unmount (abort race) is disposed, never handed over", async () => {
      let resolve: ((l: import("./assets/library").AssetLibrary) => void) | null = null;
      libraryHook.next = () => new Promise((r) => (resolve = r));
      const fake = {
        geometry: () => null,
        has: () => true,
        gpuBytes: () => 0,
        failed: [],
        dispose: vi.fn(),
      };
      serve({});
      const { engine, unmount } = mount();
      const s = screen.getByTestId("three-scene");
      await waitFor(() => expect(engine.setCity).toHaveBeenCalled());
      expect(s).toHaveAttribute("data-assets", "loading");
      await waitFor(() => expect(resolve).not.toBeNull());
      unmount();
      await act(async () => {
        resolve?.(fake);
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(fake.dispose).toHaveBeenCalled();
      expect(engine.setAssets).not.toHaveBeenCalled();
    });

    it("unmount after the assets are ready disposes the library geometries", async () => {
      serve({});
      const disposed: THREE.BufferGeometry[] = [];
      const orig = THREE.BufferGeometry.prototype.dispose;
      vi.spyOn(THREE.BufferGeometry.prototype, "dispose").mockImplementation(function (
        this: THREE.BufferGeometry,
      ) {
        disposed.push(this);
        orig.call(this);
      });
      const { engine, unmount } = mount();
      const s = screen.getByTestId("three-scene");
      await waitFor(() => expect(s).toHaveAttribute("data-assets", "ready"));
      const inst = engine.setAssets.mock.calls[0]?.[0] as CityInstances;
      const shared = new Set<unknown>();
      inst.group.traverse((o) => {
        const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        if (g) shared.add(g.getAttribute("position"));
      });
      expect(shared.size).toBeGreaterThan(0);
      unmount();
      const freed = new Set(disposed.map((g) => g.getAttribute("position")));
      for (const a of shared) expect(freed.has(a as never)).toBe(true);
    });

    it('?assets=0: data-assets="off", no manifest fetch, full city', async () => {
      history.replaceState(null, "", "/?assets=0");
      const fetchFn = serve({});
      const { engine } = mount();
      const s = screen.getByTestId("three-scene");
      await waitFor(() => expect(engine.setCity).toHaveBeenCalled());
      expect(s).toHaveAttribute("data-assets", "off");
      expect(fetchFn.mock.calls.some(([u]) => String(u).includes("/city/"))).toBe(false);
      expect(vertsOf(engine, -1)).toBe(90);
      expect(engine.setAssets).not.toHaveBeenCalled();
    });

    it("?showroom=1: every variant placed, nothing extruded", async () => {
      history.replaceState(null, "", "/?showroom=1");
      serve({});
      const { engine } = mount();
      const s = screen.getByTestId("three-scene");
      await waitFor(() => expect(s).toHaveAttribute("data-assets", "ready"));
      expect(s).toHaveAttribute("data-instances", "1");
      expect(vertsOf(engine, -1)).toBe(0);
    });

    it('?showroom=1 shows a "Model showroom — not the city" chip; without it, or when assets fail, none', async () => {
      history.replaceState(null, "", "/?showroom=1");
      serve({});
      const first = mount();
      await waitFor(() =>
        expect(screen.getByTestId("three-scene")).toHaveAttribute("data-assets", "ready"),
      );
      expect(screen.getByRole("note", { name: "Model showroom — not the city" })).toBeVisible();
      first.unmount();

      history.replaceState(null, "", "/");
      const plain = mount();
      await waitFor(() =>
        expect(screen.getByTestId("three-scene")).toHaveAttribute("data-assets", "ready"),
      );
      expect(screen.queryByText("Model showroom — not the city")).toBeNull();
      plain.unmount();

      history.replaceState(null, "", "/?showroom=1");
      serve({ manifest: () => json({}, 404) });
      mount();
      await waitFor(() =>
        expect(screen.getByTestId("three-scene")).toHaveAttribute("data-assets", "failed"),
      );
      expect(screen.queryByText("Model showroom — not the city")).toBeNull();
    });

    it('shows "Decorative details are illustrative." only when a decorative layer is drawn', async () => {
      const NOTE = "Decorative details are illustrative.";
      // Low draws no props, agents, birds or clouds; this world has no land cover or roads.
      useSceneSettings.setState({ quality: "low" });
      try {
        // Ready assets with nothing decorative (archetypes only): no note.
        serve({});
        const plain = mount();
        await waitFor(() =>
          expect(screen.getByTestId("three-scene")).toHaveAttribute("data-assets", "ready"),
        );
        expect(screen.queryByText(NOTE)).toBeNull();
        plain.unmount();

        // Ready assets that include a decorative model: note.
        serve({
          manifest: () =>
            json({
              ...MANIFEST,
              assets: {
                link_intermediate: { ...MANIFEST.assets.link_intermediate, decorative: true },
              },
            }),
        });
        const decor = mount();
        await waitFor(() =>
          expect(screen.getByTestId("three-scene")).toHaveAttribute("data-assets", "ready"),
        );
        await waitFor(() => expect(screen.getByRole("note", { name: NOTE })).toBeVisible());
        decor.unmount();

        history.replaceState(null, "", "/?assets=0");
        serve({});
        const off = mount();
        await waitFor(() => expect(off.engine.setCity).toHaveBeenCalled());
        expect(screen.getByTestId("three-scene")).toHaveAttribute("data-assets", "off");
        expect(screen.queryByText(NOTE)).toBeNull();
        off.unmount();

        history.replaceState(null, "", "/");
        serve({ manifest: () => json({}, 404) });
        mount();
        await waitFor(() =>
          expect(screen.getByTestId("three-scene")).toHaveAttribute("data-assets", "failed"),
        );
        expect(screen.queryByText(NOTE)).toBeNull();
      } finally {
        useSceneSettings.setState({ quality: "auto" });
      }
    });

    it("the note shows with ambient birds and cloud shadows alone (assets off, Medium tier)", async () => {
      history.replaceState(null, "", "/?assets=0");
      serve({});
      const { engine } = mount();
      await waitFor(() => expect(engine.setCity).toHaveBeenCalled());
      expect(
        screen.getByRole("note", { name: "Decorative details are illustrative." }),
      ).toBeVisible();
    });

    it("?showroom=1 frames the showroom grid (centred on HERO_CENTRE) once the assets are ready", async () => {
      history.replaceState(null, "", "/?showroom=1&bookmark=hero-near");
      serve({});
      const { engine } = mount();
      const s = screen.getByTestId("three-scene");
      await waitFor(() => expect(s).toHaveAttribute("data-assets", "ready"));
      await waitFor(() => expect(engine.rig.set.mock.calls.length).toBeGreaterThanOrEqual(2));
      const p = engine.rig.set.mock.calls.at(-1)?.[0] as Pose;
      const [hx, hz] = frame.toLocal(HERO_CENTRE[0], HERO_CENTRE[1]);
      // One 6.4 x 15.5 m model at the hero centre: the camera looks at it, close enough to see it.
      expect(p.target[0]).toBeCloseTo(hx, 3);
      expect(p.target[1]).toBeCloseTo(hz, 3);
      expect(p.rangeM).toBeGreaterThanOrEqual(150);
      expect(p.rangeM).toBeLessThanOrEqual(200);
      expect(p.pitchDeg).toBe(-50);
    });

    describe("two assets", () => {
      const semiNodes = ["semi_d__gable__LOD0", "semi_d__gable__LOD1"];
      const linkSpec = MANIFEST.assets.link_intermediate!;
      const MANIFEST2: Manifest = {
        ...MANIFEST,
        assets: {
          link_intermediate: linkSpec,
          semi_d: {
            ...linkSpec,
            file: "semi_d.glb",
            variants: {
              gable: {
                size: [6.4, 8.5, 15.5],
                lods: [
                  { node: semiNodes[0]!, tris: 1, maxM: 300 },
                  { node: semiNodes[1]!, tris: 1, maxM: null },
                ],
              },
            },
          },
        },
      };
      const semi = (id: string, cx: number) => {
        const f = link(id, cx);
        return { ...f, properties: { ...f.properties, archetype: "semi_d" } };
      };
      const CITY2 = {
        ...CITY,
        buildings: {
          ...CITY.buildings,
          features: [...CITY.buildings.features, semi("s1", 110)],
        },
      };
      const semiGlb = () => new Response(makeGlb(semiNodes.map((name) => ({ name }))));
      function serve2(fail: { link?: boolean; semi?: boolean }) {
        return stubFetch((url) => {
          if (url.includes("/layers/buildings")) return json(CITY2);
          if (url.endsWith("/city/manifest.json")) return json(MANIFEST2);
          if (url.includes("/city/link_intermediate.glb?"))
            return fail.link ? json({}, 404) : glb();
          if (url.includes("/city/semi_d.glb?")) return fail.semi ? json({}, 404) : semiGlb();
          return json({}, 404);
        });
      }

      it('every glb fails: data-assets="failed", full city, exactly one warning', async () => {
        serve2({ link: true, semi: true });
        const { engine } = mount();
        const s = screen.getByTestId("three-scene");
        await waitFor(() => expect(s).toHaveAttribute("data-assets", "failed"));
        await waitFor(() => expect(engine.setCity).toHaveBeenCalled());
        for (let i = 0; i < engine.setCity.mock.calls.length; i++)
          expect(vertsOf(engine, i)).toBe(120);
        expect(engine.setAssets).not.toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalledTimes(1);
        const msg = String(vi.mocked(console.warn).mock.calls[0]?.[0]);
        expect(msg).toContain("link_intermediate");
        expect(msg).toContain("semi_d");
      });

      it('one of two glbs fails: "ready", its buildings extruded, exactly one warning naming it', async () => {
        serve2({ semi: true });
        const { engine } = mount();
        const s = screen.getByTestId("three-scene");
        await waitFor(() => expect(s).toHaveAttribute("data-assets", "ready"));
        // plain + s1 stay extruded (two boxes, 54 vertices each with the trim band); l1 and l2 are instanced.
        expect(vertsOf(engine, -1)).toBe(108);
        expect(s).toHaveAttribute("data-instances", "2");
        expect(engine.setAssets).toHaveBeenCalledTimes(1);
        expect(console.warn).toHaveBeenCalledTimes(1);
        const msg = String(vi.mocked(console.warn).mock.calls[0]?.[0]);
        expect(msg).toContain("semi_d");
        expect(msg).not.toContain("link_intermediate");
      });
      it("a glb without the manifest's nodes: its buildings stay extruded, one warning naming it", async () => {
        // semi_d.glb parses but carries none of the manifest's semi_d__gable__LOD* nodes.
        stubFetch((url) => {
          if (url.includes("/layers/buildings")) return json(CITY2);
          if (url.endsWith("/city/manifest.json")) return json(MANIFEST2);
          if (url.includes("/city/link_intermediate.glb?")) return glb();
          if (url.includes("/city/semi_d.glb?"))
            return new Response(makeGlb([{ name: "semi_d__other__LOD0" }]));
          return json({}, 404);
        });
        const { engine } = mount();
        const s = screen.getByTestId("three-scene");
        await waitFor(() => expect(s).toHaveAttribute("data-assets", "ready"));
        // plain + s1 extruded (two boxes, 54 vertices each), not a hole; l1 and l2 instanced.
        expect(vertsOf(engine, -1)).toBe(108);
        expect(s).toHaveAttribute("data-instances", "2");
        const inst = engine.setAssets.mock.calls[0]?.[0] as CityInstances;
        const names: string[] = [];
        inst.group.traverse((o) => names.push(o.name));
        expect(names.some((n) => n.startsWith("semi_d"))).toBe(false);
        expect(console.warn).toHaveBeenCalledTimes(1);
        const msg = String(vi.mocked(console.warn).mock.calls[0]?.[0]);
        expect(msg).toContain("semi_d__gable__LOD0");
        expect(msg).not.toContain("link_intermediate");
      });
    });

    it("an instance build error: failed, full city, library disposed, one warning even after a refetch", async () => {
      instancesFault.on = true;
      // Each buildings fetch returns a new body (structural sharing would keep an equal one).
      let n = 0;
      // Hold the glb until the full city is drawn, so the setCity count is deterministic.
      let open: () => void = () => {};
      const gate = new Promise<void>((r) => (open = r));
      stubFetch((url) => {
        if (url.includes("/layers/buildings")) return json({ ...CITY, as_of: `v${n++}` });
        if (url.endsWith("/city/manifest.json")) return json(MANIFEST);
        if (url.includes("/city/link_intermediate.glb?")) return gate.then(glb);
        return json({}, 404);
      });
      const disposed = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
      const { engine, qc } = mount();
      const s = screen.getByTestId("three-scene");
      await waitFor(() => expect(engine.setCity).toHaveBeenCalledTimes(1));
      open();
      await waitFor(() => expect(s).toHaveAttribute("data-assets", "failed"));
      await waitFor(() => expect(vertsOf(engine, -1)).toBe(90));
      expect(disposed).toHaveBeenCalled();
      // The full city before the assets, then once more for the fallback (not twice: M6).
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(engine.setCity).toHaveBeenCalledTimes(2);
      const calls = engine.setCity.mock.calls.length;
      await act(async () => {
        await qc.invalidateQueries();
      });
      await waitFor(() => expect(engine.setCity.mock.calls.length).toBeGreaterThan(calls));
      expect(vertsOf(engine, -1)).toBe(90);
      expect(s).toHaveAttribute("data-assets", "failed");
      expect(engine.setAssets).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledTimes(1);
    });

    it("with assets ready, the building card learns the manifest and the extruded fallbacks", async () => {
      serve({});
      mount();
      const s = screen.getByTestId("three-scene");
      await waitFor(() => expect(s).toHaveAttribute("data-assets", "ready"));
      const info = useCityInfo.getState();
      expect(info.manifest).not.toBeNull();
      expect(info.extruded).toBeInstanceOf(Set);
    });

    it("frame perf: tris and gpuMB reach usePerfStats", async () => {
      serve({});
      const { engine } = mount();
      const s = screen.getByTestId("three-scene");
      await waitFor(() => expect(s).toHaveAttribute("data-assets", "ready"));
      act(() => {
        engine.frames++;
        for (const cb of engine.frameCbs)
          (cb as (dt: number, i: unknown) => void)(0, { calls: 9, tris: 1234, moving: false });
      });
      await waitFor(() => expect(usePerfStats.getState().tris).toBe(1234));
      expect(usePerfStats.getState().gpuMB).toBeGreaterThan(0);
    });
  });
  describe("picking", () => {
    const host = () => screen.getByTestId("three-scene").firstElementChild as HTMLElement;
    const click = (from: [number, number], to: [number, number]) => {
      vi.spyOn(host(), "getBoundingClientRect").mockReturnValue(
        DOMRect.fromRect({ x: 0, y: 0, width: 800, height: 600 }),
      );
      fireEvent.pointerDown(host(), {
        button: 0,
        isPrimary: true,
        clientX: from[0],
        clientY: from[1],
      });
      fireEvent.pointerUp(host(), { button: 0, isPrimary: true, clientX: to[0], clientY: to[1] });
    };
    const placeData = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { id: "p1", name: "Playground", type: "park" },
          geometry: { type: "Point", coordinates: CENTER },
        },
      ],
    };
    beforeEach(() => {
      useScene.getState().reset();
      accessLayer.data = placeData;
    });
    afterEach(() => {
      accessLayer.data = { type: "FeatureCollection", features: [] };
    });

    it("a click within 4 px picks at the pointer's NDC and dispatches selectPlace for a place hit", () => {
      mount();
      pickStub.hit = { kind: "place", id: "p1" };
      act(() => click([200, 150], [203, 152]));
      expect(pickStub.calls).toHaveLength(1);
      const [ndc, , , linePx, view] = pickStub.calls[0] as [
        { x: number; y: number },
        unknown,
        unknown,
        number,
        { width: number; height: number },
      ];
      expect(ndc.x).toBeCloseTo((203 / 800) * 2 - 1, 6);
      expect(ndc.y).toBeCloseTo(-(152 / 600) * 2 + 1, 6);
      expect(linePx).toBe(8);
      expect(view).toEqual({ width: 800, height: 600 });
      expect(useScene.getState().selectedPlaceId).toBe("p1");
    });

    it("a drag over 4 px dispatches nothing (the camera rig orbits)", async () => {
      mount();
      pickStub.hit = { kind: "place", id: "p1" };
      act(() => click([200, 150], [205, 150]));
      expect(pickStub.calls).toHaveLength(0);
      expect(useScene.getState().selectedPlaceId).toBeNull();
    });

    it.each<[PickHit, () => unknown]>([
      [{ kind: "floodEdge", id: "e1" }, () => useScene.getState().selectedFloodEdgeId],
      [{ kind: "sign", id: "s1" }, () => useScene.getState().selectedSignId],
      [{ kind: "building", id: "b1" }, () => useScene.getState().selectedBuildingId],
      [{ kind: "landmark", id: "kanopi-residences" }, () => useScene.getState().selectedBuildingId],
      [{ kind: "resident", id: "r1" }, () => useScene.getState().day.focus],
      [{ kind: "evac", id: "p1" }, () => useScene.getState().selectedPlaceId],
      [{ kind: "waste", id: "p1" }, () => useScene.getState().selectedPlaceId],
    ])("dispatches %o", (hit, read) => {
      mount();
      pickStub.hit = hit;
      act(() => click([10, 10], [10, 10]));
      expect(read()).toBe(hit.id);
    });

    it("an evac or waste hit that is not a place opens nothing", () => {
      mount();
      for (const kind of ["evac", "waste"] as const) {
        pickStub.hit = { kind, id: "c9" };
        act(() => click([10, 10], [10, 10]));
      }
      const st = useScene.getState();
      expect([st.selectedPlaceId, st.selectedBuildingId, st.selectedSignId]).toEqual([
        null,
        null,
        null,
      ]);
    });

    it("a press released outside the map does not swallow the next click", () => {
      mount();
      pickStub.hit = { kind: "place", id: "p1" };
      // pressed on the map, released elsewhere (no pointerup reaches the host)
      fireEvent.pointerDown(host(), { button: 0, isPrimary: true, clientX: 300, clientY: 300 });
      act(() => click([10, 10], [10, 10]));
      expect(pickStub.calls).toHaveLength(1);
      expect(useScene.getState().selectedPlaceId).toBe("p1");
    });

    it("a secondary-button click or a second finger never picks", () => {
      mount();
      pickStub.hit = { kind: "place", id: "p1" };
      fireEvent.pointerDown(host(), { button: 2, isPrimary: true, clientX: 5, clientY: 5 });
      fireEvent.pointerUp(host(), { button: 2, isPrimary: true, clientX: 5, clientY: 5 });
      fireEvent.pointerDown(host(), { button: 0, isPrimary: true, clientX: 5, clientY: 5 });
      fireEvent.pointerDown(host(), { button: 0, isPrimary: false, clientX: 50, clientY: 5 });
      fireEvent.pointerUp(host(), { button: 0, isPrimary: true, clientX: 5, clientY: 5 });
      expect(pickStub.calls).toHaveLength(0);
    });

    it("publishes the extruded city for the building card, and a picked building closes on unmount", async () => {
      useCityInfo.setState({ manifest: null, extruded: new Set(["x"]) });
      const { engine, unmount } = mount();
      await waitFor(() => expect(engine.setCity).toHaveBeenCalled());
      // no manifest (404): every building is a simple block
      await waitFor(() => expect(useCityInfo.getState().extruded).toBeNull());
      pickStub.hit = { kind: "building", id: "b1" };
      act(() => click([10, 10], [10, 10]));
      expect(useScene.getState().selectedBuildingId).toBe("b1");
      unmount();
      expect(useScene.getState().selectedBuildingId).toBeNull();
    });
  });
});
