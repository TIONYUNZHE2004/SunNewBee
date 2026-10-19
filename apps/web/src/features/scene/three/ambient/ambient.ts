import * as THREE from "three";
import { hashUnit } from "../../shared/model";
import { TIERS, type Tier } from "../../shared/quality";
import type { LocalFrame } from "../frame";
import { type Boundary, clearance, insideBoundary } from "../ground/boundary";

export const CLOUD_SHADOW_Y = 0.11;
/** After the ground bands (1 to 5) and the lamp pools (6), before overlays (10 and up). */
const CLOUD_RENDER_ORDER = 7;
const CLOUD_DRIFT_MPS = 3;
const CLOUD_OPACITY = 0.2;
/** Clouds wrap inside a square of this half-width around the centre. */
const CLOUD_RANGE_M = 1500;
const BIRD_ALT_M: [number, number] = [40, 90];
const BIRD_ORBIT_M: [number, number] = [150, 450];
const BIRD_SPEED_MPS: [number, number] = [6, 10];
const BIRD_SPAN_M = 3;
/** Wing beats per second, and the wing-tip lift either way (m), in the bird vertex shader. */
export const BIRD_FLAP_HZ = 3;
const BIRD_FLAP_M = 0.45;
/** Bank never exceeds this (rad, 30 deg). */
export const BIRD_MAX_BANK = Math.PI / 6;
/** Bank is the coordinated-turn angle atan(v w / g), exaggerated this much so it reads from afar. */
const BANK_GAIN = 3;
const G = 9.81;

/**
 * Bank (roll about the body axis) for a bird flying at v m/s while turning at w rad/s: signed like
 * w, so the inner wing dips, and bounded by BIRD_MAX_BANK. Decorative.
 */
export function birdBank(v: number, w: number): number {
  const b = Math.atan((BANK_GAIN * Math.abs(v * w)) / G);
  return Math.sign(v * w) === 0 ? 0 : Math.sign(w) * Math.min(BIRD_MAX_BANK, b);
}

const glf = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

/**
 * The wing-flap vertex term: tips (|z| = half span) rise and fall by BIRD_FLAP_M at BIRD_FLAP_HZ,
 * the body stays put; each bird's phase comes from its instance position. uTime is real seconds.
 */
function addFlap(mat: THREE.Material, uTime: { value: number }) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "uniform float uTime;\nvoid main() {")
      .replace(
        "#include <begin_vertex>",
        [
          "#include <begin_vertex>",
          "float flapPhase = 0.0;",
          "#ifdef USE_INSTANCING",
          "flapPhase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;",
          "#endif",
          `transformed.y += sin( uTime * ${glf(2 * Math.PI * BIRD_FLAP_HZ)} + flapPhase ) * ${glf(BIRD_FLAP_M)} * abs( position.z ) / ${glf(BIRD_SPAN_M / 2)};`,
        ].join("\n"),
      );
  };
  mat.customProgramCacheKey = () => "bird-flap";
}

const noRaycast = () => {};
const lerp = (r: [number, number], u: number) => r[0] + (r[1] - r[0]) * u;

/** Soft black blob, alpha only, for the cloud shadow decals. */
function blobTexture(): THREE.DataTexture {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const d = Math.hypot((i + 0.5) / n - 0.5, (j + 0.5) / n - 0.5) * 2;
      const f = Math.max(0, 1 - d);
      data[(j * n + i) * 4 + 3] = Math.round(255 * f * f * (3 - 2 * f));
    }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** A flat V seen from above: two triangles, wing tips back, body forward along +x. */
function chevron(): THREE.BufferGeometry {
  const h = BIRD_SPAN_M / 2;
  const g = new THREE.BufferGeometry();
  // Body tip at +x; each wing sweeps back to +-z with a short trailing edge.
  const v = [0.6, 0, 0, -0.6, 0.15, -h, -0.2, 0, 0, 0.6, 0, 0, -0.2, 0, 0, -0.6, 0.15, h];
  g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Decorative ambient life. Birds (by day, hidden once night > 0.5): `TIERS[tier].birds` small
 * chevrons on slow loops at 40 to 90 m. Cloud shadows (by day, hidden once day < 0.5):
 * `TIERS[tier].clouds` large soft dark decals at y = 0.11 drifting 3 m/s. Seeded; positions are a
 * pure function of `nowMs`, so a frame is reproducible (and smooth at any tick rate). Birds bank
 * into their turn and flap in the vertex shader (uTime = nowMs / 1000, so a stopped clock freezes
 * them). Display only: no shadow, no picking.
 */
export function createAmbient(
  tier: Tier,
  frame: LocalFrame,
  centre: [number, number],
  seed: string,
  /**
   * The Elmina outline (A-T4): a bird outside it, or a cloud shadow not wholly inside it (its square
   * decal's corners reach size / sqrt 2 from its centre; it would darken the void past the slab), is hidden for that tick. Positions are world xz (the group's
   * position plus the local one).
   */
  boundary: Boundary | null = null,
): {
  group: THREE.Group;
  tick(nowMs: number, weights: { day: number; dusk: number; night: number }): void;
  /** Each bird's orbit centre (local xz), for tests. */
  readonly birdOrbits: readonly [number, number][];
  /**
   * Re-runs the last tick (same time and weights): after the group moves, so the outline test
   * (which reads the group position) is redone even while the motion clock is stopped.
   */
  refresh(): void;
  dispose(): void;
} {
  const spec = TIERS[tier];
  const [cx, cz] = frame.toLocal(centre[0], centre[1]);
  const group = new THREE.Group();
  group.name = "ambient";
  group.userData.decorative = true;
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const finish = (m: THREE.InstancedMesh, name: string, order: number) => {
    m.name = name;
    m.renderOrder = order;
    m.castShadow = false;
    m.receiveShadow = false;
    m.frustumCulled = false;
    m.userData.decorative = true;
    m.raycast = noRaycast;
    group.add(m);
  };

  const bm = new THREE.Matrix4();
  const bq = new THREE.Quaternion();
  const bp = new THREE.Vector3();
  const bs = new THREE.Vector3(1, 1, 1);
  /** A hidden instance (outside the outline): zero scale. */
  const zero = new THREE.Vector3(0, 0, 0);
  const up = new THREE.Vector3(0, 1, 0);
  const fwd = new THREE.Vector3(1, 0, 0);
  const roll = new THREE.Quaternion();
  const flapTime = { value: 0 };

  let birds: THREE.InstancedMesh | null = null;
  const bird: {
    r: number;
    w: number;
    a0: number;
    alt: number;
    ox: number;
    oz: number;
    bank: number;
  }[] = [];
  if (spec.birds > 0) {
    const geo = chevron();
    const mat = new THREE.MeshBasicMaterial({
      color: "#2b2d31",
      side: THREE.DoubleSide,
      fog: false,
    });
    addFlap(mat, flapTime);
    geometries.push(geo);
    materials.push(mat);
    birds = new THREE.InstancedMesh(geo, mat, spec.birds);
    for (let i = 0; i < spec.birds; i++) {
      const id = `${seed}:bird:${i}`;
      const r = lerp(BIRD_ORBIT_M, hashUnit(id, "r"));
      const v = lerp(BIRD_SPEED_MPS, hashUnit(id, "v"));
      const dir = hashUnit(id, "dir") < 0.5 ? -1 : 1;
      bird.push({
        r,
        w: (dir * v) / r,
        bank: birdBank(v, (dir * v) / r),
        a0: hashUnit(id, "a0") * Math.PI * 2,
        alt: lerp(BIRD_ALT_M, hashUnit(id, "alt")),
        ox: cx + (hashUnit(id, "ox") - 0.5) * 600,
        oz: cz + (hashUnit(id, "oz") - 0.5) * 600,
      });
    }
    finish(birds, "ambient-birds", 12);
  }

  let clouds: THREE.InstancedMesh | null = null;
  let cloudMat: THREE.MeshBasicMaterial | null = null;
  const cloud: { x: number; z: number; size: number }[] = [];
  if (spec.clouds > 0) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const map = blobTexture();
    cloudMat = new THREE.MeshBasicMaterial({
      color: "#000000",
      map,
      transparent: true,
      opacity: CLOUD_OPACITY,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
      fog: false,
    });
    geometries.push(geo);
    materials.push(cloudMat);
    textures.push(map);
    clouds = new THREE.InstancedMesh(geo, cloudMat, spec.clouds);
    for (let i = 0; i < spec.clouds; i++) {
      const id = `${seed}:cloud:${i}`;
      cloud.push({
        x: (hashUnit(id, "x") * 2 - 1) * CLOUD_RANGE_M,
        z: (hashUnit(id, "z") * 2 - 1) * CLOUD_RANGE_M,
        size: lerp([120, 300], hashUnit(id, "size")),
      });
    }
    finish(clouds, "ambient-cloud-shadows", CLOUD_RENDER_ORDER);
  }

  let last: { nowMs: number; w: { day: number; dusk: number; night: number } } | null = null;
  const wrap = (v: number) => {
    const span = CLOUD_RANGE_M * 2;
    return ((((v + CLOUD_RANGE_M) % span) + span) % span) - CLOUD_RANGE_M;
  };

  return {
    group,
    birdOrbits: bird.map((b) => [b.ox, b.oz] as [number, number]),
    refresh() {
      if (last) this.tick(last.nowMs, last.w);
    },
    tick(nowMs, w) {
      last = { nowMs, w: { ...w } };
      const t = nowMs / 1000;
      flapTime.value = t;
      if (birds) {
        birds.visible = w.night <= 0.5;
        if (birds.visible) {
          bird.forEach((b, i) => {
            const a = b.a0 + b.w * t;
            bp.set(b.ox + Math.cos(a) * b.r, b.alt, b.oz + Math.sin(a) * b.r);
            // Heading along the tangent of the loop (the chevron points along +x).
            const tx = -Math.sin(a) * Math.sign(b.w);
            const tz = Math.cos(a) * Math.sign(b.w);
            // Heading, then the bank about the body axis (+x), inner wing down.
            bq.setFromAxisAngle(up, Math.atan2(-tz, tx)).multiply(
              roll.setFromAxisAngle(fwd, b.bank),
            );
            const out =
              boundary !== null &&
              !insideBoundary(boundary, bp.x + group.position.x, bp.z + group.position.z);
            birds.setMatrixAt(i, bm.compose(bp, bq, out ? zero : bs));
          });
          birds.instanceMatrix.needsUpdate = true;
        }
      }
      if (clouds && cloudMat) {
        clouds.visible = w.day >= 0.5;
        cloudMat.opacity = CLOUD_OPACITY * Math.min(1, w.day);
        if (clouds.visible) {
          cloud.forEach((c, i) => {
            bp.set(cx + wrap(c.x + CLOUD_DRIFT_MPS * t), CLOUD_SHADOW_Y, cz + c.z);
            const out =
              boundary !== null &&
              clearance(boundary, bp.x + group.position.x, bp.z + group.position.z) <
                c.size * Math.SQRT1_2;
            bm.compose(bp, bq.identity(), out ? zero : bs.set(c.size, 1, c.size));
            clouds.setMatrixAt(i, bm);
            bs.set(1, 1, 1);
          });
          clouds.instanceMatrix.needsUpdate = true;
        }
      }
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
      birds?.dispose();
      clouds?.dispose();
      group.clear();
    },
  };
}
