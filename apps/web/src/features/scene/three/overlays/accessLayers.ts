import * as THREE from "three";
import type { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { GAP_BANDS, GAP_CESIUM_DASH, type GapBand, parseGaps } from "../../../gaps/gapModel";
import { diffLines, WHATIF_STYLE } from "../../../whatif/whatifModel";
import { groupEdgesByStatus, type LonLat, lineFeatures, pointFeatures } from "../../geo";
import { ROUTE_STYLE } from "../../styles";
import type { LocalFrame } from "../frame";
import { type Boundary, insideBoundary } from "../ground/boundary";
import { lineToLocal, ROUTE_LIFT_M } from "../routeLine";
import { createFloodLayer } from "./floodLayer";
import { createLineBatch, dashFromCesium, setDashScale, statusLineStyle } from "./lines";
import { createMarkers, type EvacMarkerRow, type Markers } from "./markers";

/** GET /layers/access payload (a GeoJSON FeatureCollection), as the query returns it. */
export type AccessData = unknown;
/** GET /layers/gaps payload. */
export type GapsData = unknown;
export type WhatIf = { geojson: { type: string; features: unknown[] } };

export interface OverlayState {
  access: AccessData | null;
  /** The Access lens. Also gates the gap bands, which replace the status lines. */
  accessVisible: boolean;
  /** The "Path status" setting: the per-edge status lines exist only while true. */
  pathStatus: boolean;
  gaps: GapsData | null;
  /** `gapsActive(...)`: the gap bands replace the status lines while true. */
  gapsOn: boolean;
  route: GeoJSON.LineString | null;
  whatIf: WhatIf | null;
  /** GET /scenarios/{id}: the draped water polygons. Drawn only while `floodOn`. */
  water?: unknown;
  /** GET /layers/flood: the flooded edges (flooded_likely, flooded_possible). */
  floodEdges?: unknown;
  /** A scenario is chosen and the flood lens is on. Also gates the evacuation centres. */
  floodOn?: boolean;
  /** GET /layers/waste (points) and the waste lens. */
  waste?: unknown;
  wasteOn?: boolean;
  evac?: readonly EvacMarkerRow[] | null;
  focusPlaceId?: string | null;
  /** The Elmina outline (display only): place markers outside it are not drawn (A-T5 fix round 1). */
  boundary?: Boundary | null;
}

export interface OverlayLayer {
  /** Overlay scene: markers, residents and attached batches (no depth, drawn on top). */
  group: THREE.Group;
  /**
   * MAIN scene: every line batch (status, gaps, what-if, route, flood edges). They must depth-test
   * against buildings (AC-A2), and the overlay pass renders into a buffer without the scene's
   * depth, so the lines draw in the main pass at renderOrder >= 10 (after the ground bands).
   * The engine adds and AO-skips it.
   */
  lineGroup: THREE.Group;
  /** MAIN scene: the flood tint, depth tested so buildings occlude it. The engine adds and AO-skips it. */
  groundGroup: THREE.Group;
  update(state: OverlayState): void;
  /** Dashes are screen-constant: the engine passes the metres per pixel at the camera target. */
  setMetresPerPixel(mpp: number): void;
  /** True when a marker or attached batch would draw (the engine skips the overlay pass otherwise). */
  hasVisible(): boolean;
  /** Line2 widths are in pixels: the engine passes the viewport on every resize. */
  setResolution(w: number, h: number): void;
  /** The renderer's pixel ratio (point markers are sized in device pixels). */
  setPixelRatio(pr: number): void;
  /** Camera position and vertical fov (degrees): marker labels show near the camera only. */
  setView(cam: { x: number; y: number; z: number }, fovDeg: number): void;
  /**
   * Adds a batch of its own to the overlay pass (e.g. the Day residents). The layer forwards the
   * camera and clock each frame, counts it in hasVisible and disposes it. Returns the detach.
   */
  attach(child: OverlayChild): () => void;
  dispose(): void;
}

/** A batch the overlay layer draws and feeds the per-frame view. */
export interface OverlayChild {
  group: THREE.Group;
  /** Camera position, clock, and the camera's live vertical fov (deg; it widens at long range, A-T5). */
  setView?(cam: { x: number; y: number; z: number }, nowMs: number, fovDeg?: number): void;
  /** Canvas size in the same (CSS) pixels as the layer's `setResolution`. */
  setResolution?(w: number, h: number): void;
  dispose(): void;
}

/** Overlay pass order: above the ground bands (1-5) and lamp pools / cloud shadows (6-7). */
export const ORDER = { status: 10, gaps: 11, whatIf: 12, route: 13 } as const;
/** Metres each overlay floats above the ground. */
export const LIFT = { status: 0.4, gaps: 0.4, whatIf: 0.5, route: ROUTE_LIFT_M } as const;

type Coords = number[][];
/** Lon/lat to local xyz; createLineBatch sets Y to the batch lift, so none is applied here. */
const local = (c: Coords, f: LocalFrame) => lineToLocal(c as LonLat[], f, 0);

export function createOverlayLayer(frame: LocalFrame): OverlayLayer {
  const group = new THREE.Group();
  group.name = "overlays";
  const status = new THREE.Group();
  const gapsGroup = new THREE.Group();
  const whatIfGroup = new THREE.Group();
  const routeGroup = new THREE.Group();
  const floodGroup = new THREE.Group();
  const groundGroup = new THREE.Group();
  groundGroup.name = "flood-ground-slot";
  let pixelRatio = 1;
  const markerGroup = new THREE.Group();
  const lineGroup = new THREE.Group();
  lineGroup.name = "overlay-lines";
  lineGroup.add(floodGroup, status, gapsGroup, whatIfGroup, routeGroup);
  group.add(markerGroup);
  let flood: { dispose(): void } | null = null;
  let markers: Markers | null = null;
  let markerKey: unknown[] | null = null;
  let cam: { x: number; y: number; z: number } | null = null;
  let fov = 40;
  let res: [number, number] = [1, 1];
  let resSet = false;
  let mpp = 1;
  let last: Partial<OverlayState> = {};
  const children = new Set<OverlayChild>();

  const fill = (into: THREE.Group, batches: THREE.Object3D[]) => {
    drop(into);
    for (const b of batches) {
      ((b as THREE.Mesh).material as LineMaterial).resolution.set(res[0], res[1]);
      setDashScale(b, mpp);
      into.add(b);
    }
  };

  function update(s: OverlayState) {
    const statusSrc = s.pathStatus ? s.access : null;
    if (statusSrc !== (last.pathStatus ? last.access : null))
      fill(status, statusSrc ? statusBatches(statusSrc, frame) : []);
    if (s.gaps !== last.gaps) fill(gapsGroup, s.gaps ? gapBatches(s.gaps, frame) : []);
    if (s.whatIf !== last.whatIf) fill(whatIfGroup, s.whatIf ? whatIfBatches(s.whatIf, frame) : []);
    if (s.route !== last.route) fill(routeGroup, s.route ? routeBatches(s.route, frame) : []);
    status.visible = s.accessVisible && !s.gapsOn;
    gapsGroup.visible = s.accessVisible && s.gapsOn;
    updateFlood(s);
    updateMarkers(s);
    last = s;
  }

  /** Scenario water and flood edges: rebuilt only when their inputs change, shown by the lens. */
  function updateFlood(s: OverlayState) {
    if (s.water !== last.water || s.floodEdges !== last.floodEdges) {
      flood?.dispose();
      flood = null;
      floodGroup.clear();
      groundGroup.clear();
      if (s.water || s.floodEdges) {
        const f = createFloodLayer(s.water, s.floodEdges, frame);
        flood = f;
        f.group.traverse((o) => {
          ((o as THREE.Mesh).material as LineMaterial | undefined)?.resolution?.set(res[0], res[1]);
          setDashScale(o, mpp);
        });
        floodGroup.add(f.group);
        groundGroup.add(f.ground);
      }
    }
    floodGroup.visible = !!s.floodOn;
    groundGroup.visible = !!s.floodOn;
  }

  /** Place, waste and evacuation markers: one rebuild when their inputs or lenses change. */
  function updateMarkers(s: OverlayState) {
    const places = s.accessVisible ? s.access : null;
    const waste = s.wasteOn ? s.waste : null;
    const evac = s.floodOn ? (s.evac ?? null) : null;
    const b = s.boundary ?? null;
    const key = [places, waste, evac, b];
    if (!markerKey || key.some((k, i) => k !== markerKey?.[i])) {
      markerKey = key;
      markers?.dispose();
      markers = null;
      markerGroup.clear();
      if (places || waste || evac) {
        markers = createMarkers(
          {
            places: places ? pointFeatures(places) : [],
            waste: waste ? pointFeatures(waste) : [],
            evac: evac ?? [],
            placeInside: b ? (x, z) => insideBoundary(b, x, z) : undefined,
          },
          frame,
        );
        markerGroup.add(markers.group);
        markers.setPixelRatio(pixelRatio);
        if (cam) markers.setView(cam, fov, res[1]);
      }
    }
    markers?.setFocus(s.focusPlaceId ?? null);
  }

  return {
    group,
    lineGroup,
    groundGroup,
    update,
    setMetresPerPixel(m) {
      if (!(m > 0) || !Number.isFinite(m)) return;
      mpp = m;
      for (const g of [group, lineGroup]) g.traverse((o) => setDashScale(o, m));
    },
    hasVisible() {
      // Lines draw in the main pass (lineGroup): only markers and attached batches need the overlay pass.
      const own = [markerGroup];
      return [...own, ...[...children].map((c) => c.group)].some(drawable);
    },
    setResolution(w, h) {
      res = [w, h];
      resSet = true;
      for (const ch of children) ch.setResolution?.(w, h);
      if (cam) markers?.setView(cam, fov, h);
      for (const g of [group, lineGroup])
        g.traverse((o) => {
          const m = (o as THREE.Mesh).material as LineMaterial | undefined;
          if (m?.resolution) m.resolution.set(w, h);
        });
    },
    setPixelRatio(pr) {
      pixelRatio = pr;
      markers?.setPixelRatio(pr);
    },
    attach(child) {
      children.add(child);
      group.add(child.group);
      if (resSet) child.setResolution?.(res[0], res[1]);
      if (cam) child.setView?.(cam, performance.now());
      return () => {
        if (!children.delete(child)) return;
        child.group.removeFromParent();
        child.dispose();
      };
    },
    setView(c, fovDeg) {
      // Attached batches also follow the clock, so they are fed before the camera-moved early return.
      for (const ch of children) ch.setView?.(c, performance.now(), fovDeg);
      // The engine calls this every frame: relabel only when the camera moved.
      if (cam && cam.x === c.x && cam.y === c.y && cam.z === c.z && fov === fovDeg) return;
      cam = { x: c.x, y: c.y, z: c.z };
      fov = fovDeg;
      markers?.setView(c, fovDeg, res[1]);
    },
    dispose() {
      flood?.dispose();
      markers?.dispose();
      flood = markers = null;
      for (const ch of children) ch.dispose();
      children.clear();
      floodGroup.clear();
      groundGroup.clear();
      groundGroup.removeFromParent();
      markerGroup.clear();
      for (const g of [status, gapsGroup, whatIfGroup, routeGroup]) drop(g);
      group.removeFromParent();
      lineGroup.removeFromParent();
    },
  };
}

/** True when the group is visible and holds something that draws (mesh, line, points, sprite). */
function drawable(g: THREE.Object3D): boolean {
  if (!g.visible) return false;
  const o = g as THREE.Mesh;
  if (o.isMesh || (g as THREE.Points).isPoints || (g as THREE.Sprite).isSprite) return true;
  return g.children.some(drawable);
}

function drop(g: THREE.Group) {
  for (const o of [...g.children]) {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    (m.material as THREE.Material | undefined)?.dispose();
    g.remove(o);
  }
}

function statusBatches(access: AccessData, f: LocalFrame): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const [st, edges] of groupEdgesByStatus(lineFeatures(access)))
    out.push(
      createLineBatch(
        edges.map((e) => local(e.coords, f)),
        statusLineStyle(st),
        LIFT.status,
        ORDER.status,
        undefined,
        true,
      ),
    );
  return out;
}

function gapBatches(gaps: GapsData, f: LocalFrame): THREE.Object3D[] {
  const by = new Map<GapBand, Float32Array[]>();
  for (const i of parseGaps(gaps)) {
    if (i.kind !== "segment" || !i.band || i.coords.length < 2) continue;
    by.set(i.band, [...(by.get(i.band) ?? []), local(i.coords, f)]);
  }
  return [...by].map(([band, lines]) => {
    const b = GAP_BANDS[band];
    const d = GAP_CESIUM_DASH[band];
    return createLineBatch(
      lines,
      {
        color: b.color,
        widthPx: b.width,
        opacity: b.alpha,
        dash: d ? dashFromCesium(d) : undefined,
      },
      LIFT.gaps,
      ORDER.gaps,
    );
  });
}

function whatIfBatches(w: WhatIf, f: LocalFrame): THREE.Object3D[] {
  const lines = diffLines(w.geojson as never);
  return (["before", "after", "touched"] as const)
    .filter((side) => lines[side].length > 0)
    .map((side) =>
      createLineBatch(
        lines[side].map((c) => local(c, f)),
        {
          color: WHATIF_STYLE[side].color,
          widthPx: WHATIF_STYLE[side].width,
          // Cesium's PolylineDash default mask (0x00ff) over 16 px: today's lines read as past.
          dash: side === "before" ? { sizePx: 16, pattern: 0x00ff } : undefined,
        },
        LIFT.whatIf,
        ORDER.whatIf,
      ),
    );
}

function routeBatches(route: GeoJSON.LineString, f: LocalFrame): THREE.Object3D[] {
  const line = local(route.coordinates as Coords, f);
  if (line.length < 6) return [];
  return [
    createLineBatch(
      [line],
      { color: ROUTE_STYLE.color, widthPx: ROUTE_STYLE.width },
      LIFT.route,
      ORDER.route,
    ),
  ];
}
