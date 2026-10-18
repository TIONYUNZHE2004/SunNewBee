import * as THREE from "three";
import { DAY_STYLE, type Dot } from "../../../day/dayModel";
import {
  kindAt,
  phase,
  pointAlong,
  RESIDENT_STYLE,
  type ResidentKind,
  routeAt,
} from "../../../whatif/rolloutModel";
import type { LocalFrame } from "../frame";
import { displayScale } from "../motion/agents";

/** Capsule marker size (metres): 1.2 wide, 2.4 tall, standing on y = 0. */
export const RESIDENT_WIDTH_M = 1.2;
export const RESIDENT_HEIGHT_M = 2.4;
/** The focused resident is drawn this much larger, with a white ring. */
export const FOCUS_SCALE = 1.6;
/** Overlay pass order: with the markers (14), above the route (13). */
export const RESIDENT_ORDER = 14;
/** Seconds for one walk along a rollout route (display only, not a travel time). */
export const LOOP_S = 12;

const OUTLINE_SCALE = 1.18;
const FIRST_CAPACITY = 256;

export interface RolloutPoint {
  id: string;
  kind: ResidentKind;
  /** The route to walk, or the origin alone; empty means no position (not drawn). */
  coords: number[][];
  moving: boolean;
  /** Phase 0..1 so walkers do not move in lockstep. */
  offset: number;
}

export interface Residents {
  group: THREE.Group;
  /** Elmina Day dots at the panel's clock; `focus` is a resident id or null. */
  setDay(dots: Dot[], focus: string | null): void;
  /** Rising-river residents at the current stage. */
  setRollout(points: RolloutPoint[]): void;
  /** Camera position (legibility scale) and clock (rollout walkers); the overlay layer calls it each frame. */
  setView(cam: { x: number; y: number; z: number }, nowMs?: number): void;
  dispose(): void;
}

/** The resident id at an instance of the batched mesh (the pick's `instanceId`), else null. */
export function residentIdAt(obj: THREE.Object3D, instanceId: number): string | null {
  const ids = obj.userData.ids as string[] | undefined;
  return ids?.[instanceId] ?? null;
}

interface Item {
  id: string;
  /** Local x, z (fixed for Day dots, recomputed per frame for rollout walkers). */
  x: number;
  z: number;
  colour: THREE.Color;
  focused: boolean;
  /** Rollout walker: where it walks. */
  walk?: { coords: number[][]; moving: boolean; offset: number };
}

const noRaycast = () => {};

function capsule(): THREE.BufferGeometry {
  const r = RESIDENT_WIDTH_M / 2;
  // Low poly: 6 sides, 2 cap rings; the straight part is the height minus the two caps.
  const g = new THREE.CapsuleGeometry(r, RESIDENT_HEIGHT_M - 2 * r, 2, 6);
  g.translate(0, RESIDENT_HEIGHT_M / 2, 0);
  return g;
}

/**
 * Elmina Day and river-rollout residents as small capsule markers.
 *
 * Overlay scene (always on top, no depth) like the place markers: a resident is data the user is
 * told about, so a building must not hide them; a black outline keeps them legible against props.
 * Real simulation output (synthetic, cited by the Day legend), not decoration: pickable through
 * `residentIdAt`. Draws: outline + fill (+ the focus ring), whatever the count.
 */
export function createResidents(frame: LocalFrame): Residents {
  const group = new THREE.Group();
  group.name = "residents";
  group.visible = false;
  const geo = capsule();
  const basic = { depthTest: false, depthWrite: false, toneMapped: false } as const;
  const fillMat = new THREE.MeshBasicMaterial({ ...basic });
  const outlineMat = new THREE.MeshBasicMaterial({
    ...basic,
    color: 0x000000,
    side: THREE.BackSide,
  });
  const ringGeo = new THREE.RingGeometry(0.8, 1.0, 20);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    ...basic,
    color: 0xffffff,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.name = "resident-focus-ring";
  ring.visible = false;
  ring.renderOrder = RESIDENT_ORDER + 0.2;
  ring.frustumCulled = false;
  ring.raycast = noRaycast;
  group.add(ring);

  let fill: THREE.InstancedMesh | null = null;
  let outline: THREE.InstancedMesh | null = null;
  let capacity = 0;
  let day: Item[] = [];
  let rollout: Item[] = [];
  let cam: { x: number; y: number; z: number } | null = null;

  const build = (n: number) => {
    for (const m of [fill, outline]) {
      if (m) {
        group.remove(m);
        m.dispose();
      }
    }
    capacity = Math.max(FIRST_CAPACITY, 2 ** Math.ceil(Math.log2(Math.max(1, n))));
    outline = new THREE.InstancedMesh(geo, outlineMat, capacity);
    outline.name = "residents-outline";
    outline.renderOrder = RESIDENT_ORDER;
    outline.frustumCulled = false;
    outline.raycast = noRaycast;
    fill = new THREE.InstancedMesh(geo, fillMat, capacity);
    fill.name = "residents";
    fill.renderOrder = RESIDENT_ORDER + 0.1;
    fill.frustumCulled = false;
    // Data, not decoration: the shared picker names the id by instance (`residentIdAt`).
    fill.userData.pick = { kind: "resident" };
    fill.setColorAt(0, new THREE.Color());
    group.add(outline, fill);
  };

  const m4 = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const distance = (it: Item) => (cam ? Math.hypot(cam.x - it.x, cam.y, cam.z - it.z) : 0);

  const apply = () => {
    const items = [...day, ...rollout];
    if (!fill || !outline || items.length > capacity) build(items.length);
    const f = fill as THREE.InstancedMesh;
    const o = outline as THREE.InstancedMesh;
    f.userData.ids = items.map((i) => i.id);
    let focus: Item | null = null;
    items.forEach((it, i) => {
      const s = displayScale(distance(it)) * (it.focused ? FOCUS_SCALE : 1);
      pos.set(it.x, 0, it.z);
      m4.compose(pos, quat, sc.setScalar(s));
      f.setMatrixAt(i, m4);
      f.setColorAt(i, it.colour);
      m4.compose(pos, quat, sc.setScalar(s * OUTLINE_SCALE));
      o.setMatrixAt(i, m4);
      if (it.focused) focus = it;
    });
    f.count = o.count = items.length;
    f.instanceMatrix.needsUpdate = o.instanceMatrix.needsUpdate = true;
    if (f.instanceColor) f.instanceColor.needsUpdate = true;
    f.boundingSphere = null; // the instances moved: raycast recomputes the bounds
    group.visible = items.length > 0;
    const fi = focus as Item | null;
    ring.visible = !!fi;
    if (fi) {
      ring.position.set(fi.x, 0.05, fi.z);
      ring.scale.setScalar(displayScale(distance(fi)) * FOCUS_SCALE * RESIDENT_WIDTH_M);
    }
  };

  const dayColours = Object.fromEntries(
    Object.entries(DAY_STYLE).map(([k, v]) => [k, new THREE.Color(v.color)]),
  );
  const rolloutColours = Object.fromEntries(
    Object.entries(RESIDENT_STYLE).map(([k, v]) => [k, new THREE.Color(v.color)]),
  );

  const walkerXZ = (w: NonNullable<Item["walk"]>, nowMs: number): [number, number] => {
    const f = w.moving ? (nowMs / 1000 / LOOP_S + w.offset) % 1 : 0;
    const [lon, lat] = pointAlong(w.coords, f);
    return frame.toLocal(lon, lat);
  };

  return {
    group,
    setDay(dots, focus) {
      day = dots.map((d) => {
        const [x, z] = frame.toLocal(d.lon, d.lat);
        return {
          id: d.r,
          x,
          z,
          colour: dayColours[d.state] as THREE.Color,
          focused: d.r === focus,
        };
      });
      apply();
    },
    setRollout(points) {
      rollout = points
        .filter((p) => p.coords.length > 0)
        .map((p) => {
          const walk = { coords: p.coords, moving: p.moving, offset: p.offset };
          const [x, z] = walkerXZ(walk, 0);
          return {
            id: p.id,
            x,
            z,
            colour: rolloutColours[p.kind] as THREE.Color,
            focused: false,
            walk,
          };
        });
      apply();
    },
    setView(c, nowMs = performance.now()) {
      const moved = !cam || cam.x !== c.x || cam.y !== c.y || cam.z !== c.z;
      const walking = rollout.some((r) => r.walk?.moving);
      if (!moved && !walking) return;
      cam = { x: c.x, y: c.y, z: c.z };
      for (const r of rollout) if (r.walk) [r.x, r.z] = walkerXZ(r.walk, nowMs);
      apply();
    },
    dispose() {
      for (const m of [fill, outline]) m?.dispose();
      geo.dispose();
      ringGeo.dispose();
      fillMat.dispose();
      outlineMat.dispose();
      ringMat.dispose();
      group.clear();
      group.removeFromParent();
    },
  };
}

interface RolloutResident {
  id: string;
  statuses: string[];
  route_ids: (string | null)[];
  origin_coord?: number[] | null;
}

/**
 * The rollout residents at `stage`, as Cesium places them: on their route when they have one, else
 * standing (grey) at their origin; none when they have neither.
 */
export function rolloutPoints(
  residents: RolloutResident[],
  routes: Record<string, { coordinates: number[][] }>,
  stage: number,
): RolloutPoint[] {
  return residents.map((r) => {
    const { routeId, moving } = routeAt(r, stage);
    const origin = r.origin_coord && r.origin_coord.length >= 2 ? [r.origin_coord] : [];
    const coords = routeId ? (routes[routeId]?.coordinates ?? origin) : origin;
    return { id: r.id, kind: kindAt(r, stage), coords, moving, offset: phase(r.id) };
  });
}
