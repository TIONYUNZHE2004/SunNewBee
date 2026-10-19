import * as THREE from "three";
import { REST_TIMING } from "../journey/heroDriver";
import { HERO_DISPLAY_SCALE, type Hero, type HeroClip, type HeroContact } from "./hero";

/**
 * Placeholder hero (D-T6) until the rigged chibi GLB (C-T3/C-T4) lands: the prototype's primitive
 * clay chibi (docs/03-product/prototypes/resident-journey/index.html `chibi({ hijab, walker, hero })`),
 * an older woman in a purple baju kurung and lilac tudung with a walker, ported to the `Hero`
 * interface. Improvements over the prototype: front is +z (the app's yaw convention), feet that
 * step, the walker rolls on the ground (the prototype bobbed the whole figure, walker included, off
 * the ground), a `look` head turn, a seated pose with the walker parked beside her, and
 * ground-contact points for the AC-D10 check. Decorative display only: it encodes no fact.
 *
 * Model units are the prototype's (about 1.56 tall); the rig is scaled by HERO_DISPLAY_SCALE (R-J3)
 * so she stands about 2.4 m. Every mesh ignores picking.
 */

const CLOTH = "#7c5cbf";
const TUDUNG = "#c9a8e8";
const SKIN = "#d9a77c";
const EYE = "#2b2622";
const BLUSH = "#f29b9b";
const SHOE = "#4a3f5c";
const METAL = "#cfd6de";
const GRIP = "#5a6b7d";
const RING = "#ffd34d";
const DISC = "#fff3c2";

/** Walk cycle length (s) at rate 1 (the driver's clip time is already rate-scaled). */
const WALK_CYCLE_S = 1;
/** Foot stride half-amplitude and lift, model units (lift x 1.55 stays under 2.5 cm). */
const STRIDE = 0.09;
const LIFT = 0.015;
/** Look: one slow left-then-right sweep per this many seconds. */
const LOOK_CYCLE_S = 3;
const LOOK_YAW = 0.75;
/** Seat height (true metres, H7); scaled with the hero so she sits on it. */
export const BENCH_SEAT_TRUE_M = 0.45;
/** Seated pose, model units. */
const SEAT_Y = BENCH_SEAT_TRUE_M;
const SEATED_FEET_Z = 0.3;
const WALKER_PARK: readonly [number, number] = [0.2, 0.25];

const noRaycast = () => {};
const ease = (u: number) => {
  const c = Math.max(0, Math.min(1, u));
  return c * c * (3 - 2 * c);
};

function clay(hex: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color: hex, roughness: 0.85, metalness: 0, ...extra });
}

export function createPlaceholderHero(): Hero {
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const g = <T extends THREE.BufferGeometry>(x: T) => {
    geos.push(x);
    return x;
  };
  const m = <T extends THREE.Material>(x: T) => {
    mats.push(x);
    return x;
  };
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(geo, mat);
    o.position.set(x, y, z);
    o.castShadow = true;
    o.raycast = noRaycast;
    return o;
  };
  const sphere = (r: number, seg = 20) =>
    g(new THREE.SphereGeometry(r, seg, Math.round(seg * 0.7)));

  const cloth = m(clay(CLOTH));
  const tudung = m(clay(TUDUNG));
  const skin = m(clay(SKIN));
  const eye = m(clay(EYE, { roughness: 0.3 }));
  const blush = m(clay(BLUSH));
  const shoe = m(clay(SHOE));
  const metal = m(clay(METAL, { roughness: 0.3, metalness: 0.6 }));
  const grip = m(clay(GRIP));

  const root = new THREE.Group();
  root.name = "journey-hero";
  root.userData.decorative = true;
  const rig = new THREE.Group();
  rig.scale.setScalar(HERO_DISPLAY_SCALE);
  root.add(rig);

  // Ground highlight (prototype): a yellow ring and a pale disc, flat on the ground.
  const ring = mesh(
    g(new THREE.TorusGeometry(0.85, 0.06, 12, 48)),
    m(new THREE.MeshBasicMaterial({ color: RING })),
    0,
    0.03,
    0,
  );
  ring.rotation.x = Math.PI / 2;
  ring.castShadow = false;
  ring.userData.heroPart = "ring";
  const disc = mesh(
    g(new THREE.CircleGeometry(0.82, 40)),
    m(
      new THREE.MeshBasicMaterial({
        color: DISC,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      }),
    ),
    0,
    0.02,
    0,
  );
  disc.rotation.x = -Math.PI / 2;
  disc.castShadow = false;
  disc.userData.heroPart = "disc";
  rig.add(ring, disc);

  // Upper body: baju kurung (a cone to the ankle), arms, head with tudung.
  const upper = new THREE.Group();
  rig.add(upper);
  const dressGeo = g(new THREE.ConeGeometry(0.36, 1, 24));
  dressGeo.translate(0, -0.5, 0); // apex at the origin, hem at y = -1
  const dress = mesh(dressGeo, cloth, 0, 1.05, 0);
  const DRESS_LEN = 0.95; // hem at y 0.1, just above the shoes
  dress.scale.y = DRESS_LEN;
  upper.add(dress);
  const arms: THREE.Group[] = [];
  for (const s of [-0.29, 0.29]) {
    const arm = new THREE.Group();
    arm.position.set(s, 0.86, 0);
    arm.add(mesh(g(new THREE.CapsuleGeometry(0.075, 0.3, 4, 10)), cloth, 0, -0.22, 0));
    arm.add(mesh(sphere(0.06, 10), skin, 0, -0.42, 0)); // hand
    upper.add(arm);
    arms.push(arm);
  }
  const head = new THREE.Group();
  head.position.y = 1.16;
  head.userData.heroPart = "head";
  upper.add(head);
  head.add(mesh(sphere(0.37, 28), tudung, 0, 0.03, -0.05)); // hood
  head.add(mesh(sphere(0.27, 24), skin, 0, -0.03, 0.12)); // face
  for (const s of [-0.1, 0.1]) head.add(mesh(sphere(0.04, 10), eye, s, 0, 0.37));
  for (const s of [-0.17, 0.17]) {
    const b = mesh(sphere(0.045, 10), blush, s, -0.09, 0.34);
    b.scale.set(1, 0.6, 0.4);
    head.add(b);
  }
  upper.add(mesh(g(new THREE.ConeGeometry(0.42, 0.3, 24)), tudung, 0, 0.86, -0.02)); // tudung drape

  // Shins (only while seated: the baju kurung reaches the ankle, so they are cloth) and shoes.
  const shins: THREE.Mesh[] = [];
  const feet: THREE.Group[] = [];
  const contacts: THREE.Object3D[] = [];
  for (const s of [-0.11, 0.11]) {
    const shin = mesh(
      g(new THREE.CapsuleGeometry(0.07, 0.25, 4, 10)),
      cloth,
      s,
      0.27,
      SEATED_FEET_Z,
    );
    shin.visible = false;
    rig.add(shin);
    shins.push(shin);
    const foot = new THREE.Group();
    foot.position.set(s, 0, 0);
    const sole = mesh(sphere(0.07, 12), shoe, 0, 0.05, 0.03);
    sole.scale.set(0.9, 0.7, 1.3);
    foot.add(sole);
    const c = new THREE.Object3D();
    c.name = s < 0 ? "foot_l" : "foot_r";
    foot.add(c); // the sole's lowest point: y 0.05 - 0.07 x 0.7 = 0.001
    rig.add(foot);
    feet.push(foot);
    contacts.push(c);
  }

  // Walker (rollator): four legs on the ground, grips at hand height, held in front of her.
  const walker = new THREE.Group();
  rig.add(walker);
  for (const wz of [0.45, 0.88]) {
    for (const wx of [-0.3, 0.3]) {
      walker.add(mesh(g(new THREE.CylinderGeometry(0.022, 0.022, 0.8, 10)), metal, wx, 0.45, wz));
      walker.add(mesh(sphere(0.05, 10), grip, wx, 0.05, wz)); // wheel / tip
      const c = new THREE.Object3D();
      c.name = `walker_${wz < 0.5 ? "b" : "f"}${wx < 0 ? "l" : "r"}`;
      c.position.set(wx, 0, wz);
      walker.add(c);
      contacts.push(c);
    }
  }
  for (const wx of [-0.3, 0.3]) {
    const t = mesh(g(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 10)), grip, wx, 0.85, 0.62);
    t.rotation.x = Math.PI / 2;
    walker.add(t);
  }
  const bar = mesh(g(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 10)), metal, 0, 0.6, 0.88);
  bar.rotation.z = Math.PI / 2;
  walker.add(bar);

  /** 0 standing, 1 seated. */
  const seat = (k: number) => {
    // the hem rises to the seat: the dress shortens from the shoulders down
    dress.scale.y = DRESS_LEN - (SEAT_Y - 0.1) * k;
    for (const s of shins) s.visible = k > 0.5;
    for (const f of feet) f.position.z = SEATED_FEET_Z * k;
    upper.position.y = -0.04 * k;
    walker.position.set(WALKER_PARK[0] * k, 0, WALKER_PARK[1] * k);
    walker.rotation.y = (Math.PI / 2) * k;
    // arms: reaching forward to the grips (walking) -> resting on the lap (seated)
    for (const a of arms) a.rotation.x = -Math.PI / 2 + (Math.PI / 2 - 0.5) * k;
  };

  const reset = () => {
    seat(0);
    head.rotation.set(0, 0, 0);
    upper.scale.set(1, 1, 1);
    for (const f of feet) f.position.y = 0;
  };

  let disposed = false;
  return {
    object3d: root,
    setPose(pos, yaw) {
      root.position.set(pos.x, pos.y, pos.z);
      root.rotation.set(0, yaw, 0);
    },
    play(clip: HeroClip, time: number, _rate: number) {
      const tt = Number.isFinite(time) ? Math.max(0, time) : 0;
      reset();
      switch (clip) {
        case "walk": {
          const ph = (2 * Math.PI * tt) / WALK_CYCLE_S;
          const s = Math.sin(ph);
          const [l, r] = feet as [THREE.Group, THREE.Group];
          l.position.z = STRIDE * s;
          r.position.z = -STRIDE * s;
          l.position.y = LIFT * Math.max(0, Math.cos(ph));
          r.position.y = LIFT * Math.max(0, -Math.cos(ph));
          upper.position.y = 0.015 * Math.abs(s);
          walker.position.z = 0.04 * (0.5 + 0.5 * s);
          break;
        }
        case "idle":
        case "sit_idle": {
          if (clip === "sit_idle") seat(1);
          upper.scale.y = 1 + 0.01 * Math.sin((2 * Math.PI * tt) / 3);
          break;
        }
        case "look":
          head.rotation.y = LOOK_YAW * Math.sin((2 * Math.PI * tt) / LOOK_CYCLE_S);
          break;
        case "sit_down":
          seat(ease(tt / REST_TIMING.sitDownS));
          break;
        case "stand_up":
          seat(1 - ease(tt / REST_TIMING.standUpS));
          break;
      }
    },
    contacts(): HeroContact[] {
      root.updateMatrixWorld(true);
      const v = new THREE.Vector3();
      return contacts.map((c) => {
        c.getWorldPosition(v);
        return { name: c.name, x: v.x, y: v.y, z: v.z };
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const x of geos) x.dispose();
      for (const x of mats) x.dispose();
      root.clear();
    },
  };
}

/**
 * A prototype-sized bench for a rest stop (seat 0.45 m true x the hero scale, so she sits on it).
 * Placed at the hero's seat point with the seat's yaw: her local origin is on the seat's front
 * half, the back is behind her (-z). Display of the plan's rest event only.
 */
export function createRestBench(): { object3d: THREE.Object3D; dispose(): void } {
  const geos: THREE.BufferGeometry[] = [];
  const wood = clay("#c98b55");
  const iron = clay("#4b5563");
  const group = new THREE.Group();
  group.name = "journey-bench";
  group.userData.decorative = true;
  const inner = new THREE.Group();
  inner.scale.setScalar(HERO_DISPLAY_SCALE);
  group.add(inner);
  const box = (
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
  ) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    geos.push(geo);
    const o = new THREE.Mesh(geo, mat);
    o.position.set(x, y, z);
    o.castShadow = true;
    o.receiveShadow = true;
    o.raycast = noRaycast;
    inner.add(o);
    return o;
  };
  const T = 0.08;
  const seatMesh = box(1.9, T, 0.55, wood, 0, BENCH_SEAT_TRUE_M - T / 2, -0.08);
  seatMesh.userData.benchPart = "seat";
  box(1.9, 0.42, 0.08, wood, 0, BENCH_SEAT_TRUE_M + 0.32, -0.38);
  for (const k of [-0.8, 0.8])
    box(0.08, BENCH_SEAT_TRUE_M - T, 0.5, iron, k, (BENCH_SEAT_TRUE_M - T) / 2, -0.08);
  return {
    object3d: group,
    dispose() {
      for (const x of geos) x.dispose();
      wood.dispose();
      iron.dispose();
      group.clear();
    },
  };
}
