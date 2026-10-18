import * as THREE from "three";
import type { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { GAP_BANDS, GAP_CESIUM_DASH, type GapBand, parseGaps } from "../../../gaps/gapModel";
import { diffLines, WHATIF_STYLE } from "../../../whatif/whatifModel";
import { groupEdgesByStatus, type LonLat, lineFeatures } from "../../geo";
import { CESIUM_DASH, type EdgeStatus, ROUTE_STYLE, statusStyle } from "../../styles";
import type { LocalFrame } from "../frame";
import { lineToLocal, ROUTE_LIFT_M } from "../routeLine";
import { createLineBatch, dashFromCesium, type LineStyle } from "./lines";

/** GET /layers/access payload (a GeoJSON FeatureCollection), as the query returns it. */
export type AccessData = unknown;
/** GET /layers/gaps payload. */
export type GapsData = unknown;
export type WhatIf = { geojson: { type: string; features: unknown[] } };

export interface OverlayState {
  access: AccessData | null;
  /** The Access lens. Also gates the gap bands, which replace the status lines. */
  accessVisible: boolean;
  gaps: GapsData | null;
  /** `gapsActive(...)`: the gap bands replace the status lines while true. */
  gapsOn: boolean;
  route: GeoJSON.LineString | null;
  whatIf: WhatIf | null;
}

export interface OverlayLayer {
  group: THREE.Group;
  update(state: OverlayState): void;
  /** Line2 widths are in pixels: the engine passes the viewport on every resize. */
  setResolution(w: number, h: number): void;
  dispose(): void;
}

/** Overlay pass order: above the ground bands (1-5) and lamp pools / cloud shadows (6-7). */
export const ORDER = { status: 10, gaps: 11, whatIf: 12, route: 13 } as const;
/** Metres each overlay floats above the ground. */
export const LIFT = { status: 0.4, gaps: 0.4, whatIf: 0.5, route: ROUTE_LIFT_M } as const;

type Coords = number[][];
const local = (c: Coords, f: LocalFrame, lift: number) => lineToLocal(c as LonLat[], f, lift);

export function createOverlayLayer(frame: LocalFrame): OverlayLayer {
  const group = new THREE.Group();
  group.name = "overlays";
  const status = new THREE.Group();
  const gapsGroup = new THREE.Group();
  const whatIfGroup = new THREE.Group();
  const routeGroup = new THREE.Group();
  group.add(status, gapsGroup, whatIfGroup, routeGroup);
  let res: [number, number] = [1, 1];
  let last: Partial<OverlayState> = {};

  const fill = (into: THREE.Group, batches: THREE.Object3D[]) => {
    drop(into);
    for (const b of batches) {
      ((b as THREE.Mesh).material as LineMaterial).resolution.set(res[0], res[1]);
      into.add(b);
    }
  };

  function update(s: OverlayState) {
    const accessChanged = s.access !== last.access;
    if (accessChanged) fill(status, s.access ? statusBatches(s.access, frame) : []);
    if (s.gaps !== last.gaps) fill(gapsGroup, s.gaps ? gapBatches(s.gaps, frame) : []);
    if (s.whatIf !== last.whatIf) fill(whatIfGroup, s.whatIf ? whatIfBatches(s.whatIf, frame) : []);
    if (s.route !== last.route) fill(routeGroup, s.route ? routeBatches(s.route, frame) : []);
    status.visible = s.accessVisible && !s.gapsOn;
    gapsGroup.visible = s.accessVisible && s.gapsOn;
    last = s;
  }

  return {
    group,
    update,
    setResolution(w, h) {
      res = [w, h];
      group.traverse((o) => {
        const m = (o as THREE.Mesh).material as LineMaterial | undefined;
        if (m?.resolution) m.resolution.set(w, h);
      });
    },
    dispose() {
      for (const g of [status, gapsGroup, whatIfGroup, routeGroup]) drop(g);
      group.removeFromParent();
    },
  };
}

function drop(g: THREE.Group) {
  for (const o of [...g.children]) {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    (m.material as THREE.Material | undefined)?.dispose();
    g.remove(o);
  }
}

function statusStyleOf(st: EdgeStatus): LineStyle {
  const s = statusStyle(st);
  const d = CESIUM_DASH[st];
  return {
    color: s.color,
    widthPx: s.width,
    opacity: s.alpha,
    dash: d ? dashFromCesium(d) : undefined,
  };
}

function statusBatches(access: AccessData, f: LocalFrame): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const [st, edges] of groupEdgesByStatus(lineFeatures(access)))
    out.push(
      createLineBatch(
        edges.map((e) => local(e.coords, f, LIFT.status)),
        statusStyleOf(st),
        LIFT.status,
        ORDER.status,
      ),
    );
  return out;
}

function gapBatches(gaps: GapsData, f: LocalFrame): THREE.Object3D[] {
  const by = new Map<GapBand, Float32Array[]>();
  for (const i of parseGaps(gaps)) {
    if (i.kind !== "segment" || !i.band || i.coords.length < 2) continue;
    by.set(i.band, [...(by.get(i.band) ?? []), local(i.coords, f, LIFT.gaps)]);
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
        lines[side].map((c) => local(c, f, LIFT.whatIf)),
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
  const line = local(route.coordinates as Coords, f, LIFT.route);
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
