import * as THREE from "three";
import { DEVSIM_COLOURS } from "../shared/clayTokens";
import type { DevsimFrame, DevsimPart } from "./devsimLayer";
import { ease } from "./ease";
import { inRing, type SiteGeom, type XZ } from "./geom";

const NOOP = () => {};
/** Pile grid spacing and the inset from the footprint edge (m). */
const PILE_GAP_M = 6;
const PILE_INSET_M = 2;
/** Of each pile's share of the window: the first part drives over, the rest drives the pile. */
const TRAVEL_SHARE = 0.35;
const MAST_M = 18;
const HAMMER_M = 2.4;

/**
 * The pile points (pure): a grid over the footprint (PILE_GAP_M apart, PILE_INSET_M inside its
 * edge), in serpentine order so the rig drives short hops. Always at least the centre.
 */
export function pileGrid(g: SiteGeom): XZ[] {
  const xs = g.ring.map((p) => p[0]);
  const zs = g.ring.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const rows: XZ[][] = [];
  for (let z = z0 + PILE_INSET_M; z <= z1 - PILE_INSET_M + 1e-6; z += PILE_GAP_M) {
    const row: XZ[] = [];
    for (let x = x0 + PILE_INSET_M; x <= x1 - PILE_INSET_M + 1e-6; x += PILE_GAP_M) {
      // inside the ring with the inset all round (probe the four inset neighbours)
      const ok = [
        [0, 0],
        [PILE_INSET_M, 0],
        [-PILE_INSET_M, 0],
        [0, PILE_INSET_M],
        [0, -PILE_INSET_M],
      ].every(([dx, dz]) => inRing(g.ring, x + (dx as number), z + (dz as number)));
      if (ok) row.push([x, z]);
    }
    if (row.length > 0) rows.push(rows.length % 2 ? row.reverse() : row);
  }
  const out = rows.flat();
  return out.length > 0 ? out : [[...g.centre] as XZ];
}

/**
 * The rig at progress u (0..1 over its window; pure): where it stands, its heading, the hammer
 * height (0 = on the pile, 1 = raised) and how many piles are driven.
 */
export function rigAt(
  piles: readonly XZ[],
  u: number,
): { p: XZ; yaw: number; hammer: number; driven: number } {
  const n = piles.length;
  const x = Math.max(0, Math.min(1, u)) * n;
  const i = Math.min(n - 1, Math.floor(x));
  const f = x - i;
  const cur = piles[i] as XZ;
  const prev = (piles[Math.max(0, i - 1)] as XZ) ?? cur;
  const dx = cur[0] - prev[0];
  const dz = cur[1] - prev[1];
  const yaw = Math.hypot(dx, dz) > 0.1 ? Math.atan2(dx, dz) : 0;
  if (f < TRAVEL_SHARE && i > 0) {
    const k = ease(f / TRAVEL_SHARE);
    return {
      p: [prev[0] + dx * k, prev[1] + dz * k],
      yaw,
      hammer: 1,
      driven: i,
    };
  }
  // drive: the hammer drops and lifts a few times
  const w = (f - TRAVEL_SHARE) / (1 - TRAVEL_SHARE);
  const hammer = 0.5 + 0.5 * Math.cos(Math.max(0, w) * Math.PI * 6);
  return { p: cur, yaw, hammer, driven: u >= 1 ? n : i + (w >= 0.99 ? 1 : 0) };
}

/**
 * The piling rig (spec §6.2 "piling rig in the foundation phase", C9 step 1, AC-W4): a tracked
 * base and cab with a leader mast and a drop hammer that drives between the pile points on the
 * footprint grid during the piling window; driven piles leave a stub until the first floor covers
 * them. Decorative. Four draws (body, mast, hammer, pile stubs).
 */
export function createPilingRig(o: { geom: SiteGeom }): DevsimPart & { piles: readonly XZ[] } {
  const piles = pileGrid(o.geom);
  const group = new THREE.Group();
  group.name = "devsim-piling";
  group.raycast = NOOP;
  const disposers: (() => void)[] = [];
  const own = <T extends { dispose(): void }>(x: T) => {
    disposers.push(() => x.dispose());
    return x;
  };
  const red = own(new THREE.MeshStandardMaterial({ color: DEVSIM_COLOURS.rigRed, roughness: 0.6 }));
  const steel = own(
    new THREE.MeshStandardMaterial({ color: DEVSIM_COLOURS.rigSteel, roughness: 0.5 }),
  );
  const rig = new THREE.Group();
  rig.name = "devsim-piling-rig";
  group.add(rig);
  // base (tracks + deck) and cab as one body; the leader mast stands at the front (+z)
  const body = (() => {
    const tracks = new THREE.BoxGeometry(4.2, 1, 6).translate(0, 0.5, 0);
    const cab = new THREE.BoxGeometry(2.6, 2.2, 3).translate(0, 2.1, -1);
    const pos: number[] = [];
    for (const g of [tracks, cab]) {
      const ng = g.toNonIndexed();
      pos.push(...(ng.getAttribute("position").array as Float32Array));
      ng.dispose();
      g.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  })();
  const bodyMesh = new THREE.Mesh(own(body), red);
  const mast = new THREE.Mesh(
    own(new THREE.BoxGeometry(0.8, MAST_M, 0.8).translate(0, MAST_M / 2 + 1, 3.4)),
    steel,
  );
  const hammer = new THREE.Mesh(
    own(new THREE.BoxGeometry(1.2, HAMMER_M, 1.2).translate(0, HAMMER_M / 2, 0)),
    steel,
  );
  hammer.position.set(0, 0, 3.4);
  for (const m of [bodyMesh, mast, hammer]) {
    m.castShadow = true;
    m.raycast = NOOP;
    rig.add(m);
  }
  const stubs = own(
    new THREE.InstancedMesh(
      own(new THREE.CylinderGeometry(0.45, 0.45, 0.6, 8).translate(0, 0.3, 0)),
      steel,
      piles.length,
    ),
  );
  stubs.name = "devsim-piles";
  stubs.frustumCulled = false;
  stubs.raycast = NOOP;
  stubs.count = 0;
  {
    const m = new THREE.Matrix4();
    piles.forEach((p, i) => {
      stubs.setMatrixAt(i, m.makeTranslation(p[0], 0, p[1]));
    });
  }
  group.add(stubs);
  let visible = false;
  let driven = 0;

  return {
    group,
    piles,
    demoState: () => ({ rig: { visible, piles: piles.length, driven } }),
    update({ s, t, sp }: DevsimFrame) {
      visible = !!sp?.piling;
      rig.visible = visible;
      // piles driven: a pure function of t (seek safe): none before the window, all after it
      const w = sp?.timing.piling;
      driven = !w || t < w[0] ? 0 : t >= w[1] ? piles.length : 0;
      if (visible && sp) {
        const r = rigAt(piles, sp.pilingU);
        // the mast stands over the pile: the body sits behind it
        rig.position.set(r.p[0] - Math.sin(r.yaw) * 3.4, 0.05, r.p[1] - Math.cos(r.yaw) * 3.4);
        rig.rotation.y = r.yaw;
        hammer.position.y = 0.6 + r.hammer * (MAST_M - HAMMER_M - 1);
        driven = r.driven;
      }
      // stubs: driven piles until the first floor covers the footprint
      stubs.count = s.floorsBuilt < 0.5 ? Math.min(piles.length, driven) : 0;
      group.visible = visible || stubs.count > 0;
    },
    dispose() {
      for (const d of disposers) d();
      disposers.length = 0;
      group.clear();
    },
  };
}
