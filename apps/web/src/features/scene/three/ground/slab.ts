import * as THREE from "three";
import { applyGroundGrade } from "./bands";
import { type Boundary, insideBoundary, type P } from "./boundary";

/**
 * The diorama slab (spec 2026-10-19 resident journey A5 / B1, task A-T4): the township sits on a
 * slab whose top outline is the Elmina boundary and whose cut edge shows layered soil, as in the
 * clay prototype (`docs/03-product/prototypes/resident-journey`: a cream crust over three soil
 * layers). Display only: it says nothing about terrain, geology or flood.
 *
 * - Top: the boundary polygon (holes kept) at y = 0. It replaces the engine's rectangular base
 *   plane, so nothing is drawn as ground outside Elmina.
 * - Edge: one band per layer below the top outline. Each band steps down and OUT from the outline
 *   (a battered cut): the bands face up as well as out, so the soil section is seen on every side
 *   from the overview, the far side included (a vertical cut there faces away from the camera and
 *   hides behind the top). Only the top outline must follow the boundary; the bands lie below
 *   ground level, outside it.
 * - Soil bands take a reduced fog (SLAB_FOG_SCALE), so the far edge stays readable at the overview
 *   while the ground keeps A-T11's full distance fog (AC-A13).
 */

export interface SlabLayer {
  colour: string;
  /** Vertical thickness (m). */
  depthM: number;
  /** How far the band steps out from its top to its bottom edge (m). */
  runM: number;
}

/**
 * Top to bottom: the cream crust, then three soil layers (prototype colours). The soil bands slope
 * at about 20 degrees (depth 26 m over a 70 m run): the overview sees the far edge at about 36
 * degrees below the horizon, so a band shallower than that faces the camera on every side. 70 m of
 * run is about 3.5 px per band at the far edge (9.7 km, 5.8 m/px).
 */
export const SLAB_LAYERS: readonly SlabLayer[] = [
  { colour: "#ddd6b6", depthM: 4, runM: 3 },
  { colour: "#a87a4f", depthM: 26, runM: 70 },
  { colour: "#8b5f3c", depthM: 26, runM: 70 },
  { colour: "#c69c6d", depthM: 26, runM: 70 },
];

/** The soil colours (the crust is not soil): what the acceptance screenshot looks for. */
export const SOIL_COLOURS = SLAB_LAYERS.slice(1).map((l) => l.colour);

/**
 * Fog multiplier of the slab's edge material: at the overview the farthest boundary vertex is at
 * about 87.5% of the scene fog (A-T11), so the soil there is hazed to about 48%.
 */
export const SLAB_FOG_SCALE = 0.55;

/** A mitre never pushes an offset vertex further than this many offsets. */
const MITRE_LIMIT = 2;

/** Unit normals pointing away from the land, one per vertex (mitred), for one ring. */
function outwardMitres(b: Boundary, ring: readonly P[]): P[] {
  const n = ring.length;
  const edgeN: P[] = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const c = ring[(i + 1) % n]!;
    const dx = c[0] - a[0];
    const dz = c[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    edgeN.push([dz / l, -dx / l]);
  }
  // Which side is land: probe the longest edge's midpoint.
  let k = 0;
  let best = -1;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const c = ring[(i + 1) % n]!;
    const l = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (l > best) {
      best = l;
      k = i;
    }
  }
  const a = ring[k]!;
  const c = ring[(k + 1) % n]!;
  const probe = Math.min(1, best / 4);
  const mx = (a[0] + c[0]) / 2 + edgeN[k]![0] * probe;
  const mz = (a[1] + c[1]) / 2 + edgeN[k]![1] * probe;
  const sign = insideBoundary(b, mx, mz) ? -1 : 1;
  const out: P[] = [];
  for (let i = 0; i < n; i++) {
    const p = edgeN[(i - 1 + n) % n]!;
    const q = edgeN[i]!;
    let sx = p[0] + q[0];
    let sz = p[1] + q[1];
    const sl = Math.hypot(sx, sz);
    if (sl < 1e-6) {
      [sx, sz] = q;
    } else {
      const scale = Math.min(MITRE_LIMIT, 2 / sl);
      sx = (sx / sl) * scale;
      sz = (sz / sl) * scale;
    }
    out.push([sign * sx, sign * sz]);
  }
  return out;
}

export interface SlabGeometry {
  /** The top face (the boundary polygon) at y = 0, normals up. */
  top: THREE.BufferGeometry;
  /** The layered edge bands, vertex-coloured. */
  edge: THREE.BufferGeometry;
  /** The top outline rings (local x, z), as drawn: equal to the boundary rings. */
  outline: P[][];
  /** Per outline vertex, the outer bottom corner of the section (x, y, z). */
  foot: [number, number, number][][];
}

/** The slab geometry for a boundary (pure apart from allocating geometries). */
export function slabGeometry(
  b: Boundary,
  layers: readonly SlabLayer[] = SLAB_LAYERS,
): SlabGeometry {
  // Top: each polygon triangulated with its holes.
  const topPos: number[] = [];
  const topIdx: number[] = [];
  const outline: P[][] = [];
  for (const poly of b.polys) {
    const [outer, ...holes] = poly;
    if (!outer) continue;
    const contour = outer.map(([x, z]) => new THREE.Vector2(x, z));
    const holeVs = holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z)));
    const base = topPos.length / 3;
    const all = [...outer, ...holes.flat()];
    for (const [x, z] of all) topPos.push(x, 0, z);
    for (const f of THREE.ShapeUtils.triangulateShape(contour, holeVs)) {
      const [i0, i1, i2] = f as [number, number, number];
      // Face up (+y): in x-z, counter-clockwise seen from above is clockwise in (x, z) maths axes.
      const [ax, az] = all[i0]!;
      const [bx, bz] = all[i1]!;
      const [cx, cz] = all[i2]!;
      const ny = (cx - ax) * (bz - az) - (bx - ax) * (cz - az);
      if (ny >= 0) topIdx.push(base + i0, base + i1, base + i2);
      else topIdx.push(base + i0, base + i2, base + i1);
    }
    outline.push(outer, ...holes);
  }
  const top = new THREE.BufferGeometry();
  top.setAttribute("position", new THREE.Float32BufferAttribute(topPos, 3));
  top.setIndex(topIdx);
  const ups = new Float32Array(topPos.length);
  for (let i = 1; i < ups.length; i += 3) ups[i] = 1;
  top.setAttribute("normal", new THREE.BufferAttribute(ups, 3));

  // Edge: per ring, per layer, a band of quads between two offset rings.
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const colour = new THREE.Color();
  const foot: [number, number, number][][] = [];
  for (const ring of outline) {
    const n = ring.length;
    const mitres = outwardMitres(b, ring);
    let off = 0;
    let y = 0;
    for (const layer of layers) {
      colour.set(layer.colour);
      const base = pos.length / 3;
      const off1 = off + layer.runM;
      const y1 = y - layer.depthM;
      for (let i = 0; i < n; i++) {
        const [x, z] = ring[i]!;
        const [mx, mz] = mitres[i]!;
        pos.push(x + mx * off, y, z + mz * off, x + mx * off1, y1, z + mz * off1);
        col.push(colour.r, colour.g, colour.b, colour.r, colour.g, colour.b);
      }
      for (let i = 0; i < n; i++) {
        const t0 = base + i * 2;
        const b0 = t0 + 1;
        const t1 = base + ((i + 1) % n) * 2;
        const b1 = t1 + 1;
        idx.push(t0, b0, t1, b0, b1, t1);
      }
      off = off1;
      y = y1;
    }
    foot.push(ring.map(([x, z], i) => [x + mitres[i]![0] * off, y, z + mitres[i]![1] * off]));
  }
  const edge = new THREE.BufferGeometry();
  edge.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  edge.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  edge.setIndex(idx);
  orientOutward(edge);
  edge.computeVertexNormals();
  return { top, edge, outline, foot };
}

/**
 * Every band steps down and out (run > 0), so its outward face has a normal with +y: flips any
 * triangle whose normal points down (so FrontSide shows the outside of the cut).
 */
function orientOutward(g: THREE.BufferGeometry) {
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const ix = g.getIndex()!;
  const arr = ix.array as Uint32Array | Uint16Array;
  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const C = new THREE.Vector3();
  for (let t = 0; t + 2 < arr.length; t += 3) {
    A.fromBufferAttribute(p, arr[t]!);
    B.fromBufferAttribute(p, arr[t + 1]!);
    C.fromBufferAttribute(p, arr[t + 2]!);
    const ny = (B.z - A.z) * (C.x - A.x) - (B.x - A.x) * (C.z - A.z);
    if (ny < 0) {
      const tmp = arr[t + 1]!;
      arr[t + 1] = arr[t + 2]!;
      arr[t + 2] = tmp;
    }
  }
  ix.needsUpdate = true;
}

/** The edge material: vertex colours, night grade, reduced fog (SLAB_FOG_SCALE). */
export function slabEdgeMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const fog = THREE.ShaderChunk.fog_fragment.replace(
    "fogColor, fogFactor )",
    `fogColor, fogFactor * ${SLAB_FOG_SCALE.toFixed(3)} )`,
  );
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <fog_fragment>", fog);
  };
  m.customProgramCacheKey = () => "slabEdge";
  applyGroundGrade(m);
  return m;
}

export interface SlabLayerObject {
  group: THREE.Group;
  /** The top face mesh (drawn with the engine's ground material). */
  top: THREE.Mesh;
  edge: THREE.Mesh;
  outline: P[][];
  dispose(): void;
}

/**
 * The slab meshes: `top` with the given ground material (the engine's base-plane material, so the
 * ground looks and grades as before), `edge` with its own material. The group is tagged
 * `decorative`; nothing in it is pickable.
 */
export function createSlab(b: Boundary, groundMat: THREE.Material): SlabLayerObject {
  const g = slabGeometry(b);
  const edgeMat = slabEdgeMaterial();
  const top = new THREE.Mesh(g.top, groundMat);
  top.name = "slab-top";
  top.receiveShadow = true;
  const edge = new THREE.Mesh(g.edge, edgeMat);
  edge.name = "slab-edge";
  edge.receiveShadow = true;
  const group = new THREE.Group();
  group.name = "slab";
  group.userData.decorative = true;
  // For the acceptance hook (pick masks, outline projection): the outline it was built from.
  group.userData.boundary = b;
  group.userData.outline = g.outline;
  group.userData.foot = g.foot;
  group.add(top, edge);
  return {
    group,
    top,
    edge,
    outline: g.outline,
    dispose() {
      g.top.dispose();
      g.edge.dispose();
      edgeMat.dispose();
    },
  };
}
