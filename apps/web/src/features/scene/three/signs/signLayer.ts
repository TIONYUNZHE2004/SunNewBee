import * as THREE from "three";
import type { RoleUniforms } from "../assets/roleMaterial";
import type { SignPlacement } from "./signPlan";

/** Signs per atlas page (one CanvasTexture, one material, one merged mesh = one draw call). */
export const SIGNS_PER_PAGE = 64;
const COLS = 2;
const ROWS = SIGNS_PER_PAGE / COLS;
/** Atlas cell in pixels: a 1024 x 2048 page (about 11 MB on the GPU with mipmaps). */
const CELL_W = 512;
const CELL_H = 64;
/** Glyph height in the cell; at or above the 40 px legibility floor. */
const FONT_PX = 44;
const MIN_SQUEEZE = 0.45;
const PAD_PX = 14;
const MAX_HEIGHT_M = 1.1;
const BAND = "#1d2230";
const INK = "#ffffff";

/** The sign id behind a raycast hit on a batched page mesh (two triangles per sign). */
export function signIdAt(
  mesh: THREE.Object3D,
  faceIndex: number | undefined | null,
): string | null {
  const ids = mesh.userData.signIds as string[] | undefined;
  if (!ids || faceIndex === undefined || faceIndex === null || faceIndex < 0) return null;
  return ids[Math.floor(faceIndex / 2)] ?? null;
}

type MakeCanvas = () => HTMLCanvasElement;
const defaultCanvas: MakeCanvas = () => document.createElement("canvas");

/**
 * Text-only shop signs: white text on a dark band. Each atlas page is ONE merged mesh of quads
 * (draw calls = pages, not signs); `userData.pick = { kind: "sign" }` and `userData.signIds` let
 * `signIdAt(mesh, hit.faceIndex)` name the sign. The atlas holds the text and nothing else (no
 * logos). Emissive follows `uLightGlow`: unlit by day, glowing at dusk and night. Each sign is a
 * sourced fact, not decoration: its card shows the source.
 *
 * Memory: after the first GPU upload the page canvas is released (`tex.image` becomes a 1 px
 * canvas), so only the GPU copy remains. Trade-off: if the GL context is lost and restored, three
 * would re-upload that 1 px image and the signs would go blank until the layer is rebuilt.
 */
export function createSignLayer(
  signs: SignPlacement[],
  uniforms: RoleUniforms,
  makeCanvas: MakeCanvas = defaultCanvas,
): { group: THREE.Group; dispose(): void } {
  const build = signLayerSteps(signs, uniforms, makeCanvas);
  for (const step of build.steps) step();
  return build.layer;
}

/**
 * Measures and draws every sign text once on a small scratch canvas in the sign font, so the
 * browser's font fallback and glyph caches are warm before any streamed sign rebuild (a cold
 * `measureText` of a new glyph took about 20 ms in one sliced step, P5 Task 5). Load-time work:
 * call it once per sign set, outside any streamed frame.
 */
export function warmSignFont(
  texts: Iterable<string>,
  makeCanvas: MakeCanvas = defaultCanvas,
): void {
  const canvas = makeCanvas();
  canvas.width = CELL_W;
  canvas.height = CELL_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.font = `700 ${FONT_PX}px system-ui, "Segoe UI", Arial, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  for (const t of new Set(texts)) {
    ctx.measureText(t);
    ctx.fillText(t, CELL_W / 2, CELL_H / 2);
  }
  canvas.width = 1;
  canvas.height = 1;
}

/** Signs drawn per build step (a time-sliced rebuild runs a few steps a frame). */
export const SIGNS_PER_STEP = 8;

/**
 * `createSignLayer` as a list of small steps, for a time-sliced rebuild: per atlas page one setup
 * step, one step per SIGNS_PER_STEP signs (text and quads) and one step that makes the page mesh.
 * `layer` is complete once every step has run (in order); before that, `layer.dispose()` releases
 * what was built so far. Running all steps at once gives exactly `createSignLayer`'s layer.
 */
export function signLayerSteps(
  signs: SignPlacement[],
  uniforms: RoleUniforms,
  makeCanvas: MakeCanvas = defaultCanvas,
): { steps: Array<() => void>; layer: { group: THREE.Group; dispose(): void } } {
  const group = new THREE.Group();
  group.name = "signs";
  const disposables: { dispose(): void }[] = [];
  const steps: Array<() => void> = [];

  for (let page = 0; page * SIGNS_PER_PAGE < signs.length; page++) {
    const batch = signs.slice(page * SIGNS_PER_PAGE, (page + 1) * SIGNS_PER_PAGE);
    const pos = new Float32Array(batch.length * 12);
    const nor = new Float32Array(batch.length * 12);
    const uvs = new Float32Array(batch.length * 8);
    const idx = new Uint32Array(batch.length * 6);
    let canvas: HTMLCanvasElement;
    let ctx: CanvasRenderingContext2D | null = null;
    let tex: THREE.CanvasTexture;
    let mat: THREE.MeshStandardMaterial;

    steps.push(() => {
      canvas = makeCanvas();
      canvas.width = CELL_W * COLS;
      canvas.height = CELL_H * ROWS;
      ctx = canvas.getContext("2d");
      const t = new THREE.CanvasTexture(canvas);
      tex = t;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.onUpdate = () => {
        t.onUpdate = null;
        const tiny = makeCanvas();
        tiny.width = 1;
        tiny.height = 1;
        t.image = tiny;
        canvas.width = 1;
        canvas.height = 1;
      };
      mat = new THREE.MeshStandardMaterial({
        map: t,
        emissive: new THREE.Color("#ffffff"),
        emissiveMap: t,
        emissiveIntensity: 0,
        roughness: 0.7,
        metalness: 0,
      });
      mat.name = "tl_sign";
      disposables.push(t, mat);
    });

    const drawSign = (s: SignPlacement, i: number) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const ox = col * CELL_W;
      const oy = row * CELL_H;
      // Text width in the cell: squeezed to fit, never cropped.
      let used = CELL_W;
      if (ctx) {
        ctx.fillStyle = BAND;
        ctx.fillRect(ox, oy, CELL_W, CELL_H);
        ctx.font = `700 ${FONT_PX}px system-ui, "Segoe UI", Arial, sans-serif`;
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        ctx.fillStyle = INK;
        const natural = ctx.measureText(s.text).width;
        const room = CELL_W - 2 * PAD_PX;
        const k = Math.max(MIN_SQUEEZE, Math.min(1, room / Math.max(1, natural)));
        used = Math.min(CELL_W, Math.ceil(natural * k) + 2 * PAD_PX);
        ctx.save();
        ctx.translate(ox + CELL_W / 2, oy + CELL_H / 2);
        ctx.scale(k, 1);
        ctx.fillText(s.text, 0, 0);
        ctx.restore();
      }
      // The quad shows only the used part of the cell, so the text keeps its proportions.
      const u0 = (ox + (CELL_W - used) / 2) / (CELL_W * COLS);
      const u1 = (ox + (CELL_W + used) / 2) / (CELL_W * COLS);
      const v1 = 1 - oy / (CELL_H * ROWS);
      const v0 = 1 - (oy + CELL_H) / (CELL_H * ROWS);
      let w = s.widthM;
      let h = (w * CELL_H) / used;
      if (h > MAX_HEIGHT_M) {
        w *= MAX_HEIGHT_M / h;
        h = MAX_HEIGHT_M;
      }
      // Corners: top-left, top-right, bottom-left, bottom-right, turned by yaw about +y.
      const c = Math.cos(s.yaw);
      const sn = Math.sin(s.yaw);
      const corners: [number, number][] = [
        [-w / 2, h / 2],
        [w / 2, h / 2],
        [-w / 2, -h / 2],
        [w / 2, -h / 2],
      ];
      corners.forEach(([lx, ly], n) => {
        const o = i * 12 + n * 3;
        pos[o] = s.x + lx * c;
        pos[o + 1] = s.y + ly;
        pos[o + 2] = s.z - lx * sn;
        nor[o] = sn;
        nor[o + 1] = 0;
        nor[o + 2] = c;
      });
      uvs.set([u0, v1, u1, v1, u0, v0, u1, v0], i * 8);
      const v = i * 4;
      idx.set([v, v + 2, v + 1, v + 2, v + 3, v + 1], i * 6);
    };
    for (let from = 0; from < batch.length; from += SIGNS_PER_STEP)
      steps.push(() => {
        const to = Math.min(batch.length, from + SIGNS_PER_STEP);
        for (let i = from; i < to; i++) drawSign(batch[i] as SignPlacement, i);
      });

    steps.push(() => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `signs:page${page}`;
      mesh.userData.pick = { kind: "sign" };
      mesh.userData.signIds = batch.map((s) => s.id);
      // One uniform read per page, not per sign.
      mesh.onBeforeRender = () => {
        mat.emissiveIntensity = Math.max(0, Math.min(1, uniforms.uLightGlow.value));
      };
      tex.needsUpdate = true;
      disposables.push(geo);
      group.add(mesh);
    });
  }

  return {
    steps,
    layer: {
      group,
      dispose() {
        for (const d of disposables) d.dispose();
        group.clear();
      },
    },
  };
}
