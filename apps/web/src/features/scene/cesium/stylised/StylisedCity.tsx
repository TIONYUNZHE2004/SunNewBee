import * as Cesium from "cesium";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCesium } from "resium";
import { useBuildings, useLayer, useSite } from "../../../../lib/api";
import { useTheme } from "../../../../ui/theme";
import { prefersReducedMotion, useSceneSettings } from "../../sceneSettingsStore";
import { homeView } from "../home";
import { type BuildingPrimitives, buildBuildingPrimitives } from "./buildingsPrimitive";
import { startCrossfade } from "./crossfade";
import {
  buildGround,
  type Ground,
  parksFromLayer,
  roadsFromWalk,
  type WaterPolygon,
  waterFromLayer,
} from "./ground";
import { groupByClass, toBuildings, treesToPoints } from "./model";
import { createMotionClock, motionActive } from "./motion/clock";
import { cloudSpots, flockLoops } from "./motion/flocks";
import { buildSky, type Sky } from "./motion/sky";
import { paletteFor } from "./palette";
import { applyPostFx } from "./postfx";
import { buildProps, kerbCars, type Props, streetLamps, streetTrees } from "./props";
import {
  createFrameMonitor,
  createFrameSampler,
  gpuName,
  lowerTier,
  pickTier,
  TIERS,
  type Tier,
} from "./quality";
import { reskinPalette } from "./reskin";
import { roofClutter } from "./roofs";

export interface StylisedReady {
  buildings: number;
  skipped: number;
  primitives: number;
  /** Main-thread ms to parse, mesh and create the primitives (GPU upload happens on the next frame). */
  buildMs: number;
}

/** Hide imagery, sky and atmosphere (keeps the light, background, fog and globe shadows to restore). Returns a restore function. */
export function applyStylisedLook(viewer: Cesium.Viewer): () => void {
  const { scene } = viewer;
  const { globe } = scene;
  const layers = Array.from({ length: scene.imageryLayers.length }, (_, i) =>
    scene.imageryLayers.get(i),
  );
  const prev = {
    baseColor: globe.baseColor.clone(),
    groundAtmosphere: globe.showGroundAtmosphere,
    lighting: globe.enableLighting,
    background: scene.backgroundColor.clone(),
    globeShadows: globe.shadows,
    fog: scene.fog.density,
    skyAtmosphere: scene.skyAtmosphere?.show,
    skyBox: scene.skyBox?.show,
    sun: scene.sun?.show,
    moon: scene.moon?.show,
    light: scene.light,
    layers: layers.map((l) => l.show),
  };
  globe.showGroundAtmosphere = false;
  globe.enableLighting = false;
  for (const l of layers) l.show = false;
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
  if (scene.skyBox) scene.skyBox.show = false;
  if (scene.sun) scene.sun.show = false;
  if (scene.moon) scene.moon.show = false;
  // The page behind the canvas shows the sky gradient (CesiumScene).
  scene.backgroundColor = Cesium.Color.TRANSPARENT;
  globe.shadows = Cesium.ShadowMode.RECEIVE_ONLY;
  return () => {
    if (viewer.isDestroyed()) return;
    globe.baseColor = prev.baseColor;
    globe.showGroundAtmosphere = prev.groundAtmosphere;
    globe.enableLighting = prev.lighting;
    scene.backgroundColor = prev.background;
    globe.shadows = prev.globeShadows;
    scene.fog.density = prev.fog;
    scene.light = prev.light;
    layers.forEach((l, i) => {
      if (!l.isDestroyed()) l.show = prev.layers[i] ?? true;
    });
    if (scene.skyAtmosphere && prev.skyAtmosphere !== undefined)
      scene.skyAtmosphere.show = prev.skyAtmosphere;
    if (scene.skyBox && prev.skyBox !== undefined) scene.skyBox.show = prev.skyBox;
    if (scene.sun && prev.sun !== undefined) scene.sun.show = prev.sun;
    if (scene.moon && prev.moon !== undefined) scene.moon.show = prev.moon;
    scene.requestRender();
  };
}

/** Seed for decorative placement (trees, cars): fixed, so the city looks the same every visit. */
const PROPS_SEED = "tl-stylised";
/**
 * Decorative base water comes from `/layers/buildings` (`water`, OSM hydrology polygons). It is NOT
 * a flood scenario: flood water is a scenario, never decoration, and is not used here. Parks are
 * decorative outlines too (OSM), flat bands with no access or safety meaning.
 */
const NO_WATER: WaterPolygon[] = [];
/** Side of the square the decorative clouds drift and wrap in (metres, centred on home). */
const CLOUD_EXTENT_M = 5000;
const BIRDS_PER_FLOCK = 7;
/** Birds need Motion on (and no reduced-motion preference); clouds stay, frozen, without it. */
const birdsWanted = (motion: boolean) => motion && !prefersReducedMotion();

/**
 * Resium child of <Viewer>: the stylised city (flat ground, roads, buildings with lit windows,
 * decorative trees and parked cars). Buildings render nothing while the world has no buildings data
 * (API 404 -> null); roads come from the walk network and are drawn regardless.
 */
export function StylisedCity({ onReady }: { onReady?: (info: StylisedReady) => void }) {
  const { viewer } = useCesium();
  const buildingsQ = useBuildings();
  const data = buildingsQ.data;
  const site = useSite().data;
  const theme = useTheme((s) => s.theme);
  const buildings = useRef<BuildingPrimitives | null>(null);
  const ground = useRef<Ground | null>(null);
  const props = useRef<Props | null>(null);
  const sky = useRef<Sky | null>(null);
  const clock = useRef<ReturnType<typeof createMotionClock> | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  // Roads and props start after the buildings' first frame (or at once when there are none), so
  // their worker builds never delay the city's first frame.
  const [buildingsShown, setBuildingsShown] = useState(false);
  const details = buildingsShown || buildingsQ.isError || (buildingsQ.isSuccess && !data);
  // The walk network (~5 MB) is fetched only then too: it would compete with the buildings fetch.
  const walk = useLayer("access", "default", null, details).data;
  const home = useMemo(() => homeView(site), [site]);

  const parsed = useMemo(() => {
    if (!data) return null;
    const t0 = performance.now();
    const { buildings, skipped } = toBuildings(data.buildings);
    return { classes: groupByClass(buildings), count: buildings.length, skipped, t0 };
  }, [data]);
  const roads = useMemo(() => (details ? roadsFromWalk(walk) : []), [walk, details]);
  const parks = useMemo(() => (data?.parks ? parksFromLayer(data.parks) : NO_WATER), [data]);
  const water = useMemo(() => (data?.water ? waterFromLayer(data.water) : NO_WATER), [data]);
  // Flocks circle parks (first vertex of each outline), or water when there are no parks.
  const flockAnchors = useMemo(
    () =>
      (parks.length > 0 ? parks : water)
        .map((poly) => poly[0]?.[0])
        .filter((p): p is [number, number] => p !== undefined),
    [parks, water],
  );
  const decor = useMemo(
    () => ({
      trees: [...treesToPoints(data?.trees), ...streetTrees(roads, PROPS_SEED)],
      cars: kerbCars(roads, PROPS_SEED),
      lamps: streetLamps(roads, PROPS_SEED),
      roofItems: roofClutter(parsed ? [...parsed.classes.values()].flat() : [], PROPS_SEED),
    }),
    [data, roads, parsed],
  );

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    return applyStylisedLook(viewer);
  }, [viewer]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !parsed) return;
    const t = useTheme.getState().theme;
    const h = buildBuildingPrimitives(
      Cesium,
      parsed.classes,
      paletteFor(t),
      viewer.scene.primitives,
    );
    buildings.current = h;
    setBuildingsShown(false); // new data: details wait for this set's first frame again
    viewer.scene.requestRender();
    const off = viewer.scene.postRender.addEventListener(() => {
      if (h.primitives.some((p) => !p.ready)) return;
      off();
      setBuildingsShown(true);
    });
    onReadyRef.current?.({
      buildings: parsed.count,
      skipped: parsed.skipped,
      primitives: h.primitives.length,
      buildMs: performance.now() - parsed.t0,
    });
    return () => {
      off();
      buildings.current = null;
      if (viewer.isDestroyed()) return;
      h.destroy();
      viewer.scene.requestRender();
    };
  }, [viewer, parsed]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || roads.length === 0) return;
    // Roads are ClassificationPrimitives (thin volumes around height 0): they only show on the
    // flat ellipsoid ground that resolveMapStyle guarantees for the stylised style (no terrain,
    // no tiles). Do not mount StylisedCity over terrain.
    const h = buildGround(Cesium, viewer, {
      roads,
      water,
      parks,
      palette: paletteFor(useTheme.getState().theme),
    });
    ground.current = h;
    viewer.scene.requestRender();
    return () => {
      ground.current = null;
      if (viewer.isDestroyed()) return;
      h.destroy();
      viewer.scene.requestRender();
    };
  }, [viewer, roads, water, parks]);

  // Quality tier: the user's choice, or the GPU-picked tier lowered by the frame monitor.
  const quality = useSceneSettings((s) => s.quality);
  const detected = useMemo<Tier>(() => {
    if (!viewer || viewer.isDestroyed()) return "medium";
    let gpu: string | undefined;
    try {
      const gl = (viewer.scene as unknown as { context: { _gl?: WebGLRenderingContext } }).context
        ._gl;
      gpu = gpuName(gl);
    } catch {
      gpu = undefined;
    }
    return pickTier(gpu, (navigator as Navigator & { deviceMemory?: number }).deviceMemory);
  }, [viewer]);
  // Only ever lowered from the detected tier by the frame monitor.
  const [dropped, setDropped] = useState<Tier | null>(null);
  const autoTier = dropped ?? detected;
  const tier: Tier = quality === "auto" ? autoTier : quality;

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !details) return;
    if (decor.trees.length + decor.cars.length + decor.lamps.length + decor.roofItems.length === 0)
      return;
    const h = buildProps(
      Cesium,
      {
        ...decor,
        palette: paletteFor(useTheme.getState().theme),
        at: home,
        detailRangeM: TIERS[tier].detailRangeM,
      },
      viewer.scene.primitives,
    );
    props.current = h;
    viewer.scene.requestRender();
    return () => {
      props.current = null;
      if (viewer.isDestroyed()) return;
      h.destroy();
      viewer.scene.requestRender();
    };
  }, [viewer, decor, details, home, tier]);

  // Decorative birds and clouds, after the details like the props. Counts follow the tier.
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !details) return;
    const spec = TIERS[tier];
    if (spec.birds + spec.clouds === 0) return;
    const h = buildSky(Cesium, viewer, {
      at: home,
      loops: flockLoops(home, flockAnchors, spec.birds, PROPS_SEED),
      clouds: cloudSpots(spec.clouds, PROPS_SEED, CLOUD_EXTENT_M),
      palette: paletteFor(useTheme.getState().theme),
      birdsPerFlock: BIRDS_PER_FLOCK,
      extentM: CLOUD_EXTENT_M,
    });
    h.setVisible(birdsWanted(useSceneSettings.getState().motion), true);
    if (clock.current) h.tick(clock.current.time());
    sky.current = h;
    return () => {
      sky.current = null;
      if (viewer.isDestroyed()) return;
      h.destroy();
      viewer.scene.requestRender();
    };
  }, [viewer, details, home, tier, flockAnchors]);

  // One capped motion clock per viewer drives the birds, the clouds and the cloud shadows.
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const c = createMotionClock({
      fps: 30,
      requestRender: () => {
        if (!viewer.isDestroyed()) viewer.scene.requestRender();
      },
      onTick: (t) => {
        sky.current?.tick(t);
        buildings.current?.setTime(t);
        props.current?.setTime(t);
      },
    });
    clock.current = c;
    return () => {
      c.destroy();
      clock.current = null;
    };
  }, [viewer]);

  // Run the clock only while Motion is on, the tab is visible and the map is on screen.
  const motion = useSceneSettings((s) => s.motion);
  useEffect(() => {
    const c = clock.current;
    if (!viewer || viewer.isDestroyed() || !c) return;
    sky.current?.setVisible(birdsWanted(motion), true);
    let onScreen = true;
    const update = () =>
      c.setActive(
        motionActive({
          enabled: motion,
          visible: document.visibilityState === "visible",
          onScreen,
          reduced: prefersReducedMotion(),
        }),
      );
    document.addEventListener("visibilitychange", update);
    let io: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === "function") {
      io = new IntersectionObserver((entries) => {
        onScreen = entries.some((e) => e.isIntersecting);
        update();
      });
      io.observe(viewer.container);
    }
    update();
    return () => {
      document.removeEventListener("visibilitychange", update);
      io?.disconnect();
      c.setActive(false);
    };
  }, [viewer, motion]);
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || quality !== "auto") return;
    const monitor = createFrameMonitor(() => setDropped((d) => lowerTier(d ?? detected)));
    const sampler = createFrameSampler(monitor);
    const offMove = viewer.camera.changed.addEventListener(() => sampler.moved(performance.now()));
    const offPost = viewer.scene.postRender.addEventListener(() =>
      sampler.frame(performance.now()),
    );
    return () => {
      offMove();
      offPost();
    };
  }, [viewer, quality, detected]);
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    applyPostFx(Cesium, viewer, paletteFor(theme), TIERS[tier]);
  }, [viewer, theme, tier]);
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    return () => {
      if (viewer.isDestroyed()) return;
      const s = viewer.scene.postProcessStages;
      s.ambientOcclusion.enabled = false;
      s.bloom.enabled = false;
      viewer.shadows = false;
      viewer.resolutionScale = 1;
      viewer.scene.requestRender();
    };
  }, [viewer]);

  // Crossfade to the chosen mood. A new theme cancels the running fade and restarts from what is
  // shown; layers built mid-fade (or after) start from the latest theme's palette, so every path
  // ends on the last choice. The ground recolours once, at the midpoint (never intermediates).
  const shown = useRef(paletteFor(useTheme.getState().theme));
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const to = paletteFor(theme);
    let groundDone = false;
    const cancel = startCrossfade(
      shown.current,
      to,
      (p, t) => {
        if (viewer.isDestroyed()) return;
        shown.current = p;
        reskinPalette(
          Cesium,
          viewer,
          [buildings.current, props.current, sky.current],
          p,
          home,
          t >= 1,
        );
        if (!groundDone && t >= 0.5) {
          groundDone = true;
          ground.current?.setPalette(to, true);
        }
      },
      { reduced: prefersReducedMotion() },
    );
    return cancel;
  }, [viewer, theme, home]);

  return null;
}
