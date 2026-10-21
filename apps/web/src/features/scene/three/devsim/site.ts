import * as THREE from "three";
import type { StateAt } from "../../../devsim/types";
import type { AssetLibrary } from "../assets/library";
import type { Manifest } from "../assets/manifest";
import type { RoleUniforms } from "../assets/roleMaterial";
import { DEVSIM_COLOURS } from "../shared/clayTokens";
import type { DevsimFrame, DevsimPart } from "./devsimLayer";
import { ease, span } from "./ease";
import { along, distToLine, laneAt, lengthOf, type SiteGeom, type XZ } from "./geom";
import { kitMesh, kitPalettes, place } from "./kit";
import type { SetPiecesAt } from "./setPieces";

const NOOP = () => {};
const HOARD_M = 6;
const CRANE_TOP_M = 50;
const STACKS = 5;
const LORRIES = 3;
/** Construction traffic on the lorry route (C9): lorries and concrete mixers, alternating. */
const ROUTE_LORRIES = 2;
const ROUTE_MIXERS = 2;
const ROUTE_VEHICLES = ROUTE_LORRIES + ROUTE_MIXERS;
/** Screen seconds for one loop (main road -> gate in one lane, back out in the other). */
const ROUTE_LOOP_S = 9;
/** Lane centre off the route centreline (left of the facing; AC-W4 allows 3 m). */
const ROUTE_LANE_M = 1.6;
/** A vehicle within this distance of the gate is inside the site (not drawn). */
const GATE_HIDE_M = 5;
/** The crane's load hangs under the kit hook: hook point in the slewing head's frame (m). */
const HOOK_X = 26;
const HOOK_Y = 21;
const SLING_M = 3;
const QUEUE = 8;
/** School-run queue: centre-to-centre gap and how far a car creeps forward (the lane is `g.lane`). */
const QUEUE_GAP_M = 7;
const QUEUE_CREEP_M = 0.8;
/** The head car's centre, metres up the street from the junction (clear of the crossing). */
const QUEUE_HEAD_M = 9.5;
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

/** Centroid (x, z) of a model's vertices under 2 m (a tower crane's mast foot); [0, 0] if none. */
export function mastFoot(g: THREE.BufferGeometry): [number, number] {
  const p = g.getAttribute("position");
  if (!p) return [0, 0];
  let x = 0;
  let z = 0;
  let n = 0;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 2) continue;
    x += p.getX(i);
    z += p.getZ(i);
    n++;
  }
  return n > 0 ? [x / n, z / n] : [0, 0];
}

const HEAD_OFF = new THREE.Color(DEVSIM_COLOURS.headOff);
const HEAD_ON = new THREE.Color(DEVSIM_COLOURS.headOn);

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
 * material stacks, the kit's cement mixer, a site cabin and floodlights (emissive pools
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
    // the frontage hoarding stands on the parcel edge 8 m in from the closed footway, so the red
    // strip stays in view from the site-side beats (a 2.4 m panel hides ~4 m of ground behind it)
    runs.push(
      closedNear.map((p, i) => {
        const a = closedNear[Math.max(0, i - 1)] as XZ;
        const b = closedNear[Math.min(closedNear.length - 1, i + 1)] as XZ;
        const d = unit(sub(b, a));
        let n: XZ = [-d[1], d[0]];
        const toC = sub(g.centre, p);
        if (n[0] * toC[0] + n[1] * toC[1] < 0) n = [-n[0], -n[1]];
        return [p[0] + n[0] * 8, p[1] + n[1] * 8];
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
  // the kit crane's mast is not at its model origin: centre it on the slew axis (the mast foot's
  // centroid, vertices under 2 m) so the mast extension below lines up and the jib slews round it
  const foot = mastFoot(crane.mesh.geometry);
  crane.set(0, place(_m, -foot[0], 0, -foot[1], 0));
  crane.setCount(1);
  craneHead.add(crane.mesh);
  const yellow = own(
    new THREE.MeshStandardMaterial({ color: DEVSIM_COLOURS.amber, roughness: 0.5 }),
  );
  const mast = new THREE.Mesh(own(new THREE.BoxGeometry(1.8, 1, 1.8).translate(0, 0.5, 0)), yellow);
  mast.castShadow = true;
  craneGroup.add(mast);
  const beaconMat = own(
    new THREE.MeshBasicMaterial({ color: DEVSIM_COLOURS.beaconRed, toneMapped: false }),
  );
  const beacon = new THREE.Mesh(own(new THREE.SphereGeometry(0.7, 10, 8)), beaconMat);
  beacon.position.y = CRANE_TOP_M + 0.8;
  craneHead.add(beacon);
  // the swinging load: a sling and a timber bundle under the kit hook (pivot at the hook)
  const loadPivot = new THREE.Group();
  loadPivot.name = "devsim-crane-load";
  loadPivot.position.set(HOOK_X, HOOK_Y, 0);
  craneHead.add(loadPivot);
  {
    const cable = own(
      new THREE.MeshStandardMaterial({ color: DEVSIM_COLOURS.cable, roughness: 0.6 }),
    );
    const sling = new THREE.Mesh(
      own(new THREE.CylinderGeometry(0.05, 0.05, SLING_M, 4).translate(0, -SLING_M / 2, 0)),
      cable,
    );
    const bundle = new THREE.Mesh(
      own(new THREE.BoxGeometry(3.4, 0.9, 1.4).translate(0, -SLING_M - 0.45, 0)),
      own(new THREE.MeshStandardMaterial({ color: DEVSIM_COLOURS.loadTimber, roughness: 0.85 })),
    );
    bundle.castShadow = true;
    loadPivot.add(sling, bundle);
  }

  // cement mixer: the construction kit's model (one LOD node, no separable drum, so it stays
  // static; ruling R21: the kit model wins over the drum spin). Instance 0 stands in the yard; the
  // others drive the lorry route (C9), drawn in the same mesh.
  const mixer = kit("cement_mixer", 1 + ROUTE_MIXERS, [2.5, 3.6, 8.5]);
  mixer.mesh.name = "devsim-mixer";
  {
    const p: XZ = [
      g.yard[0] + g.side[0] * -(g.radius + 4) + g.out[0] * 6,
      g.yard[1] + g.side[1] * -(g.radius + 4) + g.out[1] * 6,
    ];
    mixer.set(0, place(_m, p[0], 0.05, p[1], yawZ(g.side)));
    mixer.setCount(1);
  }
  // the route mixers drive outside the yard: the mesh joins the site group
  group.add(mixer.mesh);

  // floodlights: masts at the yard corners, heads glow and pools light the yard at night
  const flood = new THREE.Group();
  flood.name = "devsim-floodlights";
  yard.add(flood);
  const headMat = own(new THREE.MeshBasicMaterial({ color: DEVSIM_COLOURS.headOff }));
  const poolMat = own(
    new THREE.MeshBasicMaterial({
      color: DEVSIM_COLOURS.headGlow,
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
    const grey = own(
      new THREE.MeshStandardMaterial({ color: DEVSIM_COLOURS.craneGrey, roughness: 0.6 }),
    );
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
  const strip = (pts: readonly XZ[], colour: string, dash: number, y: number, w = 2.4) => {
    const mat = own(
      new THREE.MeshStandardMaterial({
        color: colour,
        emissive: colour,
        emissiveIntensity: 0.35,
        roughness: 0.8,
        // either winding faces up
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    );
    const m = new THREE.Mesh(own(ribbonGeometry(pts, w, y, dash)), mat);
    m.receiveShadow = true;
    m.raycast = NOOP;
    m.renderOrder = 1;
    group.add(m);
    return m;
  };
  const closedMesh =
    closedNear.length >= 2 ? strip(closedNear, DEVSIM_COLOURS.closedStrip, 0, 0.3) : null;
  const detourMesh =
    g.detour.length >= 2 ? strip(g.detour, DEVSIM_COLOURS.detourStrip, 2.2, 0.32) : null;
  // the lorry route (C9): a thin orange ribbon on the computed drive route
  const routeMesh =
    g.lorryRoute.length >= 2 ? strip(g.lorryRoute, DEVSIM_COLOURS.lorryRoute, 0, 0.34, 1.4) : null;
  if (routeMesh) {
    routeMesh.name = "devsim-lorry-route";
    routeMesh.visible = false;
  }

  // the lot marker for the Brief overview (prototype: the outlined parcel under its label): a
  // tinted patch and a dashed outline where the yard will stand; gone once the hoarding is up
  const lot = new THREE.Group();
  lot.name = "devsim-lot";
  group.add(lot);
  {
    const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
    const patch = new THREE.Mesh(
      own(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, 0.25, 0)),
      own(
        new THREE.MeshStandardMaterial({
          color: DEVSIM_COLOURS.kerbSand,
          roughness: 0.9,
          transparent: true,
          opacity: 0.75,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      ),
    );
    patch.raycast = NOOP;
    patch.receiveShadow = true;
    lot.add(patch);
    lot.add(strip([...ring, ring[0] as XZ], DEVSIM_COLOURS.hoardingNavy, 3, 0.3));
  }

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
    [DEVSIM_COLOURS.blue, DEVSIM_COLOURS.slate, DEVSIM_COLOURS.offWhite],
    [DEVSIM_COLOURS.green, DEVSIM_COLOURS.slate, DEVSIM_COLOURS.offWhite],
    [DEVSIM_COLOURS.coral, DEVSIM_COLOURS.slate, DEVSIM_COLOURS.offWhite],
  ];
  const carPal: [string, string, string][] = [
    [DEVSIM_COLOURS.coral, DEVSIM_COLOURS.slate, DEVSIM_COLOURS.glass],
    [DEVSIM_COLOURS.offWhite, DEVSIM_COLOURS.slate, DEVSIM_COLOURS.glass],
    [DEVSIM_COLOURS.blue, DEVSIM_COLOURS.slate, DEVSIM_COLOURS.glass],
    [DEVSIM_COLOURS.amber, DEVSIM_COLOURS.slate, DEVSIM_COLOURS.glass],
    [DEVSIM_COLOURS.green, DEVSIM_COLOURS.slate, DEVSIM_COLOURS.glass],
    [DEVSIM_COLOURS.slateBlue, DEVSIM_COLOURS.slate, DEVSIM_COLOURS.glass],
    ...vPal,
  ];
  const lorries = vkit("lorry", LORRIES + ROUTE_LORRIES, [2.2, 3.0, 7.0], lorryPal);
  const cars = [
    vkit("small_sedan", Math.ceil(QUEUE / 2), [1.7, 1.5, 4.3], carPal),
    vkit("mpv", Math.floor(QUEUE / 2), [1.7, 1.7, 4.4], carPal),
  ];
  // one entry per vehicle in a fixed order (probe: index i is the same vehicle); NaN = not drawn
  const vehiclePts: [number, number, number][] = Array.from(
    { length: LORRIES + QUEUE + ROUTE_VEHICLES },
    () => [Number.NaN, 0, 0],
  );
  /** Drawn lorries and mixers this frame (demo hook). */
  const drawnLorries: { kind: "lorry" | "mixer"; x: number; z: number }[] = [];
  let last: SetPiecesAt | null = null;
  const setPt = (i: number, x: number, y: number, z: number) => {
    const v = vehiclePts[i] as [number, number, number];
    v[0] = x;
    v[1] = y;
    v[2] = z;
  };

  return {
    group,
    vehicles: () => vehiclePts,
    aoExcluded: () => [lot],
    demoState() {
      const route = g.lorryRoute;
      return {
        crane: {
          yaw: craneHead.rotation.y,
          yawDeg: (craneHead.rotation.y * 180) / Math.PI,
          stopped: last?.crane.stopped ?? true,
          wetBeat: last?.wetBeat ?? false,
          hold: last?.hold ?? false,
          hookParked: !loadPivot.visible,
          loadSwingRad: loadPivot.rotation.x,
        },
        lorries: drawnLorries.map((v) => ({
          ...v,
          distToRoute: route.length >= 2 ? distToLine(route, v.x, v.z) : null,
        })),
        lorryRoute: {
          drawn: !!routeMesh?.visible,
          points: route.length,
          mode: last?.timing.mode ?? "legacy",
        },
      };
    },
    update({ s, t, night, sp: spIn }: DevsimFrame) {
      const sp = spIn ?? legacySetPieces(s);
      last = sp;
      const cons = s.act === "Construction" && s.hoarding;
      lot.visible = t < 4;
      const fade = ease(span(t, 31.6, 32.4)); // the kit sinks away as Handover begins
      yard.visible = s.hoarding && fade < 1;
      yard.position.y = -3 * fade;
      hoardGroup.visible = s.hoarding;
      // hoarding sinks over the first 1.6 s of Handover (a quick fade)
      hoardGroup.position.y = -2.8 * ease(span(t, 32, 33.6));
      // crane: mast grows to keep the jib 14 m over the tower top; slews by day
      const topNow = Math.max(0, s.floorsBuilt) * 3.2;
      const lift = Math.max(0, topNow + 14 - CRANE_TOP_M);
      mast.scale.y = Math.max(0.01, lift);
      mast.visible = lift > 0.05;
      craneHead.position.y = lift;
      craneHead.rotation.y = sp.crane.yaw;
      beacon.visible = s.crane.beaconOn;
      // the load trails the slew (lag) and sways a little along the jib; parked in the Raya hold
      loadPivot.visible = !sp.hold;
      loadPivot.rotation.x = Math.max(-0.4, Math.min(0.4, -sp.crane.vel * 0.35));
      loadPivot.rotation.z = 0.06 * (sp.crane.stopped ? 0.25 : 1) * Math.sin(t * 2.1);
      // the crane sinks by its own height over the same 0.8 s, so it reads as a quick fade
      craneGroup.position.y = -(CRANE_TOP_M + craneHead.position.y + 2) * fade;
      mixer.mesh.visible = cons || sp.traffic;
      // floodlights: on at night while building; off while the site is closed (Raya hold)
      const lit = cons && !sp.hold ? night : 0;
      poolMat.opacity = 0.6 * lit;
      headMat.color.copy(HEAD_OFF).lerp(HEAD_ON, lit);
      const routesOn = t >= 6 && s.act === "Construction";
      if (closedMesh) closedMesh.visible = routesOn;
      if (detourMesh) detourMesh.visible = t >= 6.5 && s.act === "Construction";
      if (routeMesh) routeMesh.visible = sp.routeOn;

      for (const v of vehiclePts) v[0] = Number.NaN;
      drawnLorries.length = 0;
      // Handover lorries: along the lorry route to the gate when the plan has one, else up the
      // lane, parking nose to tail short of the junction
      let nl = 0;
      if (s.lorries && !sp.hold) {
        const poses =
          g.lorryRoute.length >= 2
            ? moveInRoutePoses(g.lorryRoute, t, sp.timing.moveIn)
            : lorryPoses(g, t);
        poses.forEach((v, i) => {
          if (!v) return;
          lorries.set(nl, place(_m, v.x, 0.05, v.z, yawZ(v.dir)), i);
          setPt(i, v.x, 1.5, v.z);
          drawnLorries.push({ kind: "lorry", x: v.x, z: v.z });
          nl++;
        });
      }
      // construction traffic on the lorry route (lorries and mixers alternate); gone in the hold
      let nm = 1;
      const tr = sp.timing.lorryRoute;
      if (sp.traffic && tr && g.lorryRoute.length >= 2)
        routeTrafficPoses(g.lorryRoute, t, tr[0]).forEach((v, k) => {
          if (!v) return;
          const isMixer = k % 2 === 1;
          if (isMixer) mixer.set(nm++, place(_m, v.x, 0.05, v.z, yawZ(v.dir)));
          else lorries.set(nl++, place(_m, v.x, 0.05, v.z, yawZ(v.dir)), k % LORRIES);
          setPt(LORRIES + QUEUE + k, v.x, 1.5, v.z);
          drawnLorries.push({ kind: isMixer ? "mixer" : "lorry", x: v.x, z: v.z });
        });
      lorries.setCount(nl);
      mixer.setCount(nm);
      // the school-run queue (Daily Life morning)
      const counts = [0, 0];
      queuePoses(g, t).forEach((v, i) => {
        if (!v) return;
        const k = i % 2;
        (cars[k] as (typeof cars)[number]).set(
          counts[k] as number,
          place(_m, v.x, 0.05, v.z, yawZ(v.dir)),
          i,
        );
        counts[k] = (counts[k] as number) + 1;
        setPt(LORRIES + i, v.x, 0.8, v.z);
      });
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

/**
 * The school-run queue's slot i: metres along the frontage street from the junction. F3 (AC-C1,
 * 48 s): the whole queue waits on the street arm the 48 s camera looks up (+street), nose to tail
 * toward the junction, so the shot shows a line of cars behind Mei Ling as the prototype does (it
 * used to put six of the eight cars on the arm behind the camera). Bumper to bumper gaps stay open
 * (QUEUE_GAP_M centre to centre for 4.7 m cars, creeping at most QUEUE_CREEP_M toward the
 * junction), and the head car keeps the junction crossing clear (gate 2: cars interpenetrated and
 * Mei Ling stood inside one at the crossing). Slot 0 is the tail, slot QUEUE-1 the head. Pure.
 */
export function queueSlot(i: number): number {
  return QUEUE_HEAD_M + (QUEUE - 1 - i) * QUEUE_GAP_M;
}

/** The school-run queue stands at the junction in the Daily Life morning (screen s). */
export const queueShown = (t: number) => t >= 44 && t < 52.4;

/** A vehicle's pose: ground point and facing (unit, local x/z). */
export interface VehiclePose {
  x: number;
  z: number;
  dir: XZ;
}

/** Body lengths (m): a lorry, and the longest queue car (the MPV). */
const LORRY_M = 8;
const CAR_LEN_M = 4.7;
/** The lorries' parking spots, metres up the lane from the junction (nose to tail, crossing clear). */
const LORRY_STOPS = [9.5, 19, 28.5];

/**
 * The Handover lorries at t (pure; index i is lorry i, null = not drawn): they drive in down the
 * queue's lane toward the junction, one every 0.6 s from 33 s, and park nose to tail, on the
 * carriageway and in lane (owner fix: they used to come in on a straight line across the lots).
 * A lorry still further out than the mapped lane is not drawn yet.
 */
export function lorryPoses(g: SiteGeom, t: number): (VehiclePose | null)[] {
  const L = lengthOf(g.lane.pts);
  return Array.from({ length: LORRIES }, (_, i) => {
    const stop = LORRY_STOPS[i] as number;
    const d = stop + (1 - ease(span(t, 33 + i * 0.6, 35.6 + i * 0.6))) * 120;
    if (d + LORRY_M / 2 > L) return null;
    const a = laneAt(g.lane, d);
    return { x: a.p[0], z: a.p[1], dir: a.dir };
  });
}

/** The Handover lorries' stops, metres short of the gate along the lorry route. */
const ROUTE_STOPS = [GATE_HIDE_M + 2, GATE_HIDE_M + 11.5, GATE_HIDE_M + 21];

/** Pose `d` m along a route, facing `fwd` (true: toward the gate), in the lane left of the facing. */
function routePose(route: readonly XZ[], d: number, fwd: boolean): VehiclePose {
  const a = along(route, d);
  const f: XZ = fwd ? a.dir : [-a.dir[0], -a.dir[1]];
  const left: XZ = [f[1], -f[0]];
  return { x: a.p[0] + left[0] * ROUTE_LANE_M, z: a.p[1] + left[1] * ROUTE_LANE_M, dir: f };
}

/**
 * The Handover lorries on the lorry route at t (pure; index i is lorry i, null = not drawn): one
 * every 0.6 s from `t0` they drive the last stretch of the route to the gate and park nose to tail
 * in the inbound lane, each within ROUTE_LANE_M of the route (AC-W4).
 */
export function moveInRoutePoses(
  route: readonly XZ[],
  t: number,
  t0: number,
): (VehiclePose | null)[] {
  const L = lengthOf(route);
  return Array.from({ length: LORRIES }, (_, i) => {
    const stop = L - (ROUTE_STOPS[i] as number);
    const d = stop - (1 - ease(span(t, t0 + i * 0.6, t0 + 2.6 + i * 0.6))) * 120;
    if (d < 0 || stop < 0) return null;
    return routePose(route, d, true);
  });
}

/**
 * Construction traffic on the lorry route at t (pure; index k is vehicle k, lorries even, mixers
 * odd, null = inside the site): each loops main road -> gate in the inbound lane and back out in
 * the outbound lane, ROUTE_LOOP_S per loop, spaced evenly; within ROUTE_LANE_M of the route.
 */
export function routeTrafficPoses(
  route: readonly XZ[],
  t: number,
  t0: number,
): (VehiclePose | null)[] {
  const L = lengthOf(route);
  return Array.from({ length: ROUTE_VEHICLES }, (_, k) => {
    if (L < GATE_HIDE_M * 3) return null;
    const ph = ((((t - t0) / ROUTE_LOOP_S + k / ROUTE_VEHICLES) % 1) + 1) % 1;
    const d = ph * 2 * L;
    const inbound = d < L;
    const at = inbound ? d : 2 * L - d;
    if (at > L - GATE_HIDE_M) return null;
    return routePose(route, at, inbound);
  });
}

/** Set pieces for a bare frame (part tests without a layer): today's crane, nothing else. */
function legacySetPieces(s: StateAt): SetPiecesAt {
  return {
    timing: {
      mode: "legacy",
      piling: [0, 0],
      lorryRoute: null,
      raya: null,
      monsoon: null,
      moveIn: 33,
      total: 0,
    },
    hold: false,
    monsoon: false,
    wetBeat: false,
    rain: 0,
    piling: false,
    pilingU: 0,
    routeOn: false,
    traffic: false,
    crane: { yaw: s.crane.slewRad, vel: 0, stopped: !s.workersActive },
  };
}

/**
 * The school-run queue at t (pure; index i is car i, null = not drawn): nose to tail in the lane
 * up the frontage street, each car facing the junction along the street (owner fix, 4.png), the
 * whole queue gone when it ends (52.4 s). A slot past the mapped lane's end is left empty.
 */
export function queuePoses(g: SiteGeom, t: number): (VehiclePose | null)[] {
  const L = lengthOf(g.lane.pts);
  const on = queueShown(t);
  return Array.from({ length: QUEUE }, (_, i) => {
    if (!on) return null;
    // creeps toward the junction
    const d = queueSlot(i) - Math.max(0, Math.sin((t - 44) * 0.8 - i * 0.4)) * QUEUE_CREEP_M;
    if (d + CAR_LEN_M / 2 > L) return null;
    const a = laneAt(g.lane, d);
    return { x: a.p[0], z: a.p[1], dir: a.dir };
  });
}

/** True when (x, z) is in the queue's lane stretch (decorative traffic keeps off it). */
export function nearQueue(g: SiteGeom, x: number, z: number): boolean {
  const tail = queueSlot(0) + CAR_LEN_M;
  const pts: XZ[] = [];
  for (let d = 0; d <= tail; d += 2) pts.push(laneAt(g.lane, d).p);
  return distToLine(pts, x, z) < 3;
}

/** True when (x, z) is within `m` metres of the plan's closed edge (people keep off it). */
export function nearClosed(g: SiteGeom, x: number, z: number, m = 3): boolean {
  return g.closed.length >= 2 && distToLine(g.closed, x, z) < m;
}
