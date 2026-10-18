import * as THREE from "three";
import type { RoleUniforms } from "../assets/roleMaterial";
import type { SignPlacement } from "./signPlan";

/** Signs per atlas page (one CanvasTexture, one material). */
export const SIGNS_PER_PAGE = 64;
const COLS = 2;
const ROWS = SIGNS_PER_PAGE / COLS;
/** Atlas cell in pixels. The glyph height is 56 px, well above the 48 px readability floor. */
const CELL_W = 768;
const CELL_H = 96;
const FONT_PX = 56;
const MIN_SQUEEZE = 0.45;
const PAD_PX = 20;
const MAX_HEIGHT_M = 1.1;
const BAND = "#1d2230";
const INK = "#ffffff";

type MakeCanvas = () => HTMLCanvasElement;
const defaultCanvas: MakeCanvas = () => document.createElement("canvas");

/**
 * Text-only shop signs: white text on a dark band, one mesh per sign so each is pickable
 * (`userData.pick = { kind: "sign", id }`). The atlas holds the text and nothing else (no logos).
 * Emissive follows `uLightGlow`: unlit by day, glowing at dusk and night. Each sign is a sourced
 * fact, not decoration: its card shows the source.
 */
export function createSignLayer(
  signs: SignPlacement[],
  uniforms: RoleUniforms,
  makeCanvas: MakeCanvas = defaultCanvas,
): { group: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  group.name = "signs";
  const disposables: { dispose(): void }[] = [];

  for (let page = 0; page * SIGNS_PER_PAGE < signs.length; page++) {
    const batch = signs.slice(page * SIGNS_PER_PAGE, (page + 1) * SIGNS_PER_PAGE);
    const canvas = makeCanvas();
    canvas.width = CELL_W * COLS;
    canvas.height = CELL_H * ROWS;
    const ctx = canvas.getContext("2d");
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      emissive: new THREE.Color("#ffffff"),
      emissiveMap: tex,
      emissiveIntensity: 0,
      roughness: 0.7,
      metalness: 0,
    });
    mat.name = "tl_sign";
    disposables.push(tex, mat);

    batch.forEach((s, i) => {
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
      // The plane shows only the used part of the cell, so the text keeps its proportions.
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
      const geo = new THREE.PlaneGeometry(w, h);
      const uv = geo.getAttribute("uv");
      for (let n = 0; n < uv.count; n++)
        uv.setXY(n, uv.getX(n) < 0.5 ? u0 : u1, uv.getY(n) < 0.5 ? v0 : v1);
      uv.needsUpdate = true;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `sign:${s.id}`;
      mesh.position.set(s.x, s.y, s.z);
      mesh.rotation.y = s.yaw;
      mesh.userData.pick = { kind: "sign", id: s.id };
      mesh.onBeforeRender = () => {
        mat.emissiveIntensity = Math.max(0, Math.min(1, uniforms.uLightGlow.value));
      };
      disposables.push(geo);
      group.add(mesh);
    });
    tex.needsUpdate = true;
  }

  return {
    group,
    dispose() {
      for (const d of disposables) d.dispose();
      group.clear();
    },
  };
}
