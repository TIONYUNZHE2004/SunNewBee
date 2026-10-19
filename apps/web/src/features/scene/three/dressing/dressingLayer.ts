import * as THREE from "three";
import type { Tier } from "../../shared/quality";
import { patchDecorCut } from "../assets/treeCut";
import { ROAD_Y, VERGE_Y } from "../ground/bands";
import { clayMaterial } from "../shared/clayTokens";
import { bucketOf, buildDressingModels, trianglesOf } from "./dressingModels";
import { DECOR_MODELS, type DressItem } from "./dressingPlan";

/**
 * The street dressing kit as instanced meshes (B-T7): one InstancedMesh per model bucket (flowers:
 * one per tint), one shared clay material (role `dressing`, vertex colours). Items are handed in
 * whole (`setItems`); `update` draws those near the focus point, each scaled by its weight in
 * [0, 1] (1 inside, 0 outside for the plain distance gate; the detail bubble fades it, B-T8).
 *
 * Fact meshes keep `userData.sourceIds[i]`: the source id of instance i (AC-B7), and
 * `userData.fact = true`; decorative meshes carry `userData.decorative = true`. None is pickable. Display only: nothing here is read by routing or the journey.
 */
export interface DressingLayer {
  group: THREE.Group;
  setItems(items: readonly DressItem[]): void;
  /**
   * Draws the items with a weight > 0 at their weight's scale. `weight(item, d)` defaults to the
   * plain gate: 1 within `radiusM` of `focus`, else 0; a null focus hides everything (with a
   * weight, every item is still asked, at d = Infinity).
   */
  update(
    focus: readonly [number, number] | null,
    radiusM: number,
    weight?: (item: DressItem, d: number) => number,
  ): DressingStats;
  stats(): DressingStats;
  dispose(): void;
}

export interface DressingStats {
  /** Drawn instances per bucket. */
  instances: Record<string, number>;
  facts: number;
  decor: number;
  triangles: number;
  /** Largest drawn decorative weight in [0, 1] (the visible fade level; 0 when none is drawn). */
  decorMaxW: number;
}

const DECOR = new Set<string>(DECOR_MODELS);
const NOOP = () => {};
const NO_SHADOW = new Set(["zebra", "kerb", "grassTuft", "flowers"]);
/** Zebra bars sit a hair over the road surface; every other prop on the verge level. */
const baseY = (model: string) => (model === "zebra" ? ROAD_Y + 0.004 : VERGE_Y);

interface Bucket {
  key: string;
  geom: THREE.BufferGeometry;
  tris: number;
  mesh: THREE.InstancedMesh | null;
  cap: number;
  drawn: number;
}

export function createDressingLayer(opts: { tier?: Tier } = {}): DressingLayer {
  const group = new THREE.Group();
  group.name = "dressing";
  const material = clayMaterial("dressing", { vertexColors: true, tier: opts.tier });
  // Decorative models (planters, lamp posts, flowers...) get the journey's decorative occluder cut;
  // fact props (mapped benches, bins) keep the plain material and are never cut.
  const decorMaterial = clayMaterial("dressing", { vertexColors: true, tier: opts.tier });
  patchDecorCut(decorMaterial);
  const buckets = new Map<string, Bucket>();
  for (const [key, geom] of buildDressingModels())
    buckets.set(key, { key, geom, tris: trianglesOf(geom), mesh: null, cap: 0, drawn: 0 });
  let items: readonly DressItem[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let last: DressingStats = { instances: {}, facts: 0, decor: 0, triangles: 0, decorMaxW: 0 };

  function meshFor(b: Bucket, n: number): THREE.InstancedMesh {
    if (b.mesh && b.cap >= n) return b.mesh;
    if (b.mesh) {
      group.remove(b.mesh);
      b.mesh.dispose();
    }
    b.cap = Math.max(16, 2 ** Math.ceil(Math.log2(Math.max(1, n))));
    const model0 = b.key.split(":")[0]!;
    const mesh = new THREE.InstancedMesh(
      b.geom,
      DECOR.has(model0) ? decorMaterial : material,
      b.cap,
    );
    mesh.name = `dressing__${b.key}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = !NO_SHADOW.has(b.key.split(":")[0]!);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const model = b.key.split(":")[0]!;
    mesh.userData.decorative = DECOR.has(model);
    // Fact props (B-T7) are data-placed, not decoration; like every streamed slot, none is pickable.
    mesh.userData.fact = !DECOR.has(model);
    mesh.raycast = NOOP;
    mesh.userData.sourceIds = [];
    group.add(mesh);
    b.mesh = mesh;
    return mesh;
  }

  function update(
    focus: readonly [number, number] | null,
    radiusM: number,
    weight?: (item: DressItem, d: number) => number,
  ): DressingStats {
    const per = new Map<string, { item: DressItem; w: number }[]>();
    // With a weight (the bubble fade), every item is asked even without a focus (d = Infinity), so
    // a cleared focus fades the dressing out instead of dropping it in one frame.
    if (focus || weight)
      for (const it of items) {
        const d = focus ? Math.hypot(it.x - focus[0], it.z - focus[1]) : Number.POSITIVE_INFINITY;
        const w = weight ? weight(it, d) : d <= radiusM ? 1 : 0;
        if (w <= 0) continue;
        const key = bucketOf(it.model, it.tint);
        const list = per.get(key);
        if (list) list.push({ item: it, w: Math.min(1, w) });
        else per.set(key, [{ item: it, w: Math.min(1, w) }]);
      }
    const stats: DressingStats = { instances: {}, facts: 0, decor: 0, triangles: 0, decorMaxW: 0 };
    for (const b of buckets.values()) {
      const list = per.get(b.key) ?? [];
      if (list.length === 0 && !b.mesh) continue;
      const mesh = meshFor(b, list.length);
      const ids: string[] = [];
      list.forEach(({ item, w }, i) => {
        pos.set(item.x, baseY(item.model), item.z);
        q.setFromAxisAngle(up, item.yaw);
        scl.setScalar(item.s * w);
        mesh.setMatrixAt(i, m.compose(pos, q, scl));
        if (item.sourceId) ids[i] = item.sourceId;
      });
      mesh.count = list.length;
      mesh.visible = list.length > 0;
      mesh.userData.sourceIds = ids;
      mesh.instanceMatrix.needsUpdate = true;
      b.drawn = list.length;
      if (list.length > 0) stats.instances[b.key] = list.length;
      stats.triangles += list.length * b.tris;
      if (DECOR.has(b.key.split(":")[0]!)) {
        stats.decor += list.length;
        for (const e of list) stats.decorMaxW = Math.max(stats.decorMaxW, e.w);
      } else stats.facts += list.length;
    }
    last = stats;
    return stats;
  }

  return {
    group,
    setItems(next) {
      items = next;
    },
    update,
    stats: () => last,
    dispose() {
      for (const b of buckets.values()) {
        b.mesh?.dispose();
        b.geom.dispose();
      }
      buckets.clear();
      material.dispose();
      decorMaterial.dispose();
      group.clear();
    },
  };
}
