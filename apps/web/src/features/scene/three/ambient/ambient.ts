import * as THREE from "three";
import { hashUnit } from "../../cesium/stylised/model";
import { TIERS, type Tier } from "../../cesium/stylised/quality";
import type { LocalFrame } from "../frame";

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
 * pure function of `nowMs`, so a frame is reproducible. Display only: no shadow, no picking.
 */
export function createAmbient(
  tier: Tier,
  frame: LocalFrame,
  centre: [number, number],
  seed: string,
): {
  group: THREE.Group;
  tick(nowMs: number, weights: { day: number; dusk: number; night: number }): void;
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
  const up = new THREE.Vector3(0, 1, 0);

  let birds: THREE.InstancedMesh | null = null;
  const bird: { r: number; w: number; a0: number; alt: number; ox: number; oz: number }[] = [];
  if (spec.birds > 0) {
    const geo = chevron();
    const mat = new THREE.MeshBasicMaterial({
      color: "#2b2d31",
      side: THREE.DoubleSide,
      fog: false,
    });
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

  const wrap = (v: number) => {
    const span = CLOUD_RANGE_M * 2;
    return ((((v + CLOUD_RANGE_M) % span) + span) % span) - CLOUD_RANGE_M;
  };

  return {
    group,
    tick(nowMs, w) {
      const t = nowMs / 1000;
      if (birds) {
        birds.visible = w.night <= 0.5;
        if (birds.visible) {
          bird.forEach((b, i) => {
            const a = b.a0 + b.w * t;
            bp.set(b.ox + Math.cos(a) * b.r, b.alt, b.oz + Math.sin(a) * b.r);
            // Heading along the tangent of the loop (the chevron points along +x).
            const tx = -Math.sin(a) * Math.sign(b.w);
            const tz = Math.cos(a) * Math.sign(b.w);
            bq.setFromAxisAngle(up, Math.atan2(-tz, tx));
            birds.setMatrixAt(i, bm.compose(bp, bq, bs));
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
            bm.compose(bp, bq.identity(), bs.set(c.size, 1, c.size));
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
