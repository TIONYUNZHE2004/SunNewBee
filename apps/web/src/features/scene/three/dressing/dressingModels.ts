import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CLAY_PALETTE } from "../shared/clayTokens";
import type { DressModel } from "./dressingPlan";

/**
 * Street dressing models (B-T7), built in code: clay, rounded, low poly. Boxes are bevelled
 * `ExtrudeGeometry` with a negative bevel offset (the prototype's rounded-box recipe, so outer sizes
 * are kept); poles are 8-sided cylinders, heads and globes low spheres. Each model is ONE
 * non-indexed geometry with per-vertex colours (white base material, role `dressing`).
 *
 * Model frame: y up, origin on the ground at the footprint centre, +z faces the street / line the
 * planner aims it at (props) or runs along it (zebra bars, kerb pieces).
 * Colours come from `CLAY_PALETTE` only (AC-B1). The traffic signal model exists for data that has
 * signals; the planner draws it only for a `traffic_signals` feature.
 */

const PR = CLAY_PALETTE.prop;
const DR = CLAY_PALETTE.dressing;
type V3 = [number, number, number];

function finish(g: THREE.BufferGeometry, colour: string): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  if (ng !== g) g.dispose();
  for (const name of Object.keys(ng.attributes))
    if (name !== "position" && name !== "normal") ng.deleteAttribute(name);
  ng.computeVertexNormals();
  const c = new THREE.Color(colour);
  const n = ng.getAttribute("position").count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  ng.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return ng;
}

/** A w x h x d box (x, y, z) with rounded (bevelled) edges, base centred at `at`. */
export function bevelBox(
  w: number,
  h: number,
  d: number,
  bevel: number,
  colour: string,
  at: V3 = [0, 0, 0],
) {
  const b = Math.min(bevel, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(w / 2, h);
  shape.lineTo(-w / 2, h);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-3, d - 2 * b),
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: 1,
    curveSegments: 1,
  });
  g.translate(at[0], at[1], at[2] - (d - 2 * b) / 2);
  return finish(g, colour);
}

function cylinder(r: number, h: number, colour: string, at: V3 = [0, 0, 0], seg = 8, rTop = r) {
  const g = new THREE.CylinderGeometry(rTop, r, h, seg, 1);
  g.translate(at[0], at[1] + h / 2, at[2]);
  return finish(g, colour);
}

function sphere(r: number, colour: string, at: V3, w = 8, hs = 5, sy = 1) {
  const g = new THREE.SphereGeometry(r, w, hs);
  g.scale(1, sy, 1);
  g.translate(at[0], at[1], at[2]);
  return finish(g, colour);
}

function blade(colour: string, at: V3, tiltX: number, tiltZ: number, h: number) {
  const g = new THREE.ConeGeometry(0.06, h, 5, 1);
  g.translate(0, h / 2, 0);
  g.rotateX(tiltX);
  g.rotateZ(tiltZ);
  g.translate(at[0], at[1], at[2]);
  return finish(g, colour);
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!g) throw new Error("dressing model merge failed");
  g.computeBoundingSphere();
  return g;
}

const zebra = () => merge([bevelBox(2.6, 0.025, 0.5, 0.012, CLAY_PALETTE.marking)]);

const bench = () =>
  merge([
    bevelBox(1.6, 0.07, 0.42, 0.03, PR.wood, [0, 0.4, 0.02]),
    bevelBox(1.6, 0.3, 0.06, 0.025, PR.wood, [0, 0.52, -0.2]),
    bevelBox(0.07, 0.4, 0.42, 0.025, PR.iron, [-0.68, 0, 0]),
    bevelBox(0.07, 0.4, 0.42, 0.025, PR.iron, [0.68, 0, 0]),
  ]);

const signal = () =>
  merge([
    cylinder(0.07, 3.1, DR.pole, [0, 0, 0]),
    bevelBox(0.34, 0.95, 0.28, 0.08, DR.signalHead, [0, 2.55, 0.05]),
    sphere(0.09, DR.signalRed, [0, 3.3, 0.2], 8, 5),
    sphere(0.09, DR.signalAmber, [0, 3.02, 0.2], 8, 5),
    sphere(0.09, DR.signalGreen, [0, 2.74, 0.2], 8, 5),
  ]);

const busStop = () => {
  const disc = new THREE.CylinderGeometry(0.3, 0.3, 0.06, 12, 1);
  disc.rotateX(Math.PI / 2);
  disc.translate(0, 2.35, 0.06);
  return merge([
    cylinder(0.05, 2.7, DR.pole),
    finish(disc, DR.busSign),
    bevelBox(0.42, 0.26, 0.05, 0.02, PR.awningWhite, [0, 1.85, 0.06]),
  ]);
};

/** A canopy on four posts with a back panel. No seat: a bench is drawn only for a bench feature. */
const shelter = () =>
  merge([
    bevelBox(2.6, 0.14, 1.5, 0.06, PR.shelter, [0, 2.35, 0]),
    bevelBox(2.4, 1.5, 0.06, 0.025, PR.kerb, [0, 0.7, -0.62]),
    cylinder(0.05, 2.36, PR.iron, [-1.15, 0, -0.6]),
    cylinder(0.05, 2.36, PR.iron, [1.15, 0, -0.6]),
    cylinder(0.05, 2.36, PR.iron, [-1.15, 0, 0.6]),
    cylinder(0.05, 2.36, PR.iron, [1.15, 0, 0.6]),
  ]);

const planter = () =>
  merge([
    bevelBox(1, 0.5, 1, 0.1, PR.planter),
    bevelBox(0.84, 0.04, 0.84, 0.015, DR.soil, [0, 0.48, 0]),
    sphere(0.3, DR.grass, [-0.18, 0.66, -0.1], 8, 5, 0.8),
    sphere(0.26, CLAY_PALETTE.greens[1], [0.2, 0.64, 0.12], 8, 5, 0.8),
    sphere(0.1, PR.flowers[0], [0.05, 0.86, -0.05], 6, 4),
  ]);

const lampPost = () =>
  merge([
    cylinder(0.11, 0.25, PR.iron, [0, 0, 0], 8, 0.08),
    cylinder(0.055, 3.4, PR.iron, [0, 0.25, 0]),
    sphere(0.19, DR.lampGlobe, [0, 3.8, 0], 10, 6),
    cylinder(0.2, 0.08, PR.iron, [0, 3.98, 0], 8, 0.05),
  ]);

const kerb = () => merge([bevelBox(0.24, 0.14, 2.9, 0.06, PR.kerb)]);

const flowers = (c: string) =>
  merge([
    sphere(0.32, DR.grass, [0, 0.02, 0], 8, 4, 0.45),
    sphere(0.08, c, [0.12, 0.17, 0.06], 6, 4),
    sphere(0.08, c, [-0.1, 0.18, 0.1], 6, 4),
    sphere(0.08, c, [0.02, 0.2, -0.13], 6, 4),
    sphere(0.07, PR.flowers[4], [-0.14, 0.14, -0.06], 6, 4),
  ]);

const grassTuft = () =>
  merge([
    blade(DR.grass, [0, 0, 0], 0, 0, 0.32),
    blade(DR.grass, [0.06, 0, 0.02], 0.15, -0.35, 0.26),
    blade(CLAY_PALETTE.greens[0], [-0.05, 0, -0.03], -0.2, 0.3, 0.28),
    blade(CLAY_PALETTE.greens[3], [0.01, 0, 0.07], 0.35, 0.1, 0.22),
  ]);

/** Number of flower tints (instances pick one by `tint`). */
export const FLOWER_TINTS = 5;

/** Geometry bucket key: the model, and the tint for flowers. */
export const bucketOf = (model: DressModel, tint?: number): string =>
  model === "flowers" ? `flowers:${(tint ?? 0) % FLOWER_TINTS}` : model;

/** Every model's geometry by bucket key (flowers: one per tint). The caller owns and disposes them. */
export function buildDressingModels(): Map<string, THREE.BufferGeometry> {
  const out = new Map<string, THREE.BufferGeometry>([
    ["zebra", zebra()],
    ["signal", signal()],
    ["busStop", busStop()],
    ["shelter", shelter()],
    ["bench", bench()],
    ["planter", planter()],
    ["lampPost", lampPost()],
    ["kerb", kerb()],
    ["grassTuft", grassTuft()],
  ]);
  for (let i = 0; i < FLOWER_TINTS; i++)
    out.set(`flowers:${i}`, flowers(PR.flowers[i % PR.flowers.length]!));
  return out;
}

export const trianglesOf = (g: THREE.BufferGeometry): number =>
  g.getAttribute("position").count / 3;
