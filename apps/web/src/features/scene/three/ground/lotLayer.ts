import * as THREE from "three";
import { triangulate } from "../cityMesh";
import {
  GRAVEL_TINT,
  type Site,
  TRACK_COLOUR,
  TRACK_STRIDE,
  TRACK_WIDTH_M,
} from "../props/construction";
import { CLAY_PALETTE } from "../shared/clayTokens";
import { CONSTRUCTION_Y } from "./bands";
import { STALL_D_M, STALL_LIFT_Y, STALL_LINE_M, STALL_STRIDE, STALL_W_M } from "./parking";

/**
 * Task 10: the parking-lot and construction-land ground, as plain triangle builders. Wave 4b
 * (ruling P4-X) folds them into existing ground draws instead of a layer of their own:
 * - `stallLines`: white stall lines (two sides and the back of each stall, open toward the aisle
 *   the car's nose points to) at STALL_LIFT_Y = 0.10 m, merged into the road-markings mesh
 *   (`createGroundLayer`);
 * - `constructionGround`: the gravel tint of every site (whole polygon, deduplicated by the caller)
 *   then the 4 m earth tracks at CONSTRUCTION_Y, merged into the ground-decor mesh
 *   (`createGroundDecorLayer`), which paints in triangle order so tracks never z-fight the gravel.
 * DECORATIVE: the meshes they land in are never picked (no-op raycast) and never cited.
 */

export const STALL_COLOUR: string = CLAY_PALETTE.stall;

class Builder {
  pos: number[] = [];
  col: number[] = [];
  constructor(readonly y: number) {}
  tri(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, c: THREE.Color) {
    // Upward facing (front side seen from above): cross((b - a), (c - a)).y > 0.
    const cy = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const pts = cy >= 0 ? [ax, az, bx, bz, cx, cz] : [ax, az, cx, cz, bx, bz];
    for (let i = 0; i < 6; i += 2) {
      this.pos.push(pts[i]!, this.y, pts[i + 1]!);
      this.col.push(c.r, c.g, c.b);
    }
  }
  /** A flat rectangle: centre, half-extent `a` along (ux, uz), half-extent `b` across it. */
  quad(x: number, z: number, ux: number, uz: number, a: number, b: number, c: THREE.Color) {
    const vx = -uz;
    const vz = ux;
    const p0x = x - ux * a - vx * b;
    const p0z = z - uz * a - vz * b;
    const p1x = x + ux * a - vx * b;
    const p1z = z + uz * a - vz * b;
    const p2x = x + ux * a + vx * b;
    const p2z = z + uz * a + vz * b;
    const p3x = x - ux * a + vx * b;
    const p3z = z - uz * a + vz * b;
    this.tri(p0x, p0z, p1x, p1z, p2x, p2z, c);
    this.tri(p0x, p0z, p2x, p2z, p3x, p3z, c);
  }
}

/** Gravel triangles (x, z per vertex) of one site, triangulated once per site object. */
const gravelTris = new WeakMap<Site, Float32Array>();
function trianglesOf(site: Site): Float32Array {
  let t = gravelTris.get(site);
  if (!t) {
    const [outer, ...holes] = site.poly;
    const tris = outer ? triangulate(outer, holes) : null;
    const all = [outer ?? [], ...holes].flat();
    const out: number[] = [];
    for (const tri of tris ?? []) for (const i of tri) out.push(all[i]![0], all[i]![1]);
    t = new Float32Array(out);
    gravelTris.set(site, t);
  }
  return t;
}

/** The stall marking quads of one stall list, into `b`. */
function addStalls(b: Builder, stalls: Float32Array, c: THREE.Color) {
  const w = STALL_LINE_M / 2;
  for (let i = 0; i + STALL_STRIDE - 1 < stalls.length; i += STALL_STRIDE) {
    const x = stalls[i]!;
    const z = stalls[i + 1]!;
    const yaw = stalls[i + 2]!;
    // Heading (the car's nose, model +z after the yaw) and the stall's width axis.
    const hx = Math.sin(yaw);
    const hz = Math.cos(yaw);
    const sx = hz;
    const sz = -hx;
    for (const side of [-1, 1])
      b.quad(
        x + (sx * side * STALL_W_M) / 2,
        z + (sz * side * STALL_W_M) / 2,
        hx,
        hz,
        STALL_D_M / 2,
        w,
        c,
      );
    b.quad(x - (hx * STALL_D_M) / 2, z - (hz * STALL_D_M) / 2, sx, sz, STALL_W_M / 2 + w, w, c);
  }
}

/** Stall-line triangles (x y z per vertex, 9 floats per triangle, upward facing) of the stall lists. */
export function stallLines(stalls: readonly Float32Array[]): Float32Array {
  const b = new Builder(STALL_LIFT_Y);
  const white = new THREE.Color(STALL_COLOUR);
  for (const list of stalls) addStalls(b, list, white);
  return new Float32Array(b.pos);
}

/**
 * Construction-ground triangles (gravel tint of each site, then the earth tracks), upward facing at
 * CONSTRUCTION_Y, with per-vertex colours. Painted in this order (no depth writes) by its mesh.
 */
export function constructionGround(
  tracks: readonly Float32Array[],
  gravel: readonly Site[],
): { pos: Float32Array; col: Float32Array } {
  const ground = new Builder(CONSTRUCTION_Y);
  const tint = new THREE.Color(GRAVEL_TINT);
  for (const site of gravel) {
    const t = trianglesOf(site);
    for (let i = 0; i + 5 < t.length; i += 6)
      ground.tri(t[i]!, t[i + 1]!, t[i + 2]!, t[i + 3]!, t[i + 4]!, t[i + 5]!, tint);
  }
  const track = new THREE.Color(TRACK_COLOUR);
  for (const list of tracks)
    for (let i = 0; i + TRACK_STRIDE - 1 < list.length; i += TRACK_STRIDE) {
      const dx = list[i + 2]! - list[i]!;
      const dz = list[i + 3]! - list[i + 1]!;
      const l = Math.hypot(dx, dz);
      if (l === 0) continue;
      const mx = (list[i]! + list[i + 2]!) / 2;
      const mz = (list[i + 1]! + list[i + 3]!) / 2;
      ground.quad(mx, mz, dx / l, dz / l, l / 2, TRACK_WIDTH_M / 2, track);
    }
  return { pos: new Float32Array(ground.pos), col: new Float32Array(ground.col) };
}
