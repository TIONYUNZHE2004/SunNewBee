import { type RefObject, useEffect, useState } from "react";
import * as THREE from "three";
import {
  type CompareScreen,
  compareTimelineOf,
  type ScreenPoint,
  useCompare,
} from "../../../journey/compareStore";
import { compareStateAt } from "../../../journey/compareTimeline";
import { isPlayableCompare } from "../../../journey/compareTypes";
import { applyCutaway, NO_CUT, setCut, sightCut } from "../../../journey/three/cutaway";
import { projectToScreen } from "../../../journey/three/project";
import { createViewFit } from "../../../journey/three/viewFit";
import { measureMapArea } from "../../../journey/useMapInsets";
import { VFOV_DEG } from "../cameraRig";
import type { CameraDriver, Engine, SplitView } from "../engine";
import { releaseSlots } from "../engineSlots";
import type { LocalFrame } from "../frame";
import type { CamPose } from "../journey/followRig";
import type { CrowdKit } from "../motion/crowdBake";
import { CROWD_LOAD_TIMEOUT_MS, loadCrowdKit } from "../motion/crowdKit";
import {
  CARD_BOTTOM_PX,
  CARD_EST_PX,
  chasePose,
  compareCamerasAt,
  compareOverview,
  overviewSafe,
  pullWeight,
} from "./compareCameras";
import { type CompareLayer, createCompareLayer } from "./compareLayer";
import { applySideProjection, type SplitLayout, splitViewports } from "./splitView";

/** The engine decor slot of the compare layer. */
export const COMPARE_SLOT = "compare";

/**
 * Where the overview's reasons-card top is assumed to be (AC-N7): the card's reported top, but
 * never lower than the estimate, so a card shorter than estimated never moves the camera at 32 s.
 * The card sits above the overlay's player dock (`dockTop`, V2 fix N-b/N-c), else above the map's
 * bottom edge.
 */
export function overviewCardTop(
  h: number,
  reported: number | null,
  dockTop: number | null = null,
): number {
  const floor = dockTop != null && dockTop > 0 ? Math.min(h, dockTop) - 8 : h - CARD_BOTTOM_PX;
  const est = floor - CARD_EST_PX;
  return reported == null ? est : Math.min(reported, est);
}

/** Screen box of world points seen by `camera` in a `size` view (CSS px), or null. */
export function screenBox(
  camera: THREE.Camera,
  pts: readonly (readonly [number, number, number])[],
  size: readonly [number, number],
): CompareScreen["routesBbox"] {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const p of pts) {
    const s = projectToScreen(camera, p, size);
    if (!s) continue;
    x0 = Math.min(x0, s.x);
    y0 = Math.min(y0, s.y);
    x1 = Math.max(x1, s.x);
    y1 = Math.max(y1, s.y);
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

const r1 = (v: number) => Math.round(v * 2) / 2;
const keyOf = (s: CompareScreen) =>
  JSON.stringify(s, (_k, v) => (typeof v === "number" ? r1(v) : v));

/**
 * The compare playback in the Stylised map (demo polish B8, spec §5.3): while the compare store
 * holds a playable compare, the compare layer (ribbons, two wheelchair users, the greeter) is in
 * the scene, a camera driver gives the engine its camera from the compare timeline, and the
 * engine draws a split screen with one chase camera per walker until 31.5 s, then one overview of
 * both routes. After each frame the renderer writes `useCompare().screen` (walkers, POI anchors,
 * the unchecked stretch, the halves, and after the merge the routes' screen box) for the overlay.
 * The HTML overlay itself is `journey/compare/CompareOverlay` (MapStage).
 */
export function CompareSceneMount({
  engine,
  frame,
  hostRef,
}: {
  engine: Engine | null;
  frame: LocalFrame | null;
  hostRef?: RefObject<HTMLElement | null>;
}) {
  const payload = useCompare((s) => s.payload);
  const playable = isPlayableCompare(payload) ? payload : null;

  // the greeter's crowd kit (loaded once a compare is shown; kept for the mount)
  const [kit, setKit] = useState<CrowdKit | null>(null);
  const wantKit = !!playable && !!engine;
  useEffect(() => {
    if (!wantKit || kit || import.meta.env.MODE === "test") return;
    const ac = new AbortController();
    let live = true;
    loadCrowdKit({ signal: ac.signal, timeoutMs: CROWD_LOAD_TIMEOUT_MS }).then(
      (k) => {
        if (live) setKit(k);
        else k.dispose();
      },
      () => {},
    );
    return () => {
      live = false;
      ac.abort();
    };
  }, [wantKit, kit]);

  // building materials carry the (inactive) cutaway from their first compile, as in JourneyMount
  useEffect(() => {
    if (!engine?.addMaterialPatch) return;
    return engine.addMaterialPatch((root) => applyCutaway([root]));
  }, [engine]);

  const [layer, setLayer] = useState<CompareLayer | null>(null);
  useEffect(() => {
    if (!layer || !engine) return;
    layer.setKit(kit);
    engine.requestRender();
  }, [layer, kit, engine]);

  useEffect(() => {
    if (!engine || !frame || !playable) return;
    const c = playable;
    const tl = compareTimelineOf(c);
    const l = createCompareLayer({
      payload: c,
      timeline: tl,
      frame,
      prepare: (o) => engine.prewarm?.(o) ?? Promise.resolve(),
      onReady: () => engine.requestRender(),
    });
    engine.setDecor(COMPARE_SLOT, { group: l.group, dispose: l.dispose });
    setLayer(l);
    const fastL = Math.max(0, c.fastest.distance_m);
    const recL = Math.max(0, c.recommended.distance_m);

    const sv: SplitView = {
      left: { camera: new THREE.PerspectiveCamera(50, 1, 2, 30000), look: new THREE.Vector3() },
      right: { camera: new THREE.PerspectiveCamera(50, 1, 2, 30000), look: new THREE.Vector3() },
      beforeSide: (side) => {
        l.setSide(side);
        // buildings between each half's camera and its walker are cut away (never hide the walker)
        if (!side) return setCut(NO_CUT);
        const w = l.anchors().walkers[side === "left" ? "fastest" : "recommended"];
        const p = sv[side].camera.position;
        setCut(sightCut([p.x, p.y, p.z], [w[0], w[2]]));
      },
    };
    let splitOn = false;

    // the overview, refitted only when the canvas, the map's top stack or the card top changes
    let ov: { key: string; pose: CamPose } | null = null;
    // the map area (a layout read), measured once and again only when the map or the top stack
    // resizes or a transition (the side panel) ends: never per frame
    const host = hostRef?.current ?? null;
    let area: { w: number; h: number; top?: number } | null = null;
    const staleArea = () => {
      area = null;
      engine.requestRender();
    };
    let ro: ResizeObserver | null = null;
    if (host && typeof ResizeObserver === "function") {
      ro = new ResizeObserver(staleArea);
      ro.observe(host);
      const stack = host.ownerDocument.querySelector('[data-testid="top-stack"]');
      if (stack) ro.observe(stack);
    }
    host?.ownerDocument.addEventListener("transitionend", staleArea, true);
    const overview = (): CamPose => {
      const size = engine.pickView().size;
      area ??= host ? measureMapArea(host) : { w: size[0], h: size[1], top: 0 };
      const cs = useCompare.getState();
      const cardTop = overviewCardTop(area.h, cs.screen?.cardTop ?? null, cs.dockTop);
      const key = `${size[0]}x${size[1]}|${area.w}x${area.h}|${area.top ?? 0}|${cardTop}`;
      if (!ov || ov.key !== key) {
        const cam = new THREE.PerspectiveCamera(VFOV_DEG, size[0] / Math.max(1, size[1]), 2, 30000);
        cam.updateProjectionMatrix();
        const view = createViewFit(cam, size, overviewSafe(area, cardTop));
        ov = {
          key,
          pose: compareOverview(
            { pointAt: l.paths.fastest.pointAt, length: fastL },
            { pointAt: l.paths.recommended.pointAt, length: recL },
            view,
          ),
        };
      }
      return ov.pose;
    };

    const place = (
      cam: THREE.PerspectiveCamera,
      look: THREE.Vector3,
      p: CamPose & { fovDeg: number },
    ) => {
      cam.position.set(...p.pos);
      look.set(...p.look);
      cam.lookAt(look);
      cam.fov = p.fovDeg;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
    };

    const driver: CameraDriver = () => {
      const s = useCompare.getState();
      if (s.payload !== c) return null;
      const st = compareStateAt(tl, s.t, { reduced: s.reduced });
      l.update(st.t, st.walkers);
      const chase = {
        left: chasePose(l.paths.fastest.pointAt, st.walkers.fastest, fastL),
        right: chasePose(l.paths.recommended.pointAt, st.walkers.recommended, recL),
      };
      // the overview (a layout read and a fit) only once the pull-back has started
      const ovPose = pullWeight(st.t, s.reduced) > 0 ? overview() : chase.right;
      const cams = compareCamerasAt(st.t, st.camera, chase, ovPose, s.reduced);
      place(sv.left.camera, sv.left.look, cams.left);
      place(sv.right.camera, sv.right.look, cams.right);
      const want = cams.mode === "split";
      if (want !== splitOn) {
        splitOn = want;
        engine.setSplit?.(want ? sv : null);
      }
      const lay = engine.splitLayout?.() ?? null;
      if (lay) {
        applySideProjection(sv.left.camera, lay, "left");
        applySideProjection(sv.right.camera, lay, "right");
      }
      // ribbon widths follow the view (a few px wide in the overview, a painted band close up)
      const hPx = engine.pickView().size[1];
      const dist = Math.hypot(
        cams.main.pos[0] - cams.main.look[0],
        cams.main.pos[1] - cams.main.look[1],
        cams.main.pos[2] - cams.main.look[2],
      );
      l.setMetresPerPixel(
        (2 * dist * Math.tan((cams.main.fovDeg * Math.PI) / 360)) / Math.max(1, hPx),
      );
      return { position: cams.main.pos, look: cams.main.look, fovDeg: cams.main.fovDeg };
    };
    const clock = () => {
      const s = useCompare.getState();
      return s.payload === c ? s.t : null;
    };
    engine.setCameraDriver?.(driver);
    engine.setDecorClock?.(clock);
    const unsub = useCompare.subscribe((s, prev) => {
      if (s.t !== prev.t || s.reduced !== prev.reduced) engine.requestRender();
    });

    // after each frame: the screen positions for the overlay and the hook
    let lastKey = "";
    const sidePoint = (
      lay: SplitLayout,
      side: "left" | "right",
      p: readonly [number, number, number],
    ): ScreenPoint | null => {
      const s = lay[side];
      const q = projectToScreen(sv[side].camera, p, [lay.renderW, lay.size[1]]);
      if (!q) return null;
      const x = s.vx + q.x;
      if (x < s.x || x > s.x + s.w || q.y < 0 || q.y > lay.size[1]) return null;
      return { x, y: q.y };
    };
    const offFrame = engine.onFrame(() => {
      const s = useCompare.getState();
      if (s.payload !== c) return;
      const a = l.anchors();
      const lay = engine.splitLayout?.() ?? null;
      let screen: CompareScreen;
      if (lay) {
        const pois: Record<string, ScreenPoint | null> = {};
        for (const [id, v] of Object.entries(a.pois))
          pois[id] = sidePoint(lay, v.side === "L" ? "left" : "right", v.p);
        screen = {
          walkers: {
            fastest: sidePoint(lay, "left", a.walkers.fastest),
            recommended: sidePoint(lay, "right", a.walkers.recommended),
          },
          pois,
          unchecked: a.unchecked ? sidePoint(lay, "right", a.unchecked) : null,
          routesBbox: null,
          cardTop: null,
          viewports: splitViewports(lay),
        };
      } else {
        const v = engine.pickView();
        const cam = v.camera;
        cam.updateMatrixWorld();
        const pt = (p: readonly [number, number, number]) => projectToScreen(cam, p, v.size);
        const pois: Record<string, ScreenPoint | null> = {};
        for (const [id, x] of Object.entries(a.pois)) pois[id] = pt(x.p);
        screen = {
          walkers: { fastest: pt(a.walkers.fastest), recommended: pt(a.walkers.recommended) },
          pois,
          unchecked: a.unchecked ? pt(a.unchecked) : null,
          routesBbox: screenBox(cam, l.routePoints(), v.size),
          cardTop: null,
          viewports: null,
        };
      }
      const k = keyOf(screen);
      if (k === lastKey) return;
      lastKey = k;
      s.setScreen(screen);
    });
    engine.requestRender();
    // dev builds: the layer for console inspection (QA and lane debugging), as devsim does
    const w = window as unknown as { __compareLayer?: CompareLayer };
    if (import.meta.env.DEV) w.__compareLayer = l;

    return () => {
      ro?.disconnect();
      host?.ownerDocument.removeEventListener("transitionend", staleArea, true);
      if (w.__compareLayer === l) delete w.__compareLayer;
      offFrame();
      unsub();
      if (splitOn) engine.setSplit?.(null);
      releaseSlots(engine, { driver, clock });
      engine.setDecor(COMPARE_SLOT, null);
      setLayer(null);
      const s = useCompare.getState();
      if (s.payload === c || s.payload === null) s.setScreen(null);
      engine.requestRender();
    };
  }, [engine, frame, playable, hostRef]);

  // Declared after the layer effect: on unmount React runs cleanups in declaration order, so the
  // layer (and the greeter's crowd renderer) is disposed before the kit it draws with.
  useEffect(() => () => kit?.dispose(), [kit]);

  return null;
}
