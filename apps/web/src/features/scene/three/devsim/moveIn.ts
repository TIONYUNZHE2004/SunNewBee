import * as THREE from "three";
import type { AssetLibrary } from "../assets/library";
import type { Manifest } from "../assets/manifest";
import type { RoleUniforms } from "../assets/roleMaterial";
import { DEVSIM_COLOURS } from "../shared/clayTokens";
import type { DevsimFrame, DevsimPart } from "./devsimLayer";
import { ease, span } from "./ease";
import { along, lengthOf, onPath, type SiteGeom, type XZ, yawOf } from "./geom";
import { kitMesh, kitPalettes, place } from "./kit";
import type { MoveInTiming, SetPieceTiming } from "./setPieces";
import { lorryPoses, moveInRoutePoses, type VehiclePose } from "./site";

/**
 * Move-in (spec §6.2 "Move-in", §6.3 27-33 s; C10, AC-W5): the pure poses of the boxes, movers,
 * parked cars and playground children, and the part that draws the boxes and the parked cars.
 * The movers and children are cast slots (`cast.ts`, crowd looks); the moving lorries are the
 * site's (`site.ts`). All timing comes from `setPieces.ts` (`SET_PIECE_S.moveIn`). Decorative.
 */

/** Boxes stacked by the door (≥ 8; AC-W5). */
export const BOXES = 12;
/** Cars that park in the tower car park (≥ 6; AC-W5), A4 kit variants in turn. */
export const PARKED_CARS = 8;
export const CAR_VARIANTS = ["compact_hatch", "micro_hatch", "small_sedan", "mpv"] as const;
const CAR_BOX: Record<(typeof CAR_VARIANTS)[number], [number, number, number]> = {
  compact_hatch: [1.7, 1.5, 3.9],
  micro_hatch: [1.6, 1.5, 3.7],
  small_sedan: [1.7, 1.5, 4.3],
  mpv: [1.7, 1.7, 4.4],
};
/** Children at the nearest playground (≥ 4 crowd child looks; AC-W5). */
export const KIDS = 5;
const BOX_M = 0.6;
const STALL_W_M = 2.8;
const AISLE_RUN_M = 18;

/** Where the moving lorries stand once parked (their tails: the movers start there). */
export function parkedLorries(g: SiteGeom, m: MoveInTiming): VehiclePose[] {
  const far = m.t0 + 60;
  const poses =
    g.lorryRoute.length >= 2 ? moveInRoutePoses(g.lorryRoute, far, m) : lorryPoses(g, far + 40);
  return poses.filter((v): v is VehiclePose => !!v);
}

/** A mover's walk: from lorry `i % lorries` tail to the walk node, up the entrance path to the door. */
export function moverPath(g: SiteGeom, lorries: readonly VehiclePose[], i: number): XZ[] {
  const lorry = lorries[i % Math.max(1, lorries.length)];
  const door = [...g.path].reverse();
  if (!lorry) return door;
  const tail: XZ = [lorry.x - lorry.dir[0] * 4.5, lorry.z - lorry.dir[1] * 4.5];
  return [tail, ...door];
}

/**
 * Mover i at t (schedule mode; pure): null before they leave the lorry and once through the door
 * (they fade in at the door: not drawn). `entered` is true from the arrival on.
 */
export function moverAt(
  path: readonly XZ[],
  m: NonNullable<MoveInTiming["movers"]>,
  i: number,
  t: number,
): { p: XZ; yaw: number; entered: boolean } | null {
  const a = m.t0 + i * m.gap;
  if (t < a) return null;
  if (t >= a + m.walk) return { p: path[path.length - 1] as XZ, yaw: 0, entered: true };
  const L = lengthOf(path);
  const at = along(path, L * span(t, a, a + m.walk));
  return { p: at.p, yaw: yawOf(at.dir), entered: false };
}

/** The box stack by the door (2 deep x 3 wide x 2 high), beside the entrance path. */
export function boxSlots(g: SiteGeom): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let k = 0; k < BOXES; k++) {
    const layer = Math.floor(k / 6);
    const r = k % 6;
    const col = r % 3;
    const row = Math.floor(r / 3);
    const p = onPath(g, 1.4 + row * (BOX_M + 0.05), 2.4 + col * (BOX_M + 0.05));
    out.push([p[0], 0.05 + layer * BOX_M + BOX_M / 2, p[1]]);
  }
  return out;
}

/** Boxes shown at t: they appear one by one over the boxes window and clear at `boxesUntil`. */
export function boxesShown(m: MoveInTiming, t: number): number {
  if (t < m.boxes[0] || t >= m.boxesUntil) return 0;
  return Math.min(BOXES, Math.floor(BOXES * span(t, m.boxes[0], m.boxes[1]) + 1e-9) + 1);
}

/** The car park behind the tower (the yard's place once the hoarding is down): stall centres. */
export function carStalls(g: SiteGeom): { p: XZ; dir: XZ; aisle: XZ }[] {
  const at = (o: number, s: number): XZ => [
    g.centre[0] + g.out[0] * o + g.side[0] * s,
    g.centre[1] + g.out[1] * o + g.side[1] * s,
  ];
  const aisleO = -(g.radius + 15);
  return Array.from({ length: PARKED_CARS }, (_, k) => {
    const row = Math.floor(k / 4);
    const s = ((k % 4) - 1.5) * STALL_W_M;
    const o = row === 0 ? aisleO + 6 : aisleO - 6;
    const dir: XZ = row === 0 ? [g.out[0], g.out[1]] : [-g.out[0], -g.out[1]];
    return { p: at(o, s), dir, aisle: at(aisleO, s) };
  });
}

/**
 * Car k at t (pure): drives up the aisle from its end, turns into the stall and parks (`parked`).
 * Null before it arrives.
 */
export function carAt(
  g: SiteGeom,
  m: MoveInTiming,
  k: number,
  t: number,
): { pose: VehiclePose; parked: boolean } | null {
  const st = carStalls(g)[k];
  if (!st) return null;
  const a = m.cars.t0 + k * m.cars.gap;
  const lead = a - 0.8;
  if (t < lead) return null;
  const entry: XZ = [st.aisle[0] - g.side[0] * AISLE_RUN_M, st.aisle[1] - g.side[1] * AISLE_RUN_M];
  if (t < a) {
    const u = ease(span(t, lead, a));
    return {
      pose: {
        x: entry[0] + (st.aisle[0] - entry[0]) * u,
        z: entry[1] + (st.aisle[1] - entry[1]) * u,
        dir: [g.side[0], g.side[1]],
      },
      parked: false,
    };
  }
  const u = ease(span(t, a, a + m.cars.drive));
  return {
    pose: {
      x: st.aisle[0] + (st.p[0] - st.aisle[0]) * u,
      z: st.aisle[1] + (st.p[1] - st.aisle[1]) * u,
      dir: st.dir,
    },
    parked: u >= 1,
  };
}

/** Child k at the playground at t (pure): a slow loop round it from `kidsAt` on, else null. */
export function kidAt(
  playground: XZ,
  m: MoveInTiming,
  k: number,
  t: number,
): { p: XZ; yaw: number; walk: boolean } | null {
  if (t < m.kidsAt) return null;
  const r = 3 + (k % 3) * 1.4;
  const w = (k % 2 ? -1 : 1) * 0.9;
  const a = (t - m.kidsAt) * w + (k / KIDS) * Math.PI * 2;
  const p: XZ = [playground[0] + Math.cos(a) * r, playground[1] + Math.sin(a) * r];
  const dir: XZ = [-Math.sin(a) * w, Math.cos(a) * w];
  // every other child stands at the play equipment
  const still = k % 2 === 1 && Math.floor(t - m.kidsAt) % 2 === 0;
  return { p, yaw: yawOf(dir), walk: !still };
}

export interface MoveInPart extends DevsimPart {
  boxes(): number;
  parkedCars(): number;
}

/**
 * The move-in props: the box stack at the door (one instanced draw) and the cars parking in the
 * tower car park (one instanced kit mesh per A4 variant: compact hatch, micro hatch, small sedan,
 * MPV). Decorative.
 */
export function createMoveIn(o: {
  geom: SiteGeom;
  timing: SetPieceTiming;
  roleUniforms: RoleUniforms;
  lib?: AssetLibrary | null;
  manifest?: Manifest | null;
}): MoveInPart {
  const { geom: g } = o;
  const m = o.timing.moveIn;
  const group = new THREE.Group();
  group.name = "devsim-move-in";
  group.raycast = () => {};
  const disposers: (() => void)[] = [];
  const boxGeo = new THREE.BoxGeometry(BOX_M, BOX_M, BOX_M);
  const boxMat = new THREE.MeshStandardMaterial({
    color: DEVSIM_COLOURS.castSkinTan,
    roughness: 0.85,
  });
  const boxes = new THREE.InstancedMesh(boxGeo, boxMat, BOXES);
  boxes.name = "devsim-move-in-boxes";
  // small props: no shadow pass (AC-P2 draw budget)
  boxes.castShadow = false;
  boxes.receiveShadow = true;
  boxes.frustumCulled = false;
  boxes.raycast = () => {};
  boxes.count = 0;
  disposers.push(
    () => boxGeo.dispose(),
    () => boxMat.dispose(),
    () => boxes.dispose(),
  );
  const _m = new THREE.Matrix4();
  boxSlots(g).forEach((b, k) => {
    place(_m, b[0], b[1], b[2], (k % 5) * 0.07);
    boxes.setMatrixAt(k, _m);
  });
  boxes.instanceMatrix.needsUpdate = true;
  group.add(boxes);

  const pal: [string, string, string][] = [
    [DEVSIM_COLOURS.coral, DEVSIM_COLOURS.slate, DEVSIM_COLOURS.glass],
    [DEVSIM_COLOURS.offWhite, DEVSIM_COLOURS.slate, DEVSIM_COLOURS.glass],
    [DEVSIM_COLOURS.blue, DEVSIM_COLOURS.slate, DEVSIM_COLOURS.glass],
    [DEVSIM_COLOURS.slateBlue, DEVSIM_COLOURS.slate, DEVSIM_COLOURS.glass],
    ...kitPalettes(o.manifest, "vehicles"),
  ];
  const perVariant = Math.ceil(PARKED_CARS / CAR_VARIANTS.length);
  const cars = CAR_VARIANTS.map((v) => {
    const k = kitMesh({
      lib: o.lib,
      manifest: o.manifest,
      uniforms: o.roleUniforms,
      asset: "vehicles",
      variant: v,
      count: perVariant,
      palettes: pal,
      box: CAR_BOX[v],
      kind: "vehicle",
      castShadow: false,
    });
    k.mesh.name = `devsim-move-in-${v}`;
    disposers.push(k.dispose);
    group.add(k.mesh);
    return k;
  });
  let nBoxes = 0;
  let nParked = 0;
  let nCars = 0;
  const carPts: [number, number, number][] = Array.from({ length: PARKED_CARS }, () => [
    Number.NaN,
    0,
    0,
  ]);

  return {
    group,
    boxes: () => nBoxes,
    parkedCars: () => nParked,
    vehicles: () => carPts,
    demoState: () => ({ boxes: nBoxes, parkedCars: nParked, cars: nCars }),
    update({ t }: DevsimFrame) {
      nBoxes = boxesShown(m, t);
      boxes.count = nBoxes;
      const counts = CAR_VARIANTS.map(() => 0);
      nParked = 0;
      nCars = 0;
      for (let k = 0; k < PARKED_CARS; k++) {
        const c = carAt(g, m, k, t);
        const pt = carPts[k] as [number, number, number];
        if (!c) {
          pt[0] = Number.NaN;
          continue;
        }
        const vi = k % CAR_VARIANTS.length;
        (cars[vi] as (typeof cars)[number]).set(
          counts[vi] as number,
          place(_m, c.pose.x, 0.05, c.pose.z, Math.atan2(c.pose.dir[0], c.pose.dir[1])),
          k,
        );
        counts[vi] = (counts[vi] as number) + 1;
        pt[0] = c.pose.x;
        pt[1] = 0.8;
        pt[2] = c.pose.z;
        nCars++;
        if (c.parked) nParked++;
      }
      cars.forEach((c, i) => {
        c.setCount(counts[i] as number);
      });
    },
    dispose() {
      for (const d of disposers) d();
      disposers.length = 0;
      group.clear();
    },
  };
}
