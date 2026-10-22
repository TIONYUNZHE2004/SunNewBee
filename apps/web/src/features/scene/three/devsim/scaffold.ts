import * as THREE from "three";
import { DEVSIM_COLOURS } from "../shared/clayTokens";
import type { DevsimFrame, DevsimPart } from "./devsimLayer";
import { createShadowFade } from "./devsimView";
import { type SiteGeom, TOWER_STOREY_M, type XZ } from "./geom";

const NOOP = () => {};
/** The scaffold stands this far out from the facade; the netting a little further. */
const SCAFFOLD_OUT_M = 1.2;
const NET_OUT_M = 1.5;
/** Standards (vertical tubes) along each face, at most this far apart. */
const STANDARD_GAP_M = 3;
const TUBE_M = 0.14;
const NET_OPACITY = 0.45;

/**
 * The scaffold's extent (pure): the tower has no podium, so the scaffold starts on the lobby
 * storey's top (the "podium top", 1 storey: the entrance stays clear) and reaches the top built
 * floor + 1 floor (AC-W4). `topFloor` = floors drawn (rounded up, as the tower draws them).
 */
export function scaffoldExtent(
  floorsBuilt: number,
  storeys: number,
): { topFloor: number; base: number; top: number } {
  const built = Math.max(0, Math.min(storeys, floorsBuilt));
  const topFloor = Math.max(0, Math.ceil(built - 1e-6));
  return { topFloor, base: TOWER_STOREY_M, top: (topFloor + 1) * TOWER_STOREY_M };
}

/** The ring grown by `d` metres about its centre (the footprint is convex). */
function grow(ring: readonly XZ[], c: XZ, d: number): XZ[] {
  return ring.map(([x, z]) => {
    const dx = x - c[0];
    const dz = z - c[1];
    const l = Math.hypot(dx, dz) || 1;
    return [x + (dx / l) * d, z + (dz / l) * d];
  });
}

/** Open side walls over a ring from y 0 to 1 (no caps), scaled in y to the netting height. */
function wallsGeometry(ring: readonly XZ[]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as XZ;
    const b = ring[(i + 1) % ring.length] as XZ;
    pos.push(
      a[0],
      0,
      a[1],
      b[0],
      0,
      b[1],
      b[0],
      1,
      b[1],
      a[0],
      0,
      a[1],
      b[0],
      1,
      b[1],
      a[0],
      1,
      a[1],
    );
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export interface ScaffoldPart extends DevsimPart {
  /** Top of the scaffold now (m; 0 when not shown). */
  topM(): number;
  /** Floors drawn now (the top built floor). */
  topFloor(): number;
  nettingVisible(): boolean;
}

/**
 * Scaffold and green netting (spec §6.2 Construction detail, C9 step 4, AC-W4): a box frame of
 * tubes (standards at the corners and every ~3 m, ledgers at each floor) and translucent green
 * netting round the tower from the podium top to the top built floor + 1 floor. It rises with the
 * floors while building and is removed at Handover (when the hoarding comes down). Decorative.
 * Three draws: standards, ledgers (instanced unit tubes) and the netting.
 */
export function createScaffold(o: { geom: SiteGeom }): ScaffoldPart {
  const { geom } = o;
  const N = geom.storeys;
  const group = new THREE.Group();
  group.name = "devsim-scaffold";
  group.raycast = NOOP;
  const disposers: (() => void)[] = [];
  const own = <T extends { dispose(): void }>(x: T) => {
    disposers.push(() => x.dispose());
    return x;
  };
  const ring = grow(geom.ring, geom.centre, SCAFFOLD_OUT_M);
  const tubeMat = own(
    new THREE.MeshStandardMaterial({ color: DEVSIM_COLOURS.scaffoldTube, roughness: 0.7 }),
  );

  // standards: unit-height tubes at the corners and along each face (scaled to the height)
  const posts: XZ[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as XZ;
    const b = ring[(i + 1) % ring.length] as XZ;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(L / STANDARD_GAP_M));
    for (let k = 0; k < n; k++)
      posts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  const standards = own(
    new THREE.InstancedMesh(
      own(new THREE.BoxGeometry(TUBE_M, 1, TUBE_M).translate(0, 0.5, 0)),
      tubeMat,
      Math.max(1, posts.length),
    ),
  );
  standards.name = "devsim-scaffold-standards";
  // ledgers: a unit-length tube along +x per face per floor level (base .. top), scaled per face
  const levels = N + 2;
  const ledgers = own(
    new THREE.InstancedMesh(
      own(new THREE.BoxGeometry(1, TUBE_M, TUBE_M).translate(0.5, 0, 0)),
      tubeMat,
      Math.max(1, ring.length * levels),
    ),
  );
  ledgers.name = "devsim-scaffold-ledgers";
  // thin tubes: shadows in the close beats only, faded with the camera range (set per frame)
  const fade = own(createShadowFade());
  for (const m of [standards, ledgers]) {
    m.frustumCulled = false;
    m.raycast = NOOP;
    m.castShadow = false;
    fade.attach(m);
    m.count = 0;
    group.add(m);
  }
  const net = new THREE.Mesh(
    own(wallsGeometry(grow(geom.ring, geom.centre, NET_OUT_M))),
    own(
      new THREE.MeshStandardMaterial({
        color: DEVSIM_COLOURS.netting,
        roughness: 1,
        transparent: true,
        opacity: NET_OPACITY,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    ),
  );
  net.name = "devsim-netting";
  net.raycast = NOOP;
  net.renderOrder = 3;
  group.add(net);

  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _y = new THREE.Vector3(0, 1, 0);
  let top = 0;
  let floor = 0;
  let netOn = false;
  let shownFloor = -1;

  const pose = (topFloor: number, base: number, h: number) => {
    if (topFloor === shownFloor) return;
    shownFloor = topFloor;
    posts.forEach((p, i) => {
      _m.compose(_p.set(p[0], base, p[1]), _q.identity(), _s.set(1, h, 1));
      standards.setMatrixAt(i, _m);
    });
    standards.count = posts.length;
    standards.instanceMatrix.needsUpdate = true;
    let n = 0;
    const lv = Math.round(h / TOWER_STOREY_M);
    for (let k = 0; k <= lv; k++) {
      const y = base + k * TOWER_STOREY_M;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i] as XZ;
        const b = ring[(i + 1) % ring.length] as XZ;
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        _q.setFromAxisAngle(_y, Math.atan2(-(b[1] - a[1]), b[0] - a[0]));
        _m.compose(_p.set(a[0], y, a[1]), _q, _s.set(L, 1, 1));
        if (n < ring.length * levels) ledgers.setMatrixAt(n++, _m);
      }
    }
    ledgers.count = n;
    ledgers.instanceMatrix.needsUpdate = true;
    net.position.y = base;
    net.scale.y = h;
  };

  return {
    group,
    topM: () => top,
    topFloor: () => floor,
    nettingVisible: () => netOn,
    demoState: () => ({ scaffoldTop: top, topFloor: floor, netting: netOn }),
    aoExcluded: () => [net],
    update({ s, t, sp }: DevsimFrame) {
      fade.set(s);
      const ext = scaffoldExtent(s.floorsBuilt, N);
      floor = ext.topFloor;
      // up while building, once there is a floor: schedule mode (C7 45 s acts) until Handover
      // starts (SET_PIECE_S.moveIn.t0); legacy while the timeline is in Construction behind the
      // hoarding
      const building =
        sp?.timing.mode === "schedule"
          ? t < sp.timing.moveIn.t0
          : s.act === "Construction" && s.hoarding;
      const on = building && ext.topFloor > 0;
      group.visible = on;
      // the netting wraps the floors still being built: it comes off at topping out (AC-W4:
      // visible only while floors < total); the scaffold itself stays until Handover
      netOn = on && s.floorsBuilt < N - 1e-6;
      net.visible = netOn;
      top = on ? ext.top : 0;
      if (on) pose(ext.topFloor, ext.base, ext.top - ext.base);
    },
    dispose() {
      for (const d of disposers) d();
      disposers.length = 0;
      group.clear();
    },
  };
}
