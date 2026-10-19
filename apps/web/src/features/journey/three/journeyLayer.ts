import * as THREE from "three";
import type { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { CESIUM_DASH, JOURNEY_RIBBON_STYLE, statusStyle } from "../../scene/styles";
import type { LocalFrame } from "../../scene/three/frame";
import {
  createLineBatch,
  dashFromCesium,
  type LineStyle,
  setDashScale,
} from "../../scene/three/overlays/lines";
import { KIND_COLOUR, KIND_GLYPH } from "../kindStyle";
import { createRoutePath, type RoutePath, type SpanEval } from "../routePath";
import type { JourneyEventKind, JourneyPlan } from "../timeline";

/** Metres the ribbon floats above the ground (under the 0.6 m status lines, above road decals). */
export const RIBBON_LIFT_M = 0.3;
/** Ribbon width on screen, CSS px (status lines are 2-5 px; the trip's own route reads above them). */
export const RIBBON_WIDTH_PX = 7;
/**
 * The ribbon is a world-unit line (LineMaterial `worldUnits`), whose fragments get a ray-traced
 * depth: in screen-pixel mode the depth test against the ground rejected all but a 1-2 px core
 * (browser check, D-T7). Its width in metres follows the view (`setMetresPerPixel`) so it reads as
 * about RIBBON_WIDTH_PX at any range, clamped: a painted strip next to the hero, capped in overview.
 */
export const RIBBON_WIDTH_M = { min: 0.8, max: 6 } as const;
/**
 * A white casing under the ribbon, this many times its width: the trip ribbon reads as a cased
 * band, distinct from the thin status lines drawn over it when Path status is on.
 */
export const RIBBON_CASING_SCALE = 1.6;
const CASING_COLOUR = JOURNEY_RIBBON_STYLE.casing;
/**
 * Opacity of the ribbon where something hides it (drawn with depthFunc Greater). Any occluder
 * counts (buildings, trees, the hero): restricting it to buildings would need every building
 * material to write a stencil bit, which is not worth it for a 35 % hint.
 */
export const RIBBON_GHOST_OPACITY = 0.35;
/** Marker height above the event's route point (prototype: 5 m), and the stack step per same-metre event. */
export const MARKER_LIFT_M = 5;
export const MARKER_STACK_M = 1.6;
/** Marker size as a fraction of the view (sizeAttenuation off: the same pixel size at any range). */
export const MARKER_SCALE = { rest: 0.045, active: 0.06 } as const;
/** Render order of the solid ribbon (its casing is one below, its ghost one above). */
export const RIBBON_ORDER = 20;

const RIBBON_STYLE: Record<SpanEval, LineStyle> = {
  PASS: { color: statusStyle("ok").color, widthPx: RIBBON_WIDTH_PX },
  UNKNOWN: {
    color: statusStyle("unknown").color,
    widthPx: RIBBON_WIDTH_PX,
    dash: dashFromCesium(CESIUM_DASH.unknown as { dashLength: number; dashPattern: number }),
  },
  FAIL: {
    color: statusStyle("blocked").color,
    widthPx: RIBBON_WIDTH_PX,
    dash: dashFromCesium(CESIUM_DASH.blocked as { dashLength: number; dashPattern: number }),
  },
};

/**
 * What the engine needs from the journey layer (`Engine.setJourney`): the ribbon goes into the main
 * scene (depth-tested against buildings and the hero, left out of the AO G-buffer), the markers into
 * a separate scene the engine renders after post-processing.
 */
export interface JourneyLayer {
  /** Route ribbon: PASS solid green, UNKNOWN amber dashes; independent of the status-line layer. */
  ribbon: THREE.Group;
  /** Event markers: a scene of their own, never passed to the composer. */
  markers: THREE.Scene;
  path: RoutePath;
  /** Marker world position of plan event `i` (the card anchor); null for an unknown index. */
  anchorOf(i: number): [number, number, number] | null;
  setActive(i: number | null): void;
  setResolution(w: number, h: number): void;
  setMetresPerPixel(mpp: number): void;
  dispose(): void;
}

/** A pin texture (prototype `markerTexture`) where a 2D canvas exists; null in tests (colour only). */
function pinTexture(kind: JourneyEventKind): THREE.Texture | null {
  if (typeof document === "undefined" || /jsdom/i.test(globalThis.navigator?.userAgent ?? ""))
    return null;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const x = c.getContext("2d");
  if (!x) return null;
  const col = KIND_COLOUR[kind];
  x.fillStyle = col;
  x.beginPath();
  x.arc(64, 50, 42, 0, Math.PI * 2);
  x.fill();
  x.beginPath();
  x.moveTo(42, 80);
  x.lineTo(64, 113);
  x.lineTo(86, 80);
  x.fill();
  x.fillStyle = JOURNEY_RIBBON_STYLE.pinFace;
  x.beginPath();
  x.arc(64, 50, 33, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = col;
  x.font = "800 46px Nunito, 'Segoe UI', sans-serif";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(KIND_GLYPH[kind], 64, 53);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createJourneyLayer(plan: JourneyPlan, frame: LocalFrame): JourneyLayer {
  const path = createRoutePath(plan, (lon, lat) => frame.toLocal(lon, lat));

  const ribbon = new THREE.Group();
  ribbon.name = "journey-ribbon";
  for (const run of path.spanLines()) {
    const style = RIBBON_STYLE[run.eval];
    // Casing first (lower render order): a wider white solid line under the coloured one.
    const casing = createLineBatch(
      [run.points],
      { color: CASING_COLOUR, widthPx: RIBBON_WIDTH_PX * RIBBON_CASING_SCALE },
      RIBBON_LIFT_M,
      RIBBON_ORDER - 1,
    );
    const cm = (casing as THREE.Mesh).material as LineMaterial;
    cm.worldUnits = true;
    cm.depthTest = true;
    cm.depthWrite = false;
    casing.userData = { ...casing.userData, ribbon: "casing", eval: run.eval };
    ribbon.add(casing);
    // Where visible: depth-tested, so buildings and the hero cover it like any ground paint.
    const solid = createLineBatch([run.points], style, RIBBON_LIFT_M, RIBBON_ORDER);
    const sm = (solid as THREE.Mesh).material as LineMaterial;
    sm.worldUnits = true;
    sm.depthTest = true;
    sm.depthWrite = false;
    solid.userData = { ...solid.userData, ribbon: "solid", eval: run.eval };
    // Where a building hides it: a faint copy that draws only behind the depth buffer.
    const ghost = createLineBatch(
      [run.points],
      { ...style, opacity: RIBBON_GHOST_OPACITY },
      RIBBON_LIFT_M,
      RIBBON_ORDER + 1,
    );
    const gm = (ghost as THREE.Mesh).material as LineMaterial;
    gm.worldUnits = true;
    gm.depthTest = true;
    gm.depthWrite = false;
    gm.depthFunc = THREE.GreaterDepth;
    ghost.userData = { ...ghost.userData, ribbon: "ghost", eval: run.eval };
    ribbon.add(solid, ghost);
  }

  const markers = new THREE.Scene();
  markers.name = "journey-markers";
  const anchors: [number, number, number][] = [];
  const textures: THREE.Texture[] = [];
  plan.events.forEach((e, i) => {
    const [x, z] = path.pointAt(e.at_m);
    const stacked = plan.events.filter((f, j) => j < i && Math.abs(f.at_m - e.at_m) < 3).length;
    const y = MARKER_LIFT_M + stacked * MARKER_STACK_M;
    anchors.push([x, y, z]);
    const map = pinTexture(e.kind);
    if (map) textures.push(map);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map,
        color: map ? JOURNEY_RIBBON_STYLE.pinFace : KIND_COLOUR[e.kind],
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        sizeAttenuation: false,
      }),
    );
    sprite.position.set(x, y, z);
    sprite.scale.setScalar(MARKER_SCALE.rest);
    sprite.renderOrder = i;
    sprite.userData = { eventIndex: i, kind: e.kind };
    markers.add(sprite);
  });

  let res: [number, number] = [1, 1];
  return {
    ribbon,
    markers,
    path,
    anchorOf: (i) => anchors[i] ?? null,
    setActive(i) {
      markers.children.forEach((s, j) => {
        s.scale.setScalar(j === i ? MARKER_SCALE.active : MARKER_SCALE.rest);
      });
    },
    setResolution(w, h) {
      res = [w, h];
      for (const o of ribbon.children)
        ((o as THREE.Mesh).material as LineMaterial).resolution.set(res[0], res[1]);
    },
    setMetresPerPixel(mpp) {
      const w = Math.min(RIBBON_WIDTH_M.max, Math.max(RIBBON_WIDTH_M.min, mpp * RIBBON_WIDTH_PX));
      for (const o of ribbon.children) {
        setDashScale(o, mpp);
        ((o as THREE.Mesh).material as LineMaterial).linewidth =
          o.userData.ribbon === "casing" ? w * RIBBON_CASING_SCALE : w;
      }
    },
    dispose() {
      for (const o of ribbon.children) {
        const m = o as THREE.Mesh;
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      for (const s of markers.children as THREE.Sprite[]) s.material.dispose();
      for (const t of textures) t.dispose();
    },
  };
}
