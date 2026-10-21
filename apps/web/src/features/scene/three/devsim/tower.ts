import * as THREE from "three";
import type { AssetLibrary } from "../assets/library";
import type { Manifest } from "../assets/manifest";
import { createRoleMaterial, type RoleUniforms } from "../assets/roleMaterial";
import { facadeInstances } from "../facade/facadePlan";
import { CLAY_PALETTE, DEVSIM_COLOURS } from "../shared/clayTokens";
import type { DevsimFrame, TowerPart } from "./devsimLayer";
import { type SiteGeom, TOWER_STOREY_M, type XZ } from "./geom";

const NOOP = () => {};
/** Role 3 (glass) in COLOR_0.g, as the facade layer writes it. */
const GLASS_G = 3 / 7;
/** Floors under construction at the top of a rising tower stay raw concrete (prototype). */
const RAW_FLOORS = 3;
const SLAB_GAP_M = 0.25;
const RAW_PALETTE: [string, string, string] = [
  DEVSIM_COLOURS.towerA,
  DEVSIM_COLOURS.towerB,
  DEVSIM_COLOURS.grey,
];
/** Lobby canopy / roof accent (the prototype's teal). */
const ACCENT = DEVSIM_COLOURS.towerAccent;

/** COLOR_0 = (AO 1, role, seed 1) on every vertex: role 0 wall / 1 roof / 2 accent / 3 glass. */
function roleColour(g: THREE.BufferGeometry, role: number): THREE.BufferGeometry {
  const n = g.getAttribute("position").count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([1, role / 7, 1], i * 3);
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** A prism over the ring from y 0 to `h` (local x/z ring, any winding). */
export function prism(ring: readonly XZ[], h: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  return roleColour(g.index ? g.toNonIndexed() : g, 0);
}

/** The ring grown (or shrunk) by `d` metres about its centre (fine for the convex footprint). */
function grow(ring: readonly XZ[], c: XZ, d: number): XZ[] {
  return ring.map(([x, z]) => {
    const dx = x - c[0];
    const dz = z - c[1];
    const l = Math.hypot(dx, dz) || 1;
    return [x + (dx / l) * d, z + (dz / l) * d];
  });
}

/** Per-floor lighting order (deterministic shuffle of the floors): floors light in this rank. */
export function litRank(storeys: number): number[] {
  const order = Array.from({ length: storeys }, (_, i) => i);
  let h = 2166136261;
  for (let i = order.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (i + 7), 16777619) >>> 0;
    const j = h % (i + 1);
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  const rank = new Array<number>(storeys);
  order.forEach((floor, r) => {
    rank[floor] = r;
  });
  return rank;
}

export interface TowerOpts {
  geom: SiteGeom;
  /** The city's role uniforms (AO strength, light glow); the tower keeps its own window glow. */
  roleUniforms: RoleUniforms;
  lib?: AssetLibrary | null;
  manifest?: Manifest | null;
}

/**
 * The hypothetical tower (spec §5.3 Tower): instanced floor slabs over the plan's footprint that
 * rise with `floorsBuilt` (raw concrete on the top floors while building, a scaffold band above),
 * window quads from the city facade plan in the shared role material, a roof cap once topped out,
 * and the lobby entrance (glass doors, a canopy on posts, a paved path). Its windows have their own
 * glow and lit-share uniforms: dark (exactly 0) until `windowsLitFraction` rises in Handover, then
 * lit floor by floor; no site light ever reaches them (the floodlights are emissive pools, not
 * lights). Decorative.
 */
export function createTower(o: TowerOpts): TowerPart & {
  /** The tower's own window uniforms (tests: Q4). */
  windowUniforms: RoleUniforms;
  /** Floors drawn now (finished + raw). */
  floorsShown(): number;
} {
  const { geom } = o;
  const N = geom.storeys;
  const SH = TOWER_STOREY_M;
  const group = new THREE.Group();
  group.name = "devsim-tower";
  group.raycast = NOOP;
  const disposers: (() => void)[] = [];
  const own = <T extends { dispose(): void }>(x: T) => {
    disposers.push(() => x.dispose());
    return x;
  };
  const palette = (o.manifest?.assets.highrise?.palettes.default?.[0] ?? [
    CLAY_PALETTE.neutral.wall,
    CLAY_PALETTE.neutral.roof,
    CLAY_PALETTE.neutral.trim,
  ]) as [string, string, string];

  // --- floor slabs: finished and raw (two instanced meshes over one slab geometry)
  const slabGeo = own(prism(geom.ring, SH - SLAB_GAP_M));
  const finishedMat = own(
    createRoleMaterial({ instanced: false, uniforms: o.roleUniforms, palette }),
  );
  const rawMat = own(
    createRoleMaterial({ instanced: false, uniforms: o.roleUniforms, palette: RAW_PALETTE }),
  );
  const finished = own(new THREE.InstancedMesh(slabGeo, finishedMat, N));
  const raw = own(new THREE.InstancedMesh(slabGeo, rawMat, N));
  for (const m of [finished, raw]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.count = 0;
    m.frustumCulled = false;
    m.raycast = NOOP;
    group.add(m);
  }
  finished.name = "devsim-floors";
  raw.name = "devsim-floors-raw";

  // --- windows: the facade plan's quads for the full tower, sorted bottom up (floor order)
  const windowUniforms: RoleUniforms = {
    uWindowGlow: { value: 0 },
    uLitShare: { value: 0 },
    uLightGlow: o.roleUniforms.uLightGlow,
    uAoStrength: o.roleUniforms.uAoStrength,
    uFlicker: { value: 0 },
  };
  const fac = facadeInstances(geom.ring, N * SH, 0, {
    buildingId: "devsim-tower",
    storeys: N,
    windowStyle: 1,
    bayM: 3.2,
    groundFloor: "plain",
    palette: CLAY_PALETTE.neutral,
  });
  const order = Array.from({ length: fac.count }, (_, i) => i).sort(
    (a, b) => (fac.windows[a * 16 + 13] as number) - (fac.windows[b * 16 + 13] as number),
  );
  const rank = litRank(N);
  /** Windows below the top of floor k: winUpTo[k] (k = 0..N). */
  const winUpTo = new Array<number>(N + 1).fill(0);
  const quad = own(new THREE.PlaneGeometry(1, 1));
  roleColour(quad, 0);
  {
    const c = quad.getAttribute("color") as THREE.BufferAttribute;
    for (let i = 0; i < c.count; i++) c.setY(i, GLASS_G);
  }
  const winMat = own(createRoleMaterial({ instanced: false, uniforms: windowUniforms }));
  winMat.polygonOffset = true;
  winMat.polygonOffsetFactor = -1;
  winMat.polygonOffsetUnits = -1;
  const windows = own(new THREE.InstancedMesh(quad, winMat, Math.max(1, fac.count)));
  windows.name = "devsim-windows";
  windows.raycast = NOOP;
  windows.frustumCulled = false;
  windows.castShadow = false;
  const seeds = new Float32Array(Math.max(1, fac.count) * 3);
  order.forEach((src, i) => {
    windows.instanceMatrix.array.set(fac.windows.subarray(src * 16, src * 16 + 16), i * 16);
    const y = fac.windows[src * 16 + 13] as number;
    const floor = Math.max(0, Math.min(N - 1, Math.floor(y / SH)));
    // a floor's windows share a seed in (0, 1): lit when its rank is under the lit share
    seeds.set([1, 1, ((rank[floor] as number) + 0.5) / N], i * 3);
    for (let k = floor + 1; k <= N; k++) winUpTo[k] = i + 1;
  });
  windows.instanceColor = new THREE.InstancedBufferAttribute(seeds, 3);
  windows.instanceMatrix.needsUpdate = true;
  windows.count = 0;
  group.add(windows);

  // --- roof cap
  const roofMat = own(
    createRoleMaterial({
      instanced: false,
      uniforms: o.roleUniforms,
      palette: [ACCENT, ACCENT, palette[2]],
    }),
  );
  const roof = own(new THREE.Mesh(own(prism(grow(geom.ring, geom.centre, 0.4), 0.9)), roofMat));
  roof.name = "devsim-roof";
  roof.position.y = N * SH;
  roof.castShadow = true;
  roof.visible = false;
  group.add(roof);

  // --- scaffold band: kit scaffold bays round the top floors while building, else a frame
  const scaffold = new THREE.Group();
  scaffold.name = "devsim-scaffold";
  group.add(scaffold);
  {
    const bayGeo = o.lib?.geometry("construction", "scaffold_bay", 0) ?? null;
    const ring = grow(geom.ring, geom.centre, 1.2);
    const mats: THREE.Matrix4[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i] as XZ;
      const b = ring[(i + 1) % ring.length] as XZ;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.round(L / 2.5));
      const yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5) / n;
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(a[0] + (b[0] - a[0]) * u, 0, a[1] + (b[1] - a[1]) * u),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
          new THREE.Vector3(L / n / 2.5, 1, 1),
        );
        mats.push(m);
      }
    }
    if (bayGeo) {
      const pal = o.manifest?.assets.construction?.palettes.default?.[0] as
        | [string, string, string]
        | undefined;
      const mat = own(
        createRoleMaterial({
          instanced: false,
          uniforms: o.roleUniforms,
          ...(pal ? { palette: pal } : {}),
        }),
      );
      const im = own(new THREE.InstancedMesh(bayGeo, mat, mats.length));
      mats.forEach((m, i) => {
        im.setMatrixAt(i, m);
      });
      im.frustumCulled = false;
      im.raycast = NOOP;
      scaffold.add(im);
    } else {
      const box = own(
        new THREE.EdgesGeometry(
          own(prism(grow(geom.ring, geom.centre, 1.2), SH * 2) as THREE.BufferGeometry),
        ),
      );
      const lines = new THREE.LineSegments(
        box,
        own(new THREE.LineBasicMaterial({ color: DEVSIM_COLOURS.scaffoldLine })),
      );
      scaffold.add(lines);
    }
  }

  // --- entrance: glass doors, canopy on posts, door mat, paved path (built from the door frame)
  const entrance = new THREE.Group();
  entrance.name = "devsim-entrance";
  group.add(entrance);
  const pathGroup = new THREE.Group();
  pathGroup.name = "devsim-entrance-path";
  group.add(pathGroup);
  const doorMat = own(
    new THREE.MeshStandardMaterial({
      color: DEVSIM_COLOURS.windowDark,
      roughness: 0.2,
      emissive: DEVSIM_COLOURS.windowGlow,
      emissiveIntensity: 0.1,
    }),
  );
  {
    const add = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
    ) => {
      const m = new THREE.Mesh(own(geo), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      entrance.add(m);
      return m;
    };
    const white = own(
      new THREE.MeshStandardMaterial({ color: DEVSIM_COLOURS.offWhite, roughness: 0.7 }),
    );
    const teal = own(new THREE.MeshStandardMaterial({ color: ACCENT, roughness: 0.6 }));
    const mat = own(
      new THREE.MeshStandardMaterial({ color: DEVSIM_COLOURS.hoardingNavy, roughness: 0.9 }),
    );
    // local frame of the door: +x out of the lobby, z along the face
    add(new THREE.BoxGeometry(0.5, 3, 4.2), doorMat, 0.1, 1.6, 0);
    add(new THREE.BoxGeometry(0.6, 0.25, 4.6), white, 0.12, 3.2, 0);
    add(new THREE.BoxGeometry(3.6, 0.35, 7), teal, 1.8, 3.9, 0);
    for (const z of [-3, 3])
      add(new THREE.CylinderGeometry(0.14, 0.14, 3.8, 8), white, 3.3, 1.95, z);
    add(new THREE.BoxGeometry(2.4, 0.06, 1.1), mat, 1.2, 0.05, 0);
    entrance.position.set(geom.door[0], 0, geom.door[1]);
    // +x of the group onto `out`
    entrance.rotation.y = Math.atan2(-geom.out[1], geom.out[0]);
    // paved path, door -> walk node (3 m wide, kerb edges), above the ground with polygonOffset
    const paving = own(
      new THREE.MeshStandardMaterial({
        color: DEVSIM_COLOURS.hoardingPale,
        roughness: 0.9,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    const kerb = own(
      new THREE.MeshStandardMaterial({ color: DEVSIM_COLOURS.kerbSand, roughness: 0.9 }),
    );
    for (let i = 1; i < geom.path.length; i++) {
      const a = geom.path[i - 1] as XZ;
      const b = geom.path[i] as XZ;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.05) continue;
      const yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
      const mid: XZ = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const slab = new THREE.Mesh(own(new THREE.BoxGeometry(L, 0.08, 3)), paving);
      slab.position.set(mid[0], 0.06, mid[1]);
      slab.rotation.y = yaw;
      slab.receiveShadow = true;
      pathGroup.add(slab);
      for (const s of [-1.65, 1.65]) {
        const e = new THREE.Mesh(own(new THREE.BoxGeometry(L, 0.14, 0.3)), kerb);
        e.position.set(mid[0] - Math.sin(yaw) * s, 0.08, mid[1] - Math.cos(yaw) * s);
        e.rotation.y = yaw;
        pathGroup.add(e);
      }
    }
  }

  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  let top = 0;
  let lit = 0;
  let shown = 0;

  return {
    group,
    windowUniforms,
    topM: () => top,
    litFraction: () => lit,
    floorsShown: () => shown,
    update({ s, t, night }: DevsimFrame) {
      const built = Math.max(0, Math.min(N, s.floorsBuilt));
      const n = Math.max(0, Math.ceil(built - 1e-6));
      const building = built < N - 1e-3 && s.act === "Construction";
      const nRaw = building ? Math.min(n, RAW_FLOORS) : 0;
      const nFin = n - nRaw;
      finished.count = nFin;
      raw.count = nRaw;
      for (let i = 0; i < n; i++) {
        const partial = i === n - 1 ? Math.max(0.05, built - i) : 1;
        _p.set(0, i * SH, 0);
        _s.set(1, Math.min(1, partial), 1);
        _m.compose(_p, _q.identity(), _s);
        if (i < nFin) finished.setMatrixAt(i, _m);
        else raw.setMatrixAt(i - nFin, _m);
      }
      finished.instanceMatrix.needsUpdate = true;
      raw.instanceMatrix.needsUpdate = true;
      shown = n;
      top = n > 0 ? Math.min(built, n) * SH || SH : 0;
      windows.count = winUpTo[nFin] ?? 0;
      roof.visible = built >= N - 1e-3;
      scaffold.visible = building && n > 0;
      scaffold.position.y = Math.max(0, top - SH * 2);
      entrance.visible = built >= 1;
      // the paved path is laid at Handover (the hoarding comes down)
      pathGroup.visible = !s.hoarding || s.act === "Handover" || s.act === "Daily Life";
      // Q4: exactly 0 until the timeline lights floors in Handover; then lit floor by floor, a
      // little glow by day (occupied homes read as lit, as in the prototype), kept under the city windows at night (a fully lit face blooms white)
      lit = Math.max(0, Math.min(1, s.windowsLitFraction));
      windowUniforms.uLitShare.value = lit;
      windowUniforms.uWindowGlow.value = lit > 0 ? 0.2 + 0.6 * night : 0;
      doorMat.emissiveIntensity = n > 0 ? 0.1 + night * 1.4 : 0.1;
      void t;
    },
    dispose() {
      for (const d of disposers) d();
      disposers.length = 0;
      group.clear();
    },
  };
}
