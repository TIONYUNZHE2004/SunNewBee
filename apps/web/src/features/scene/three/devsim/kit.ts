import * as THREE from "three";
import type { AssetLibrary } from "../assets/library";
import type { Manifest } from "../assets/manifest";
import { createRoleMaterial, type RoleUniforms } from "../assets/roleMaterial";

const NOOP = () => {};

/** COLOR_0 = (AO 1, role, seed 1) on every vertex. */
export function withRole(g: THREE.BufferGeometry, role: number): THREE.BufferGeometry {
  const n = g.getAttribute("position").count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([1, role / 7, 1], i * 3);
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/**
 * An instanced kit model (construction or vehicle kit LOD0) in the shared role material with a
 * per-instance palette; a role-coloured box of the manifest size when the library lacks it.
 * The library's attributes are shared, never disposed here.
 */
export interface KitMesh {
  mesh: THREE.InstancedMesh;
  /** Sets instance i's matrix and palette index. */
  set(i: number, m: THREE.Matrix4, palette?: number): void;
  setCount(n: number): void;
  dispose(): void;
}

export function kitMesh(o: {
  lib?: AssetLibrary | null;
  manifest?: Manifest | null;
  uniforms: RoleUniforms;
  asset: string;
  variant: string;
  count: number;
  palettes: [string, string, string][];
  /** Fallback box size [x, y, z] (metres, base on y 0). */
  box: [number, number, number];
  kind?: "vehicle" | "static";
  castShadow?: boolean;
}): KitMesh {
  const src = o.lib?.geometry(o.asset, o.variant, 0) ?? null;
  const geo = new THREE.BufferGeometry();
  let own: THREE.BufferGeometry | null = null;
  if (src) {
    for (const [name, a] of Object.entries(src.attributes)) geo.setAttribute(name, a);
    if (src.index) geo.setIndex(src.index);
  } else {
    own = withRole(new THREE.BoxGeometry(...o.box).translate(0, o.box[1] / 2, 0), 0);
    for (const [name, a] of Object.entries(own.attributes)) geo.setAttribute(name, a);
    if (own.index) geo.setIndex(own.index);
  }
  const cap = Math.max(1, o.count);
  const pal = [0, 1, 2].map(() => new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
  pal.forEach((a, i) => {
    geo.setAttribute(`iPal${i}`, a);
  });
  const mat = createRoleMaterial({
    instanced: true,
    uniforms: o.uniforms,
    ...(o.kind === "vehicle" ? { kind: "parked" as const } : {}),
  });
  const mesh = new THREE.InstancedMesh(geo, mat, cap);
  mesh.name = `devsim-${o.variant}`;
  mesh.castShadow = o.castShadow ?? true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.raycast = NOOP;
  mesh.count = 0;
  const colours = o.palettes.map((p) => p.map((h) => new THREE.Color(h)));
  return {
    mesh,
    set(i, m, palette = 0) {
      mesh.setMatrixAt(i, m);
      const c = colours[palette % Math.max(1, colours.length)];
      if (c)
        for (let k = 0; k < 3; k++) {
          const col = c[k] as THREE.Color;
          (pal[k] as THREE.InstancedBufferAttribute).setXYZ(i, col.r, col.g, col.b);
        }
      mesh.instanceMatrix.needsUpdate = true;
      for (const a of pal) a.needsUpdate = true;
    },
    setCount(n) {
      mesh.count = Math.max(0, Math.min(cap, n));
    },
    dispose() {
      // detach the library's shared attributes before dispose (it would free their buffers)
      for (const name of Object.keys(geo.attributes))
        if (!name.startsWith("iPal")) geo.deleteAttribute(name);
      geo.setIndex(null);
      geo.dispose();
      own?.dispose();
      mat.dispose();
      mesh.dispose();
    },
  };
}

/** The manifest palette list of an asset (default group), or a neutral one. */
export function kitPalettes(
  m: Manifest | null | undefined,
  asset: string,
): [string, string, string][] {
  const p = m?.assets[asset]?.palettes.default as [string, string, string][] | undefined;
  return p && p.length > 0 ? p : [["#d8d6d0", "#62666c", "#8a8f96"]];
}

const _q = new THREE.Quaternion();
const _y = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
/** A ground placement matrix: position (x, y, z), yaw about +y, uniform or per-axis scale. */
export function place(
  out: THREE.Matrix4,
  x: number,
  y: number,
  z: number,
  yaw: number,
  sx = 1,
  sy = sx,
  sz = sx,
): THREE.Matrix4 {
  return out.compose(_p.set(x, y, z), _q.setFromAxisAngle(_y, yaw), _s.set(sx, sy, sz));
}
