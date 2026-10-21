import * as THREE from "three";
import { centreMapMarker } from "../../../../lib/routeStatus";
import { IMPACT_STYLE, type ImpactMarker } from "../../../flood/impactModel";
import type { LonLat } from "../../geo";
import type { LocalFrame } from "../frame";

/** Labels show only this close to the camera, unless their marker is focused. */
export const LABEL_RANGE_M = 1500;
/** At most this many label sprites draw at once (focused first, then nearest): a draw call each. */
export const MAX_LABELS = 12;
/** Overlay pass orders: above the route (13) so a marker is never hidden under a line. */
export const MARKER_ORDER = { points: 14, labels: 15 } as const;
const OUTLINE_PX = 2;
const LABEL_PX = 22;
const LABEL_H = 24;
const LIFT_M = 0.6;

export const MARKER_STYLE = {
  place: { color: "#0f5c63", px: 9, focusPx: 16 },
  waste: { color: "#6B46C1", px: 9 },
  evac: { px: 12 },
  /** T-024 flood impact: "!" likely flooded, "⚠" cut off (colours in IMPACT_STYLE). */
  impact: { px: 11 },
} as const;

type Kind = "place" | "waste" | "evac" | "impact";

export interface MarkerPoint {
  id: string;
  name: string;
  coord: LonLat;
}
export interface EvacMarkerRow {
  centre: { id: string; name: string; coord: readonly number[] };
  reachable: boolean;
  route_status: string;
}
export interface MarkerInput {
  /** Place markers (the access layer's points). */
  places: readonly MarkerPoint[];
  /**
   * Display only (A-T5): when given, a place marker is drawn only if this returns true for its id
   * and point (local x, z); see `placeShown`. Hidden places stay in the data, the list view and
   * the answers.
   */
  placeShown?: (id: string, x: number, z: number) => boolean;
  waste: readonly MarkerPoint[];
  evac: readonly EvacMarkerRow[];
  /** Places the river scenario marks likely flooded or cut off (`GET /scenarios/{id}/affected`). */
  impact?: readonly ImpactMarker[];
}
export interface MarkerView {
  x: number;
  y: number;
  z: number;
}
export interface Markers {
  group: THREE.Group;
  /** Place markers drawn (after the outline rule): what `data-markers` reports. */
  readonly placeCount: number;
  /** Focus a marker: a place grows to 16 px; any focused marker shows its label. */
  setFocus(id: string | null): void;
  /** Camera position, vertical fov (degrees) and viewport height (px): picks and sizes the labels. */
  setView(cam: MarkerView, fovDeg: number, heightPx: number): void;
  /** The renderer's pixel ratio: gl_PointSize is in device pixels, markers are specified in CSS px. */
  setPixelRatio(pr: number): void;
  dispose(): void;
}

/** Place markers within this distance (m) of a shown route's or journey's end are never hidden. */
export const ENDPOINT_KEEP_M = 60;

export interface PlaceShowRule {
  /** Place markers outside it are hidden (display only), unless kept below. Null: show all. */
  inside: ((x: number, z: number) => boolean) | null;
  /** Never hidden: the focused and selected place, and places a verification request targets. */
  keepIds: ReadonlySet<string>;
  /** Never hidden near these points (local x, z): the current route's and journey's ends. */
  keepNear: readonly (readonly [number, number])[];
  /**
   * A trip is loaded (gate §9.1 F5): only kept places are drawn (its ends, its event places, the
   * selected / focused place, VR targets); the general place dots step aside until it clears.
   */
  tripOnly?: boolean;
}

/**
 * The place-marker display rule (A-T5 fix round 2): a marker floating over the void past the slab
 * is hidden, but never one the user is being shown (focused or selected place, a route or journey
 * end, a verification-request target). Undefined (show all) without an outline. While a trip is
 * loaded (`tripOnly`) only those kept places are drawn. Pure.
 */
export function placeShown(
  rule: PlaceShowRule,
): ((id: string, x: number, z: number) => boolean) | undefined {
  const { inside, keepIds, keepNear, tripOnly } = rule;
  const kept = (id: string, x: number, z: number) =>
    keepIds.has(id) || keepNear.some(([px, pz]) => Math.hypot(px - x, pz - z) <= ENDPOINT_KEEP_M);
  if (tripOnly) return kept;
  if (!inside) return undefined;
  return (id, x, z) => inside(x, z) || kept(id, x, z);
}

/** The id of the marker at `index` in a batched Points (the pick's `hit.index`), else null. */
export function markerIdAt(obj: THREE.Object3D, index: number): string | null {
  const ids = obj.userData.ids as string[] | undefined;
  return ids?.[index] ?? null;
}

/** Device pixels of the marker's fill disc (CSS px size times the pixel ratio). */
export function deviceFillPx(p: THREE.Points): number {
  const u = (p.material as THREE.ShaderMaterial).uniforms;
  return (u.uSize?.value as number) * (u.uPixelRatio?.value as number);
}

const OUT = (OUTLINE_PX * 2).toFixed(1);
const VERT = /* glsl */ `
uniform float uSize;
uniform float uPixelRatio;
void main() {
  gl_PointSize = (uSize + ${OUT}) * uPixelRatio;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
/** A disc of `uSize` px with a 2 px white outline, antialiased; the size never changes with depth. */
const FRAG = /* glsl */ `
uniform float uSize;
uniform float uPixelRatio;
uniform vec3 uColor;
void main() {
  float total = (uSize + ${OUT}) * uPixelRatio;
  float r = length(gl_PointCoord - 0.5) * total;
  float a = 1.0 - smoothstep(total * 0.5 - uPixelRatio, total * 0.5, r);
  if (a <= 0.0) discard;
  float fill = uSize * uPixelRatio * 0.5;
  vec3 c = mix(uColor, vec3(1.0), smoothstep(fill - uPixelRatio, fill, r));
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}`;

type Item = { id: string; x: number; z: number };

/**
 * One marker point with the markers' shader, for precompiling its program (`Engine` compiles it at
 * start-up, so the first markers of an answer never link on the main thread). Never drawn.
 */
export function markerProgramStandIn(): THREE.Points {
  return pointsOf("place" as Kind, [{ id: "", x: 0, z: 0 }], 9, "#0f5c63", 1);
}

function pointsOf(kind: Kind, items: Item[], px: number, color: string, pr: number): THREE.Points {
  const pos = new Float32Array(items.length * 3);
  items.forEach((it, i) => {
    pos.set([it.x, LIFT_M, it.z], i * 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSize: { value: px },
      uPixelRatio: { value: pr },
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const p = new THREE.Points(g, mat);
  p.renderOrder = MARKER_ORDER.points;
  p.frustumCulled = false;
  p.name = `markers-${kind}`;
  // Data, not decoration: the shared picker names the id by hit index (`markerIdAt`).
  p.userData.pick = { kind };
  p.userData.ids = items.map((i) => i.id);
  return p;
}

interface Label {
  /** `${kind}:${id}`: two kinds may share an id. */
  key: string;
  id: string;
  kind: Kind;
  text: string;
  x: number;
  z: number;
}

const NOOP = () => {};

/**
 * Screen-space data markers, batched per kind and colour (one draw call each, not one per place):
 * places #0f5c63 9 px (a focused one 16 px), waste #6B46C1 9 px, evacuation centres 12 px in the
 * `centreMapMarker` colour, so an OSM candidate never looks official. All carry a 2 px white
 * outline. Labels are Sprites (constant pixel height), shown for evacuation and waste points within
 * 1500 m of the camera and for the focused marker; at most 12 draw at once.
 */
export function createMarkers(
  input: MarkerInput,
  frame: LocalFrame,
  makeCanvas: () => HTMLCanvasElement = () => document.createElement("canvas"),
): Markers {
  const group = new THREE.Group();
  group.name = "markers";
  const item = (m: { id: string; coord: readonly number[] }): Item => {
    const [x, z] = frame.toLocal(m.coord[0] as number, m.coord[1] as number);
    return { id: m.id, x, z };
  };

  const labels: Label[] = [];
  const shown = input.placeShown;
  const shownPlaces = input.places
    .map((p) => ({ p, it: item(p) }))
    .filter(({ p, it }) => !shown || shown(p.id, it.x, it.z));
  const placeItems = shownPlaces.map(({ it }) => it);
  if (placeItems.length)
    group.add(pointsOf("place", placeItems, MARKER_STYLE.place.px, MARKER_STYLE.place.color, 1));
  shownPlaces.forEach(({ p }, i) => {
    const it = placeItems[i] as Item;
    labels.push({ key: `place:${p.id}`, id: p.id, kind: "place", text: p.name, x: it.x, z: it.z });
  });

  const wasteItems = input.waste.map(item);
  if (wasteItems.length)
    group.add(pointsOf("waste", wasteItems, MARKER_STYLE.waste.px, MARKER_STYLE.waste.color, 1));
  input.waste.forEach((p, i) => {
    const it = wasteItems[i] as Item;
    labels.push({
      key: `waste:${p.id}`,
      id: p.id,
      kind: "waste",
      text: `Waste point: ${p.name}`,
      x: it.x,
      z: it.z,
    });
  });

  const byColour = new Map<string, Item[]>();
  for (const r of input.evac) {
    const mk = centreMapMarker(r);
    const it = item({ id: r.centre.id, coord: r.centre.coord });
    byColour.set(mk.color, [...(byColour.get(mk.color) ?? []), it]);
    labels.push({
      key: `evac:${r.centre.id}`,
      id: r.centre.id,
      kind: "evac",
      text: `${r.centre.name}: ${mk.text}`,
      x: it.x,
      z: it.z,
    });
  }
  for (const [color, items] of byColour)
    group.add(pointsOf("evac", items, MARKER_STYLE.evac.px, color, 1));

  for (const kind of ["flooded", "cut_off"] as const) {
    const rows = (input.impact ?? []).filter((m) => m.kind === kind);
    const items = rows.map(item);
    if (items.length)
      group.add(pointsOf("impact", items, MARKER_STYLE.impact.px, IMPACT_STYLE[kind].color, 1));
    rows.forEach((m, i) => {
      const it = items[i] as Item;
      labels.push({
        key: `impact:${kind}:${m.id}`,
        id: m.id,
        kind: "impact",
        text: `${IMPACT_STYLE[kind].glyph} ${m.name}`,
        x: it.x,
        z: it.z,
      });
    });
  }

  let pixelRatio = 1;
  let focusId: string | null = null;
  let focusPoint: THREE.Points | null = null;
  let view: { cam: MarkerView; fov: number; h: number } | null = null;
  const sprites = new Map<string, THREE.Sprite>();
  const disposables: { dispose(): void }[] = [];

  function labelSprite(l: Label): THREE.Sprite {
    const canvas = makeCanvas();
    const ctx = canvas.getContext("2d");
    const font = l.kind === "place" ? "600 15px sans-serif" : "600 14px sans-serif";
    if (ctx) {
      ctx.font = font;
      const w = Math.ceil(ctx.measureText(l.text).width) + 12;
      canvas.width = w;
      canvas.height = LABEL_H;
      ctx.font = font; // resizing a canvas resets its state
      ctx.fillStyle = l.kind === "place" ? "#0a4349" : "rgba(255,255,255,0.9)";
      ctx.fillRect(0, 0, w, LABEL_H);
      ctx.fillStyle = l.kind === "place" ? "#ffffff" : "#000000";
      ctx.textBaseline = "middle";
      ctx.fillText(l.text, 6, LABEL_H / 2 + 1);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      sizeAttenuation: false,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      // Overlay colours go through the composer's OutputPass tone mapping (ruling: accepted for P3).
    });
    const s = new THREE.Sprite(mat);
    s.center.set(0.5, -0.6); // the label floats above its marker
    s.position.set(l.x, LIFT_M, l.z);
    s.renderOrder = MARKER_ORDER.labels;
    s.raycast = NOOP; // picking names the marker, never its label
    s.userData.id = l.id;
    s.userData.aspect = Math.max(1, canvas.width) / LABEL_H;
    s.frustumCulled = false;
    disposables.push(tex, mat);
    group.add(s);
    return s;
  }

  function relabel() {
    if (!view) return;
    const { cam, fov, h } = view;
    // sizeAttenuation false: a sprite of scale s is s / tan(fov/2) of the half viewport tall.
    const heightScale = (LABEL_PX * 2 * Math.tan((fov * Math.PI) / 360)) / Math.max(1, h);
    const wanted = labels
      .map((l) => ({
        l,
        d: Math.hypot(l.x - cam.x, LIFT_M - cam.y, l.z - cam.z),
        focused: l.id === focusId,
      }))
      .filter((c) => c.focused || (c.l.kind !== "place" && c.d <= LABEL_RANGE_M))
      .sort((a, b) => Number(b.focused) - Number(a.focused) || a.d - b.d)
      .slice(0, MAX_LABELS);
    const show = new Set(wanted.map((c) => c.l.key));
    for (const { l } of wanted) {
      let s = sprites.get(l.key);
      if (!s) {
        s = labelSprite(l);
        sprites.set(l.key, s);
      }
      s.visible = true;
      s.scale.set(heightScale * (s.userData.aspect as number), heightScale, 1);
    }
    for (const [id, s] of sprites) if (!show.has(id)) s.visible = false;
  }

  function setFocus(id: string | null) {
    focusId = id;
    if (focusPoint) {
      group.remove(focusPoint);
      focusPoint.geometry.dispose();
      (focusPoint.material as THREE.Material).dispose();
      focusPoint = null;
    }
    const p = id ? placeItems.find((i) => i.id === id) : undefined;
    if (p) {
      focusPoint = pointsOf(
        "place",
        [p],
        MARKER_STYLE.place.focusPx,
        MARKER_STYLE.place.color,
        pixelRatio,
      );
      group.add(focusPoint);
    }
    relabel();
  }

  return {
    group,
    placeCount: placeItems.length,
    setFocus,
    setPixelRatio(pr) {
      if (!(pr > 0) || !Number.isFinite(pr)) return;
      pixelRatio = pr;
      group.traverse((o) => {
        if ((o as THREE.Points).isPoints)
          (
            ((o as THREE.Points).material as THREE.ShaderMaterial).uniforms.uPixelRatio as {
              value: number;
            }
          ).value = pr;
      });
    },
    setView(cam, fovDeg, heightPx) {
      view = { cam, fov: fovDeg, h: heightPx };
      relabel();
    },
    dispose() {
      for (const o of [...group.children]) {
        if ((o as THREE.Points).isPoints) {
          (o as THREE.Points).geometry.dispose();
          ((o as THREE.Points).material as THREE.Material).dispose();
        }
        group.remove(o);
      }
      for (const d of disposables) d.dispose();
      sprites.clear();
      focusPoint = null;
    },
  };
}
