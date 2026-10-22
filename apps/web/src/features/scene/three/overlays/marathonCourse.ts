import * as THREE from "three";
import { DRESSING_STYLE } from "../../../closures/courseDressing";
import type { LocalFrame } from "../frame";
import type { OverlayChild } from "./accessLayers";
import { MARKER_ORDER } from "./markers";

type LonLat = [number, number];

/** What the static dressing draws (`courseDressing`): positions are the engine's and the map's. */
export interface Dressing {
  arches: { label: string; at: LonLat; toward: LonLat }[];
  km: { km: number; at: LonLat }[];
  cones: LonLat[];
  closed: string | null;
}

/** Arch size in metres (stylised: drawn larger than life so it reads from the overview). */
export const ARCH = { span: 22, height: 12, post: 1.8 } as const;
/** Cone size in metres (also larger than life), and its white band. */
export const CONE = { radius: 0.9, height: 2.4 } as const;
const TAG_PX = 24; // the canvas height: labels draw 1:1
const TAG_H = 24;
const NOOP = () => {};

/**
 * T-031 static course dressing on the Stylised map: start / finish arches with their labels, km
 * markers, traffic cones at the closure-boundary junctions and the "Closed 06:00–10:00" tag. The
 * striped course band itself is the overlay layer's closure line. Labels keep a constant pixel
 * size; arches and cones are world objects. Display only, never picked.
 */
export function createMarathonCourse(
  d: Dressing,
  frame: LocalFrame,
  makeCanvas: () => HTMLCanvasElement = () => document.createElement("canvas"),
): OverlayChild & { counts(): { arches: number; km: number; cones: number; tags: number } } {
  const group = new THREE.Group();
  group.name = "marathon-course";
  const disposables: { dispose(): void }[] = [];
  const labels: THREE.Sprite[] = [];
  const at = (p: LonLat) => frame.toLocal(p[0], p[1]);

  const mat = (color: string) => {
    // unlit: the overlay pass has no lights (a lit material draws black there)
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color) });
    disposables.push(m);
    return m;
  };
  const geo = <G extends THREE.BufferGeometry>(g: G) => {
    disposables.push(g);
    return g;
  };

  /** A pixel-sized tag; `row` stacks it that many tag heights above its anchor on screen. */
  function label(text: string, bg: string, fg: string, x: number, y: number, z: number, row = 0) {
    const t = tagSprite(text, bg, fg, makeCanvas, row);
    t.sprite.position.set(x, y, z);
    disposables.push(...t.disposables);
    labels.push(t.sprite);
    group.add(t.sprite);
  }

  // Start / finish arches: two posts and a crossbar, across the course at its ends
  const postGeo = geo(new THREE.BoxGeometry(ARCH.post, ARCH.height, ARCH.post));
  const barGeo = geo(new THREE.BoxGeometry(ARCH.span, ARCH.post * 1.6, ARCH.post));
  // white posts, red crossbar: reads on the day and the night map
  const postMat = mat(DRESSING_STYLE.stripeWhite);
  const barMat = mat(DRESSING_STYLE.stripeRed);
  for (const a of d.arches) {
    const [x, z] = at(a.at);
    const arch = new THREE.Group();
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set((side * ARCH.span) / 2, ARCH.height / 2, 0);
      arch.add(post);
    }
    const bar = new THREE.Mesh(barGeo, barMat);
    bar.position.set(0, ARCH.height, 0);
    arch.add(bar);
    arch.position.set(x, 0, z);
    // the crossbar spans local x: turn it across the course direction
    const [tx, tz] = at(a.toward);
    arch.rotation.y = Math.PI / 2 - Math.atan2(tz - z, tx - x);
    arch.traverse((o) => {
      o.raycast = NOOP;
    });
    group.add(arch);
    label(a.label, DRESSING_STYLE.arch, DRESSING_STYLE.archText, x, ARCH.height + 3, z);
  }

  // Cones at the closure-boundary junctions (one instanced draw, plus the white band)
  if (d.cones.length) {
    const cone = new THREE.InstancedMesh(
      geo(new THREE.ConeGeometry(CONE.radius, CONE.height, 12)),
      mat(DRESSING_STYLE.cone),
      d.cones.length,
    );
    const band = new THREE.InstancedMesh(
      geo(
        new THREE.CylinderGeometry(CONE.radius * 0.55, CONE.radius * 0.7, CONE.height * 0.18, 12),
      ),
      mat(DRESSING_STYLE.coneBand),
      d.cones.length,
    );
    const m4 = new THREE.Matrix4();
    d.cones.forEach((p, i) => {
      const [x, z] = at(p);
      cone.setMatrixAt(i, m4.makeTranslation(x, CONE.height / 2, z));
      band.setMatrixAt(i, m4.makeTranslation(x, CONE.height * 0.52, z));
    });
    for (const mesh of [cone, band]) {
      mesh.raycast = NOOP;
      mesh.frustumCulled = false;
      group.add(mesh);
    }
  }

  for (const k of d.km) {
    const [x, z] = at(k.at);
    label(`${k.km} km`, DRESSING_STYLE.kmBg, DRESSING_STYLE.kmText, x, 4, z);
  }
  const first = d.arches[0];
  if (d.closed && first) {
    const [x, z] = at(first.at);
    label(d.closed, DRESSING_STYLE.tagBg, DRESSING_STYLE.tagText, x, ARCH.height + 3, z, 1);
  }

  let res: [number, number] = [1, 1];
  return {
    group,
    counts: () => ({
      arches: d.arches.length,
      km: d.km.length,
      cones: d.cones.length,
      tags: d.closed && first ? 1 : 0,
    }),
    setResolution(w, h) {
      res = [w, h];
    },
    setView(_cam, _now, fovDeg = 40) {
      for (const s of labels) tagScale(s, fovDeg, res[1]);
    },
    dispose() {
      for (const x of disposables) x.dispose();
      group.clear();
    },
  };
}

/**
 * A pixel-sized tag (a 2D-canvas pill) as a sprite: drawn over everything, never picked. `row`
 * stacks it that many tag heights above its anchor on screen. Scale it with `tagScale`.
 */
export function tagSprite(
  text: string,
  bg: string,
  fg: string,
  makeCanvas: () => HTMLCanvasElement,
  row = 0,
): { sprite: THREE.Sprite; disposables: { dispose(): void }[] } {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d");
  const font = "700 13px sans-serif";
  if (ctx) {
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + 16;
    canvas.width = w;
    canvas.height = TAG_H;
    ctx.font = font; // resizing a canvas resets its state
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, TAG_H);
    ctx.fillStyle = fg;
    ctx.textBaseline = "middle";
    ctx.fillText(text, 8, TAG_H / 2 + 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.SpriteMaterial({
    map: tex,
    sizeAttenuation: false,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const s = new THREE.Sprite(m);
  s.center.set(0.5, 0.5 - row * 1.15);
  s.renderOrder = MARKER_ORDER.labels - 1;
  s.raycast = NOOP;
  s.frustumCulled = false;
  s.userData.aspect = Math.max(1, canvas.width) / TAG_H;
  s.userData.text = text;
  return { sprite: s, disposables: [tex, m] };
}

/** Sets a tag's screen size for the camera's fov and the canvas height (CSS px). */
export function tagScale(s: THREE.Sprite, fovDeg: number, heightPx: number): void {
  const k = (TAG_PX * 2 * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, heightPx);
  s.scale.set(k * (s.userData.aspect as number), k, 1);
}
