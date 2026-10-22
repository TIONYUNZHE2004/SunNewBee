import * as THREE from "three";
import { ROAD_LABEL_STYLE } from "../../styles";
import type { LocalFrame } from "../frame";
import type { OverlayChild } from "./accessLayers";
import { MARKER_ORDER } from "./markers";

/** One named road's label (`GET /layers/road-labels`, T-028): display only, never a fact. */
export interface RoadLabelRow {
  name: string;
  road_class: string;
  length_m: number;
  anchor: number[];
  bearing_deg: number;
}

/** Road names show within this distance of the point the camera looks at (else of the camera);
 * closed or course roads always show. */
export const ROAD_LABEL_RANGE_M = 1500;
/** At most this many ordinary road names at once (nearest first): a draw call each. */
export const MAX_ROAD_LABELS = 10;
const LABEL_PX = 18;
const LABEL_H = 22;
const LIFT_M = 0.8;
const NOOP = () => {};

/**
 * Road names on the Stylised map: italic tags at each road's anchor (its longest mapped stretch
 * inside the township). Roads an answer closes or a proposed course uses are always shown, in
 * the closed-course red; others only the nearest few. Sprites keep a constant pixel height.
 */
export function createRoadLabels(
  rows: readonly RoadLabelRow[],
  frame: LocalFrame,
  highlight: ReadonlySet<string>,
  makeCanvas: () => HTMLCanvasElement = () => document.createElement("canvas"),
): OverlayChild & { shown(): string[] } {
  const group = new THREE.Group();
  group.name = "road-labels";
  const items = rows
    .filter((r) => r.anchor.length >= 2)
    .map((r) => {
      const [x, z] = frame.toLocal(r.anchor[0] as number, r.anchor[1] as number) as [
        number,
        number,
      ];
      return { name: r.name, x, z, hot: highlight.has(r.name) };
    });
  const sprites = new Map<string, THREE.Sprite>();
  const disposables: { dispose(): void }[] = [];

  function sprite(it: (typeof items)[number]): THREE.Sprite {
    const canvas = makeCanvas();
    const ctx = canvas.getContext("2d");
    const font = `italic ${it.hot ? 700 : 600} 13px sans-serif`;
    if (ctx) {
      ctx.font = font;
      const w = Math.ceil(ctx.measureText(it.name).width) + 12;
      canvas.width = w;
      canvas.height = LABEL_H;
      ctx.font = font; // resizing a canvas resets its state
      ctx.fillStyle = it.hot ? ROAD_LABEL_STYLE.hotBg : ROAD_LABEL_STYLE.bg;
      ctx.fillRect(0, 0, w, LABEL_H);
      ctx.fillStyle = it.hot ? ROAD_LABEL_STYLE.hotText : ROAD_LABEL_STYLE.text;
      ctx.textBaseline = "middle";
      ctx.fillText(it.name, 6, LABEL_H / 2 + 1);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      sizeAttenuation: false,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const s = new THREE.Sprite(mat);
    s.position.set(it.x, LIFT_M, it.z);
    s.renderOrder = MARKER_ORDER.labels - 1; // under place labels
    s.raycast = NOOP; // a road name is never picked
    s.userData.aspect = Math.max(1, canvas.width) / LABEL_H;
    s.userData.name = it.name;
    s.frustumCulled = false;
    disposables.push(tex, mat);
    group.add(s);
    return s;
  }

  let res: [number, number] = [1, 1];
  let shownNames: string[] = [];

  return {
    group,
    shown: () => shownNames,
    setResolution(w, h) {
      res = [w, h];
    },
    setView(cam, _now, fovDeg = 40, target) {
      const at = target ?? cam;
      const scale = (LABEL_PX * 2 * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, res[1]);
      const near = items
        .filter((it) => !it.hot)
        .map((it) => ({ it, d: Math.hypot(it.x - at.x, it.z - at.z) }))
        .filter((c) => c.d <= ROAD_LABEL_RANGE_M)
        .sort((a, b) => a.d - b.d)
        .slice(0, MAX_ROAD_LABELS)
        .map((c) => c.it);
      const wanted = [...items.filter((it) => it.hot), ...near];
      const show = new Set(wanted.map((it) => it.name));
      for (const it of wanted) {
        let s = sprites.get(it.name);
        if (!s) {
          s = sprite(it);
          sprites.set(it.name, s);
        }
        s.visible = true;
        s.scale.set(scale * (s.userData.aspect as number), scale, 1);
      }
      for (const [name, s] of sprites) if (!show.has(name)) s.visible = false;
      shownNames = wanted.map((it) => it.name);
    },
    dispose() {
      for (const d of disposables) d.dispose();
      group.clear();
      sprites.clear();
    },
  };
}
