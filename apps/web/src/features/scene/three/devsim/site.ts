import * as THREE from "three";
import type { AssetLibrary } from "../assets/library";
import type { Manifest } from "../assets/manifest";
import type { RoleUniforms } from "../assets/roleMaterial";
import type { DevsimFrame, DevsimPart } from "./devsimLayer";
import { along, distToLine, lengthOf, type SiteGeom, type XZ } from "./geom";
import { kitMesh, kitPalettes, place } from "./kit";
import { ease, span } from "./stubStateAt";

const NOOP = () => {};
const HOARD_M = 6;
const CRANE_TOP_M = 50;
const STACKS = 5;
const LORRIES = 3;
const QUEUE = 8;
/** Hoarding is kept to the closed edge within this distance of the tower centre. */
const CLOSED_REACH_M = 140;

const sub = (a: XZ, b: XZ): XZ => [a[0] - b[0], a[1] - b[1]];
const unit = (a: XZ): XZ => {
  const l = Math.hypot(a[0], a[1]) || 1;
  return [a[0] / l, a[1] / l];
};
/** Yaw that turns a kit model's +x onto ground direction d. */
const yawX = (d: XZ) => Math.atan2(-d[1], d[0]);
/** Yaw that turns a model's +z (vehicle forward) onto ground direction d. */
const yawZ = (d: XZ) => Math.atan2(d[0], d[1]);

/** A flat ribbon along a polyline at height y (optionally dashed), as one merged geometry. */
export function ribbonGeometry(
  pts: readonly XZ[],
  w: number,
  y: number,
  dash = 0,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const seg = (a: XZ, b: XZ) => {
    const d = sub(b, a);
    const L = Math.hypot(d[0], d[1]);
    if (L < 0.05) return;
    const n: XZ = [(-d[1] / L) * (w / 2), (d[0] / L) * (w / 2)];
    const p = [
      [a[0] + n[0], a[1] + n[1]],
      [a[0] - n[0], a[1] - n[1]],
      [b[0] - n[0], b[1] - n[1]],
      [b[0] + n[0], b[1] + n[1]],
    ] as XZ[];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const q = p[k] as XZ;
      pos.push(q[0], y, q[1]);
    }
  };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as XZ;
    const b = pts[i] as XZ;
    if (!dash) {
      seg(a, b);
      continue;
    }
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let s = 0; s < L; s += dash * 2) {
      const u0 = s / L;
      const u1 = Math.min(1, (s + dash) / L);
      seg(
        [a[0] + (b[0] - a[0]) * u0, a[1] + (b[1] - a[1]) * u0],
        [a[0] + (b[0] - a[0]) * u1, a[1] + (b[1] - a[1]) * u1],
      );
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** The part of a polyline within `r` m of c (resampled every 2 m). */
function clipNear(pts: readonly XZ[], c: XZ, r: number): XZ[] {
  const L = lengthOf(pts);
  const out: XZ[] = [];
  for (let d = 0; d <= L; d += 2) {
    const { p } = along(pts, d);
    if (Math.hypot(p[0] - c[0], p[1] - c[1]) <= r) out.push(p);
  }
  return out;
}

/** The construction yard ring: a box in the (out, side) frame round the tower and its yard. */
export function yardRing(g: SiteGeom): XZ[] {
  const R = g.radius;
  const at = (o: number, s: number): XZ => [
    g.centre[0] + g.out[0] * o + g.side[0] * s,
    g.centre[1] + g.out[1] * o + g.side[1] * s,
  ];
  return [at(R + 4, -(R + 14)), at(R + 4, R + 14), at(-(R + 34), R + 14), at(-(R + 34), -(R + 14))];
}

export interface SiteOpts {
  geom: SiteGeom;
  roleUniforms: RoleUniforms;
  lib?: AssetLibrary | null;
  manifest?: Manifest | null;
}

/**
 * The construction site and street scene (spec §5.3 Construction kit, closed edge and detour, P4
 * scope 5-6): the kit's tower crane (slews by day, a blinking beacon at night) on a mast extension
 * that keeps its jib above the rising tower, hoarding along the yard and the closed frontage edge,
 * material stacks, a cement mixer (drum spins by day), a site cabin and floodlights (emissive pools
 * on the yard at night, no scene light, so nothing tints the tower). The closed edge is a red strip,
 * the detour a dashed blue strip (polygonOffset over the ground). At Handover the kit fades, three
 * lorries park where the entrance path meets the street, and in Daily Life the school-run queue
 * waits at the junction. Decorative.
 */
export function createSite(o: SiteOpts): DevsimPart {
  const { geom: g } = o;
  const group = new THREE.Group();
  group.name = "devsim-site";
  group.raycast = NOOP;
  const disposers: (() => void)[] = [];
  const own = <T extends { dispose(): void }>(x: T) => {
    disposers.push(() => x.dispose());
    return x;
  };
  const cPal = kitPalettes(o.manifest, "construction");
  const kit = (variant: string, count: number, box: [number, number, number], pal = cPal) => {
    const k = kitMesh({
      lib: o.lib,
      manifest: o.manifest,
      uniforms: o.roleUniforms,
      asset: "construction",
      variant,
      count,
      palettes: pal,
      box,
    });
    disposers.push(k.dispose);
    return k;
  };
  const _m = new THREE.Matrix4();

  // --- the yard: kit group (fades at Handover)
  const yard = new THREE.Group();
  yard.name = "devsim-yard";
  group.add(yard);

  // hoarding: the yard ring and the closed edge (offset to the site side)
  const hoardGroup = new THREE.Group();
  hoardGroup.name = "devsim-hoarding";
  group.add(hoardGroup);
  const runs: XZ[][] = [];
  const ring = yardRing(g);
  runs.push([...ring, ring[0] as XZ]);
  const closedNear = clipNear(g.closed, g.centre, CLOSED_REACH_M);
  if (closedNear.length >= 2) {
    // push the closed-edge hoarding 1.2 m towards the tower (it stands on the closed footway)
    runs.push(
      closedNear.map((p, i) => {
        const a = closedNear[Math.max(0, i - 1)] as XZ;
        const b = closedNear[Math.min(closedNear.length - 1, i + 1)] as XZ;
        const d = unit(sub(b, a));
        let n: XZ = [-d[1], d[0]];
        const toC = sub(g.centre, p);
        if (n[0] * toC[0] + n[1] * toC[1] < 0) n = [-n[0], -n[1]];
        return [p[0] + n[0] * 1.2, p[1] + n[1] * 1.2];
      }),
    );
  }
  const panels: THREE.Matrix4[] = [];
  for (const r of runs) {
    const L = lengthOf(r);
    for (let d = HOARD_M / 2; d < L; d += HOARD_M) {
      const a = along(r, d);
      panels.push(place(new THREE.Matrix4(), a.p[0], 0.05, a.p[1], yawX(a.dir)));
    }
  }
  const hoard = kit("hoarding_6m", panels.length, [6, 2.4, 0.2]);
  panels.forEach((m, i) => {
    hoard.set(i, m);
  });
  hoard.setCount(panels.length);
  hoardGroup.add(hoard.mesh);

  // material stacks (4-6 in the yard) and a site cabin
  const stacks = kit("material_stack", STACKS, [2.4, 1.2, 1.2]);
  const stackPts: XZ[] = [];
  for (let i = 0; i < STACKS; i++) {
    const s = (i - (STACKS - 1) / 2) * 7;
    const o2 = -4 + (i % 2) * 6;
    const p: XZ = [
      g.yard[0] + g.side[0] * s + g.out[0] * o2,
      g.yard[1] + g.side[1] * s + g.out[1] * o2,
    ];
    stackPts.push(p);
    stacks.set(i, place(_m, p[0], 0.05, p[1], yawX(g.side) + i * 0.4, 1.5));
  }
  stacks.setCount(STACKS);
  yard.add(stacks.mesh);
  const cabin = kit("site_cabin", 1, [2.4, 2.6, 6]);
  {
    const p: XZ = [
      g.yard[0] - g.out[0] * 12 + g.side[0] * (g.radius + 6),
      g.yard[1] - g.out[1] * 12 + g.side[1] * (g.radius + 6),
    ];
    cabin.set(0, place(_m, p[0], 0.05, p[1], yawX(g.out)));
    cabin.setCount(1);
  }
  yard.add(cabin.mesh);

  // tower crane on a mast extension (the kit crane is 50 m; the tower tops out near 96 m)
  const cranePos: XZ = [
    g.centre[0] + (g.yard[0] - g.centre[0]) * 0.75 + g.side[0] * (g.radius * 0.5),
    g.centre[1] + (g.yard[1] - g.centre[1]) * 0.75 + g.side[1] * (g.radius * 0.5),
  ];
  const craneGroup = new THREE.Group();
  craneGroup.name = "devsim-crane";
  craneGroup.position.set(cranePos[0], 0, cranePos[1]);
  yard.add(craneGroup);
  const craneHead = new THREE.Group();
  craneGroup.add(craneHead);
  const crane = kit("tower_crane", 1, [53, 50, 4]);
  crane.set(0, place(_m, 0, 0, 0, 0));
  crane.setCount(1);
  craneHead.add(crane.mesh);
  const yellow = own(new THREE.MeshStandardMaterial({ color: "#f4b942", roughness: 0.5 }));
  const mast = new THREE.Mesh(own(new THREE.BoxGeometry(1.8, 1, 1.8).translate(0, 0.5, 0)), yellow);
  mast.castShadow = true;
  craneGroup.add(mast);
  const beaconMat = own(new THREE.MeshBasicMaterial({ color: "#ff3b30", toneMapped: false }));
  const beacon = new THREE.Mesh(own(new THREE.SphereGeometry(0.7, 10, 8)), beaconMat);
  beacon.position.y = CRANE_TOP_M + 0.8;
  craneHead.add(beacon);

  // cement mixer (drawn here so its drum can spin)
  const mixer = new THREE.Group();
  mixer.name = "devsim-mixer";
  {
    const white = own(new THREE.MeshStandardMaterial({ color: "#f4f1ea", roughness: 0.7 }));
    const red = own(new THREE.MeshStandardMaterial({ color: "#e8644f", roughness: 0.7 }));
    const tyre = own(new THREE.MeshStandardMaterial({ color: "#2b2b2b", roughness: 0.9 }));
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      const me = new THREE.Mesh(own(geo), m);
      me.position.set(x, y, z);
      me.castShadow = true;
      mixer.add(me);
      return me;
    };
    add(new THREE.BoxGeometry(7, 1.2, 2.4), white, 0, 1.0, 0);
    add(new THREE.BoxGeometry(2, 1.6, 2.3), red, 3, 2.3, 0);
    for (const x of [-2.4, 2.6])
      for (const z of [-1, 1])
        add(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 12).rotateX(Math.PI / 2), tyre, x, 0.45, z);
    const drumMat = own(new THREE.MeshStandardMaterial({ color: "#f0b86a", roughness: 0.6 }));
    const stripeMat = own(new THREE.MeshStandardMaterial({ color: "#c66a3a", roughness: 0.6 }));
    const drum = new THREE.Group();
    drum.position.set(-1, 2.6, 0);
    drum.rotation.z = Math.PI / 2 - 0.25;
    const spin = new THREE.Group();
    drum.add(spin);
    const body = new THREE.Mesh(own(new THREE.CylinderGeometry(1.1, 0.8, 4, 14)), drumMat);
    body.castShadow = true;
    spin.add(body);
    const stripe = new THREE.Mesh(own(new THREE.BoxGeometry(0.25, 3.6, 0.1)), stripeMat);
    stripe.position.set(0, 0, 1.0);
    spin.add(stripe);
    mixer.add(drum);
    mixer.userData.drum = spin;
    const p: XZ = [
      g.yard[0] + g.side[0] * -(g.radius + 4) + g.out[0] * 6,
      g.yard[1] + g.side[1] * -(g.radius + 4) + g.out[1] * 6,
    ];
    mixer.position.set(p[0], 0.05, p[1]);
    mixer.rotation.y = yawX(g.side);
  }
  yard.add(mixer);

  // floodlights: masts at the yard corners, heads glow and pools light the yard at night
  const flood = new THREE.Group();
  flood.name = "devsim-floodlights";
  yard.add(flood);
  const headMat = own(new THREE.MeshBasicMaterial({ color: "#5a5f68" }));
  const poolMat = own(
    new THREE.MeshBasicMaterial({
      color: "#fff2c8",
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    }),
  );
  {
    const pole = own(new THREE.CylinderGeometry(0.2, 0.25, 14, 6).translate(0, 7, 0));
    const head = own(new THREE.BoxGeometry(2.4, 1.2, 0.6).translate(0, 14.2, 0));
    const pool = own(new THREE.CircleGeometry(16, 28).rotateX(-Math.PI / 2));
    const grey = own(new THREE.MeshStandardMaterial({ color: "#6b6f78", roughness: 0.6 }));
    const yc: XZ = [(g.yard[0] + g.centre[0]) / 2, (g.yard[1] + g.centre[1]) / 2];
    for (const c of ring) {
      const p: XZ = [c[0] + (yc[0] - c[0]) * 0.08, c[1] + (yc[1] - c[1]) * 0.08];
      const mastG = new THREE.Group();
      mastG.position.set(p[0], 0, p[1]);
      mastG.rotation.y = yawZ(sub(yc, p));
      const pm = new THREE.Mesh(pole, grey);
      pm.castShadow = true;
      mastG.add(pm, new THREE.Mesh(head, headMat));
      flood.add(mastG);
      const pp = new THREE.Mesh(pool, poolMat);
      const q: XZ = [p[0] + (yc[0] - p[0]) * 0.4, p[1] + (yc[1] - p[1]) * 0.4];
      pp.position.set(q[0], 0.25, q[1]);
      pp.renderOrder = 2;
      flood.add(pp);
    }
  }

  // closed edge (red) and detour (dashed blue): ground strips over the road surface
  const strip = (pts: readonly XZ[], colour: string, dash: number, y: number) => {
    const mat = own(
      new THREE.MeshStandardMaterial({
        color: colour,
        emissive: colour,
        emissiveIntensity: 0.35,
        roughness: 0.8,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    );
    const m = new THREE.Mesh(own(ribbonGeometry(pts, 1.6, y, dash)), mat);
    m.receiveShadow = true;
    m.raycast = NOOP;
    m.renderOrder = 1;
    group.add(m);
    return m;
  };
  const closedMesh = closedNear.length >= 2 ? strip(closedNear, "#d6455d", 0, 0.3) : null;
  const detourMesh = g.detour.length >= 2 ? strip(g.detour, "#2f7fd1", 2.2, 0.32) : null;

  // vehicles: lorries at Handover, the school-run queue in Daily Life
  const vPal = kitPalettes(o.manifest, "vehicles");
  const vkit = (
    variant: string,
    count: number,
    box: [number, number, number],
    pal: [string, string, string][],
  ) => {
    const k = kitMesh({
      lib: o.lib,
      manifest: o.manifest,
      uniforms: o.roleUniforms,
      asset: "vehicles",
      variant,
      count,
      palettes: pal,
      box,
      kind: "vehicle",
    });
    disposers.push(k.dispose);
    group.add(k.mesh);
    return k;
  };
  const lorryPal: [string, string, string][] = [
    ["#3f88c5", "#62666c", "#f4f1ea"],
    ["#57b38a", "#62666c", "#f4f1ea"],
    ["#e8644f", "#62666c", "#f4f1ea"],
  ];
  const carPal: [string, string, string][] = [
    ["#e8644f", "#62666c", "#9fc6dc"],
    ["#f4f1ea", "#62666c", "#9fc6dc"],
    ["#3f88c5", "#62666c", "#9fc6dc"],
    ["#f4b942", "#62666c", "#9fc6dc"],
    ["#57b38a", "#62666c", "#9fc6dc"],
    ["#8f9bb3", "#62666c", "#9fc6dc"],
    ...vPal,
  ];
  const lorries = vkit("lorry", LORRIES, [2.4, 3.2, 8], lorryPal);
  const cars = [
    vkit("sedan", Math.ceil(QUEUE / 2), [1.8, 1.45, 4.6], carPal),
    vkit("mpv", Math.floor(QUEUE / 2), [1.8, 1.7, 4.7], carPal),
  ];
  // the street at the entrance: from the junction anchor towards where the path meets the road
  const u = unit(sub(g.node, g.junction));
  const lane: XZ = [-u[1], u[0]];
  const onStreet = (d: number, off: number): XZ => [
    g.junction[0] + u[0] * d + lane[0] * off,
    g.junction[1] + u[1] * d + lane[1] * off,
  ];
  // one entry per vehicle in a fixed order (probe: index i is the same vehicle); NaN = not drawn
  const vehiclePts: [number, number, number][] = Array.from({ length: LORRIES + QUEUE }, () => [
    Number.NaN,
    0,
    0,
  ]);
  const setPt = (i: number, x: number, y: number, z: number) => {
    const v = vehiclePts[i] as [number, number, number];
    v[0] = x;
    v[1] = y;
    v[2] = z;
  };
  const poolGlow = new THREE.Color();

  return {
    group,
    vehicles: () => vehiclePts,
    update({ s, t, night }: DevsimFrame) {
      const cons = s.act === "Construction" && s.hoarding;
      const fade = ease(span(t, 31.6, 32.4)); // the kit sinks away as Handover begins
      yard.visible = s.hoarding && fade < 1;
      yard.position.y = -3 * fade;
      yard.scale.setScalar(1);
      hoardGroup.visible = s.hoarding;
      // hoarding sinks over the first 1.6 s of Handover (a quick fade)
      hoardGroup.position.y = -2.8 * ease(span(t, 32, 33.6));
      // crane: mast grows to keep the jib 14 m over the tower top; slews by day
      const topNow = Math.max(0, s.floorsBuilt) * 3.2;
      const lift = Math.max(0, topNow + 14 - CRANE_TOP_M);
      mast.scale.y = Math.max(0.01, lift);
      mast.visible = lift > 0.05;
      craneHead.position.y = lift;
      craneHead.rotation.y = s.crane.slewRad;
      beacon.visible = s.crane.beaconOn;
      // mixer drum turns while the crew works
      (mixer.userData.drum as THREE.Object3D).rotation.y = s.workersActive ? t * 6 : 0;
      mixer.visible = cons;
      // floodlights: on at night while building
      const lit = cons ? night : 0;
      poolMat.opacity = 0.42 * lit;
      headMat.color.set("#5a5f68").lerp(poolGlow.set("#fff6d8"), lit);
      const routesOn = t >= 6 && s.act === "Construction";
      if (closedMesh) closedMesh.visible = routesOn;
      if (detourMesh) detourMesh.visible = t >= 6.5 && s.act === "Construction";

      for (const v of vehiclePts) v[0] = Number.NaN;
      // lorries drive in and park, nose to tail, short of the entrance path
      let nl = 0;
      if (s.lorries) {
        for (let i = 0; i < LORRIES; i++) {
          const stop = 14 - i * 9;
          const d = stop - (1 - ease(span(t, 33 + i * 0.6, 35.6 + i * 0.6))) * 120;
          const p = onStreet(d, 2.2);
          lorries.set(i, place(_m, p[0], 0.05, p[1], yawZ(u)), i);
          setPt(i, p[0], 1.5, p[1]);
          nl++;
        }
      }
      lorries.setCount(nl);
      // the school-run queue (Daily Life morning)
      const queueOn = t >= 44 && t < 52.4;
      const counts = [0, 0];
      if (queueOn)
        for (let i = 0; i < QUEUE; i++) {
          const d = 15 - i * 6.2 + Math.max(0, Math.sin((t - 44) * 0.8 - i * 0.4)) * 1.5;
          const p = onStreet(d, 1.8);
          const k = i % 2;
          (cars[k] as (typeof cars)[number]).set(
            counts[k] as number,
            place(_m, p[0], 0.05, p[1], yawZ(u)),
            i,
          );
          counts[k] = (counts[k] as number) + 1;
          setPt(LORRIES + i, p[0], 0.8, p[1]);
        }
      cars.forEach((c, k) => {
        c.setCount(counts[k] as number);
      });
    },
    dispose() {
      for (const d of disposers) d();
      disposers.length = 0;
      group.clear();
    },
  };
}

/** True when (x, z) is within `m` metres of the plan's closed edge (people keep off it). */
export function nearClosed(g: SiteGeom, x: number, z: number, m = 3): boolean {
  return g.closed.length >= 2 && distToLine(g.closed, x, z) < m;
}
