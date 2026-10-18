import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { BuildingsLayer } from "../../../lib/api";
import { statusStyle, WATER_COLOR } from "../styles";
import { createAmbient } from "./ambient/ambient";
import { createCityInstances } from "./assets/cityInstances";
import type { Placement } from "./assets/fit";
import type { AssetLibrary } from "./assets/library";
import { type Manifest, parseManifest } from "./assets/manifest";
import { type CityPlan, facadeInputs, roofInputs } from "./assets/plan";
import { createMotionUniforms, createRoleUniforms } from "./assets/roleMaterial";
import { isFallback } from "./cityInfo";
import { buildCityGeometry } from "./cityMesh";
import { createFacadeLayer } from "./facade/facadeLayer";
import { facadeInstances, WALL_OFFSET_M } from "./facade/facadePlan";
import { DECK_POOL_COLOUR, podiumDeck } from "./facade/podiumDeck";
import { createRoofLayer } from "./facade/roofLayer";
import { ROOF_TINTS } from "./facade/roofPlan";
import { fallbackColours } from "./fallbackStyle";
import { createFrame } from "./frame";
import { createGroundDecorLayer } from "./ground/groundDecor";
import { createGroundLayer } from "./ground/groundLayer";
import { LANDCOVER_COLOURS, landcoverMesh } from "./ground/landcover";
import { STALL_COLOUR } from "./ground/lotLayer";
import type { Ribbon } from "./ground/ribbons";
import type { Agent } from "./motion/agents";
import { createMotionDriver, DECOR_FADE_MS, MOTION_FRAME_MS } from "./motion/motionClock";
import { createMotionLayer } from "./motion/motionLayer";
import { createOverlayLayer } from "./overlays/accessLayers";
import { createFloodLayer, FLOOD_LIFT_M } from "./overlays/floodLayer";
import { createResidents } from "./overlays/residents";
import { pickAt } from "./pick";
import { GRAVEL_TINT, TRACK_COLOUR } from "./props/construction";
import { createLampPools } from "./props/lampPools";
import { unionById, unionKits } from "./scene/union";
import { nearFacades } from "./scene/useFacades";
import { groundDecorPartsOf } from "./scene/useGroundDecor";
import { nearRoofs } from "./scene/useRoofs";
import { planSigns } from "./signs/signPlan";
import type { ActiveTile } from "./stream/streamer";
import { bucketFacades, bucketRoofs, planTile } from "./stream/tilePlan";
import { tileAt } from "./stream/tiles";

// Spec §5: the honesty tests. Decorative content is never a fact, never picked, never a flood.

const frame = createFrame([101.5, 3.18]);

// ---- fixtures -------------------------------------------------------------------------------

const lods = [
  { node: "x__v__LOD0", tris: 12, maxM: 300 },
  { node: "x__v__LOD1", tris: 12, maxM: 1500 },
  { node: "x__v__LOD2", tris: 12, maxM: null },
];
const spec = (group: "archetype" | "kit" | "landmark", decorative: boolean, wall = "#112233") => ({
  group,
  file: "x.glb",
  bytes: 1,
  repeat: "none" as const,
  frontage: "long" as const,
  fit: { xz: [0.5, 2], y: [0.5, 2] } as { xz: [number, number]; y: [number, number] },
  decorative,
  placement: null,
  jitter: {},
  variantByGroup: {},
  palettes: { default: [[wall, "#445566", "#778899"]] as [string, string, string][] },
  variants: { v: { size: [4, 4, 4] as [number, number, number], lods } },
});
const manifest = (): Manifest => ({
  version: 1,
  as_of: "",
  precinctGroups: [],
  assets: {
    semi_d: spec("archetype", false, "#aa1100"),
    trees: spec("kit", true),
    furniture: spec("kit", true),
    people: spec("kit", true),
    vehicles: spec("kit", true),
    deco_landmark: spec("landmark", true),
  },
  landmarks: {},
});
const lib = (): AssetLibrary => {
  const geos = new Map<string, THREE.BufferGeometry>();
  return {
    geometry(a, v, l) {
      const k = `${a}/${v}/${l}`;
      if (!geos.has(k)) {
        const g = new THREE.BoxGeometry(4, 4, 4);
        g.translate(0, 2, 0);
        geos.set(k, g);
      }
      return geos.get(k) ?? null;
    },
    has: () => true,
    gpuBytes: () => 0,
    failed: [],
    dispose() {},
  };
};
const pl = (asset: string, i: number): Placement => ({
  id: `${asset}${i}`,
  asset,
  variant: "v",
  x: i * 20,
  z: 0,
  yaw: 0,
  sx: 1,
  sy: 1,
  sz: 1,
  palette: ["#aa0000", "#00aa00", "#0000aa"],
});
const emptyPlan = (landmarks: Placement[] = []): CityPlan => ({
  placements: new Map(),
  extrude: new Set(),
  landmarks,
  stats: { placed: 0, units: 0, fallback: {} },
});
const agent = (id: string, kind: Agent["kind"], z: number): Agent => ({
  id,
  kind,
  variant: "v",
  path: new Float32Array([0, z, 100, z]),
  length: 100,
  speed: kind === "vehicle" ? 10 : 1.3,
  offset: 0,
});
const ribbon = (kind: Ribbon["kind"], marking = false): Ribbon => ({
  positions: new Float32Array([0, 0.08, 0, 10, 0.08, 0, 10, 0.08, 10]),
  indices: new Uint32Array([0, 2, 1]),
  kind,
  marking,
});
const landcoverFc = (): GeoJSON.FeatureCollection => {
  const sq = (cls: string, e0: number): GeoJSON.Feature => {
    const pt = (e: number, n: number) => frame.toLonLat(e, -n);
    return {
      type: "Feature",
      properties: { class: cls },
      geometry: {
        type: "Polygon",
        coordinates: [[pt(e0, 0), pt(e0 + 10, 0), pt(e0 + 10, 10), pt(e0, 10), pt(e0, 0)]],
      },
    };
  };
  return {
    type: "FeatureCollection",
    features: Object.keys(LANDCOVER_COLOURS).map((c, i) => sq(c, i * 20)),
  };
};

/** Every decorative layer the scene can draw, built from the small fixtures above. */
function decorativeLayers() {
  const roles = createRoleUniforms();
  const motion = createMotionUniforms();
  const kitRoot = createCityInstances(
    lib(),
    emptyPlan([pl("deco_landmark", 0)]),
    manifest(),
    roles,
    {
      kits: new Map([
        ["trees/v", [pl("trees", 0), pl("trees", 1)]],
        ["furniture/v", [pl("furniture", 0)]],
      ]),
      motion,
    },
  );
  kitRoot.update(new THREE.Vector3());
  const ground = createGroundLayer(
    [ribbon("major"), ribbon("residential"), ribbon("major", true)],
    landcoverMesh(landcoverFc(), frame),
    "high",
    { value: 0 },
  );
  const lamps = createLampPools([pl("furniture", 0)], roles);
  const agents = createMotionLayer(
    [agent("p", "person", 0), agent("c", "vehicle", 5)],
    lib(),
    manifest(),
    roles,
    motion,
  );
  agents.tick(0, new THREE.Vector3(0, 30, 0));
  const ambient = createAmbient("high", frame, [101.5, 3.18], "honesty");
  ambient.tick(0, { day: 1, dusk: 0, night: 0 });
  return {
    "props and decorative landmark": kitRoot.group as THREE.Object3D,
    ground: ground.group,
    "lamp pools": lamps.mesh as THREE.Object3D,
    "motion layer": agents.group,
    ambient: ambient.group,
  };
}

const drawables = (root: THREE.Object3D) => {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh & THREE.Points;
    if (m.isMesh || m.isPoints || (o as THREE.InstancedMesh).isInstancedMesh) out.push(o);
  });
  return out;
};
const PROTO_RAYCASTS = new Set<unknown>([
  THREE.Mesh.prototype.raycast,
  THREE.InstancedMesh.prototype.raycast,
  THREE.Points.prototype.raycast,
]);

// ---- 1. decorative objects are tagged, unpickable --------------------------------------------

describe("honesty 1: decorative objects", () => {
  const layers = decorativeLayers();

  for (const [name, root] of Object.entries(layers)) {
    it(`${name}: every drawable is userData.decorative and raycasts to nothing`, () => {
      const list = drawables(root);
      expect(list.length).toBeGreaterThan(0);
      for (const o of list) {
        expect(o.userData.decorative, `${name}/${o.name}`).toBe(true);
        expect(PROTO_RAYCASTS.has(o.raycast), `${name}/${o.name} raycast`).toBe(false);
        o.updateMatrixWorld(true);
        const centre = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
        const rc = new THREE.Raycaster(
          new THREE.Vector3(centre.x, centre.y + 500, centre.z),
          new THREE.Vector3(0, -1, 0),
        );
        const hits: THREE.Intersection[] = [];
        o.raycast(rc, hits);
        expect(hits).toEqual([]);
      }
    });
  }

  it("pickAt never returns a decorative object, even one tagged pickable and in front of a building", () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    camera.position.set(0, 0, 50);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const building = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), new THREE.MeshBasicMaterial());
    building.userData.pick = { kind: "building" };
    building.userData.faces = { ids: ["a", "b"], starts: [8, 10] };
    // A decorative plane between camera and building that would win on distance if it were testable.
    const front = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial());
    front.position.z = 20;
    front.userData.decorative = true;
    front.userData.pick = { kind: "building" };
    front.userData.faces = { ids: ["decor"], starts: [0] };
    const group = new THREE.Group();
    group.userData.decorative = true;
    const nested = front.clone();
    nested.userData = { pick: { kind: "building" }, faces: { ids: ["nested"], starts: [0] } };
    group.add(nested);
    const hit = pickAt({ x: 0, y: 0 }, camera, [building, front, group]);
    expect(hit).toEqual({ kind: "building", id: "a" });
    expect(pickAt({ x: 0, y: 0 }, camera, [front, group])).toBeNull();
  });

  it("fallback styling is derived from the manifest palette, not invented (R-A)", () => {
    const m = manifest();
    const c = fallbackColours({ id: "b1", kind: "residential" }, m, []);
    expect(c.wall).toBe("#aa1100");
    expect(c.roof).toBe("#445566");
    // A fallback is a real, pickable building: the card says it is drawn as a simple block.
    expect(isFallback({ manifest: m, extruded: new Set(["b1"]) }, "b1")).toBe(true);
    expect(isFallback({ manifest: m, extruded: new Set() }, "b1")).toBe(false);
    expect(isFallback({ manifest: null, extruded: null }, "b1")).toBe(true);
  });
});

// ---- 2. signs carry a source ------------------------------------------------------------------

describe("honesty 2: signs", () => {
  const ll = (x: number, z: number) => frame.toLonLat(x, z);
  const fc = (...features: unknown[]) => ({ type: "FeatureCollection", features });
  const building = {
    type: "Feature",
    properties: { id: "b1", height_m: 12, kind: "retail" },
    geometry: {
      type: "Polygon",
      coordinates: [[ll(0, 0), ll(20, 0), ll(20, 10), ll(0, 10), ll(0, 0)]],
    },
  };
  const street = {
    type: "Feature",
    properties: { id: "s1", type: "footway" },
    geometry: { type: "LineString", coordinates: [ll(-50, 30), ll(80, 30)] },
  };
  const sign = (id: string, over: Record<string, unknown> = {}) => ({
    type: "Feature",
    properties: {
      id,
      text: "Central Mart",
      building_id: "b1",
      source_url: "https://www.openstreetmap.org/way/1",
      source_label: "OpenStreetMap",
      as_of: "2026-10-17",
      ...over,
    },
    geometry: { type: "Point", coordinates: ll(10, 5) },
  });

  it("never emits a sign without source.url and source.asOf", () => {
    const { signs, dropped } = planSigns(
      fc(
        sign("ok"),
        sign("no-url", { source_url: undefined }),
        sign("blank-url", { source_url: "  " }),
        sign("bad-scheme", { source_url: "javascript:alert(1)" }),
        sign("no-date", { as_of: undefined }),
        sign("blank-date", { as_of: "" }),
        sign("no-text", { text: "" }),
      ),
      fc(building),
      fc(street),
      frame,
    );
    expect(signs.map((s) => s.id)).toEqual(["ok"]);
    expect(dropped.no_source).toBe(6);
    for (const s of signs) {
      expect(s.source.url).toMatch(/^https?:\/\//);
      expect(s.source.asOf).toBeTruthy();
    }
  });
});

// ---- 3. the fade -------------------------------------------------------------------------------

describe("honesty 3: people and vehicles fade out for Day and Rollout", () => {
  const setup = (running: boolean) => {
    const role = createRoleUniforms();
    const state = { running };
    const driver = createMotionDriver({
      role,
      ambient: () => null,
      running: () => state.running,
    });
    const layer = createMotionLayer(
      [agent("p", "person", 0), agent("c", "vehicle", 5)],
      lib(),
      manifest(),
      role,
      createMotionUniforms(),
    );
    driver.setAgents(layer);
    const cam = new THREE.Vector3(0, 30, 0);
    return { driver, layer, cam };
  };
  const shown = (root: THREE.Object3D) =>
    drawables(root).filter((o) => {
      for (let n: THREE.Object3D | null = o; n; n = n.parent) if (!n.visible) return false;
      return true;
    });

  it("running: target 0 reaches hidden within 1000 ms (± one tick)", () => {
    const { driver, layer, cam } = setup(true);
    driver.tick(0, cam);
    expect(shown(layer.group).length).toBeGreaterThan(0);
    driver.setTarget(0);
    let t = 0;
    while (t < DECOR_FADE_MS + MOTION_FRAME_MS) {
      t += MOTION_FRAME_MS;
      driver.tick(t, cam);
    }
    expect(driver.opacity).toBe(0);
    expect(shown(layer.group)).toEqual([]);
    // Hidden no later than 1000 ms + one tick after the target changed.
    expect(t).toBeLessThanOrEqual(DECOR_FADE_MS + 2 * MOTION_FRAME_MS);
  });

  it("stopped: the fade applies at once", () => {
    const { driver, layer, cam } = setup(false);
    driver.tick(0, cam);
    driver.setTarget(0);
    expect(driver.opacity).toBe(0);
    expect(shown(layer.group)).toEqual([]);
    driver.setTarget(1);
    driver.tick(MOTION_FRAME_MS, cam);
    expect(driver.opacity).toBe(1);
  });
});

// ---- 4. flood is flat and static ---------------------------------------------------------------

describe("honesty 4: scenario water is flat, matte and still", () => {
  const ring = (x: number, y: number, s = 1e-3) => [
    [x, y],
    [x + s, y],
    [x + s, y + s],
    [x, y + s],
    [x, y],
  ];
  const water = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { surface_height_m: 7.5 },
        geometry: { type: "Polygon", coordinates: [ring(101.5, 3.18)] },
      },
    ],
  };
  const edge = (id: string, status: string, a: number) => ({
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [101.5 + a * 1e-4, 3.18],
        [101.5 + a * 1e-4 + 1e-4, 3.18],
      ],
    },
    properties: { id, status },
  });
  const edges = {
    type: "FeatureCollection",
    features: [edge("a", "flooded_likely", 0), edge("b", "flooded_possible", 1)],
  };
  const layer = createFloodLayer(water, edges, frame);
  const all = [...layer.ground.children, ...layer.group.children];

  it("the fill is flat at 0.30 m in the main scene", () => {
    const fill = layer.ground.children[0] as THREE.Mesh;
    expect(fill).toBeInstanceOf(THREE.Mesh);
    const pos = fill.geometry.getAttribute("position");
    expect(pos.count).toBeGreaterThan(0);
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBeCloseTo(FLOOD_LIFT_M, 6);
    expect(FLOOD_LIFT_M).toBe(0.3);
    expect((fill.material as THREE.MeshBasicMaterial).color.getHexString()).toBe(
      new THREE.Color(WATER_COLOR).getHexString(),
    );
  });

  it("no water-surface material and no animated uniform on any flood object", () => {
    expect(all.length).toBeGreaterThan(1);
    for (const o of all) {
      const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
      expect(mat).toBeDefined();
      expect(mat).not.toBeInstanceOf(THREE.MeshPhysicalMaterial);
      expect((mat as { transmission?: number }).transmission ?? 0).toBe(0);
      // No shader patching of a base material (the shimmer technique) ...
      if (!(mat as THREE.ShaderMaterial).isShaderMaterial)
        expect(mat?.onBeforeCompile).toBe(THREE.Material.prototype.onBeforeCompile);
      // ... and no time-like uniform on shader materials (the line batches).
      const uniforms = (mat as THREE.ShaderMaterial).uniforms ?? {};
      for (const k of Object.keys(uniforms)) expect(k).not.toMatch(/time/i);
      expect(o.userData.decorative).not.toBe(true);
    }
  });
});

// ---- 5. colours never alias a flood class ------------------------------------------------------

describe("honesty 5: no land-cover or base-water colour equals a flood colour", () => {
  const FLOOD = [
    "#C53030",
    "#DD6B20",
    "#1e6fb8",
    statusStyle("flooded_likely").color,
    statusStyle("flooded_possible").color,
    WATER_COLOR,
  ].map((c) => new THREE.Color(c).getHexString());

  it("flood colours are the documented ones", () => {
    expect(new THREE.Color(WATER_COLOR).getHexString()).toBe("1e6fb8");
    expect(statusStyle("flooded_likely").color.toLowerCase()).toBe("#c53030");
    expect(statusStyle("flooded_possible").color.toLowerCase()).toBe("#dd6b20");
  });
  it("the land-cover table (and base water #7fb6c9) avoids every flood colour", () => {
    expect(LANDCOVER_COLOURS.water?.toLowerCase()).toBe("#7fb6c9");
    for (const [cls, hex] of Object.entries(LANDCOVER_COLOURS))
      expect(FLOOD, cls).not.toContain(new THREE.Color(hex).getHexString());
  });
  it("every vertex colour of a real land-cover mesh avoids them too", () => {
    const col = landcoverMesh(landcoverFc(), frame).getAttribute("color");
    expect(col.count).toBeGreaterThan(0);
    const floodRgb = FLOOD.map((h) => new THREE.Color(`#${h}`));
    const c = new THREE.Color();
    for (let i = 0; i < col.count; i++) {
      c.setRGB(col.getX(i), col.getY(i), col.getZ(i));
      for (const f of floodRgb) expect(c.equals(f)).toBe(false);
    }
  });
});

// ---- 6. P4 decor: facades, roofs, verges, shrubs, parking, construction, streamed kits ----------

// Task 14. One streamed tile planned for real (real kit manifest), far from the hero (no boost):
// a street (verges, shrubs), a parking lot (stalls, parked cars), a construction site (tracks,
// gravel, kits) and two buildings (facades; the big one gets a dressed roof).
const realManifest = parseManifest(
  JSON.parse(
    readFileSync(new URL("../../../../public/city/manifest.json", import.meta.url), "utf8"),
  ),
).manifest as Manifest;
const SEED = "../../../../../../data/seed/elmina/";
const seedJson = (p: string) =>
  JSON.parse(readFileSync(new URL(`${SEED}${p}`, import.meta.url), "utf8"));
const far = createFrame([101.6, 3.3]);
const fll = (x: number, z: number) => far.toLonLat(x, z);
const ffc = (...features: unknown[]) => ({ type: "FeatureCollection", features });
const box = (props: Record<string, unknown>, [x0, z0, x1, z1]: number[]) => ({
  type: "Feature",
  properties: props,
  geometry: {
    type: "Polygon",
    coordinates: [[fll(x0!, z0!), fll(x1!, z0!), fll(x1!, z1!), fll(x0!, z1!), fll(x0!, z0!)]],
  },
});
const P4_WALK = ffc({
  type: "Feature",
  properties: { id: "s1", type: "street" },
  geometry: { type: "LineString", coordinates: [fll(5, 60), fll(245, 60)] },
});
const P4_LAYER = {
  attribution: [],
  buildings: ffc(
    box({ id: "shop", kind: "retail", height_m: 9.6 }, [20, 20, 60, 40]),
    box({ id: "hall", kind: "industrial", height_m: 12 }, [70, 10, 120, 45]),
  ),
  parks: ffc(),
  water: ffc(),
  trees: ffc(),
  landcover: ffc(
    box({ class: "parking" }, [20, 120, 120, 200]),
    box({ class: "construction" }, [150, 20, 240, 220]),
  ),
  signage: ffc(),
} as unknown as BuildingsLayer;
const p4City = buildCityGeometry(P4_LAYER, far);
const P4_TILE = tileAt(10, 10);
const p4Content = planTile(
  {
    frame: far,
    walk: P4_WALK,
    buildings: P4_LAYER,
    manifest: realManifest,
    facades: bucketFacades(facadeInputs(p4City.footprints, P4_LAYER, realManifest)),
    roofs: bucketRoofs(roofInputs(p4City.footprints, P4_LAYER, realManifest, far)),
  },
  P4_TILE,
  0,
  "high",
);
const p4Active: ActiveTile[] = [{ key: P4_TILE.key, tile: P4_TILE, ring: 0, content: p4Content }];

/** Every P4 decor layer, built from that tile the way the scene hooks build them. */
function p4Layers() {
  const roles = createRoleUniforms();
  const motion = createMotionUniforms();
  const facades = createFacadeLayer(nearFacades(p4Active).flat(), roles, "high", motion);
  const roofPlans = nearRoofs(p4Active);
  const podium = podiumDeck(
    {
      id: "deck",
      ring: [
        [300, 0],
        [380, 0],
        [380, -50],
        [300, -50],
      ],
      heightM: 8.71,
    },
    [],
  );
  const roofs = createRoofLayer(
    roofPlans.flatMap((p) => p.items),
    roles,
    "high",
    [...roofPlans.flatMap((p) => p.decks), ...(podium ? [podium] : [])],
  );
  const parts = groundDecorPartsOf(p4Active, "high");
  const groundDecor = parts ? createGroundDecorLayer(parts, { value: 0 }) : null;
  const stalls = p4Content.parking ? [p4Content.parking.stalls] : [];
  const roads = createGroundLayer(
    p4Content.ribbons,
    new THREE.BufferGeometry(),
    "high",
    { value: 0 },
    stalls,
  );
  const kits = createCityInstances(lib(), emptyPlan(), realManifest, roles, { motion });
  kits.setKits(unionKits(p4Active));
  kits.update(new THREE.Vector3(100, 30, 100));
  return { facades, roofs, groundDecor, roads, kits };
}
const kitIds = (root: THREE.Object3D) => {
  const out: string[] = [];
  root.traverse((o) => {
    for (const id of (o.userData.ids as string[] | undefined) ?? []) out.push(id);
  });
  return out;
};
const meshMaterials = (root: THREE.Object3D) => {
  const out = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const x of Array.isArray(m) ? m : [m]) out.add(x);
  });
  return out;
};

describe("honesty 6: the P4 decor is decorative and never picked", () => {
  const L = p4Layers();

  it("the fixture tile really carries every new kind of decor", () => {
    expect(p4Content.verges?.strips.length).toBeGreaterThan(0);
    expect(p4Content.verges?.shrubs.length).toBeGreaterThan(0);
    expect(p4Content.parking?.stalls.length).toBeGreaterThan(0);
    expect(p4Content.parking?.cars.length).toBeGreaterThan(0);
    expect(p4Content.tracks?.length).toBeGreaterThan(0);
    expect(p4Content.gravel?.length).toBeGreaterThan(0);
    expect(p4Content.facades?.length).toBeGreaterThan(0);
    expect(p4Content.roofs?.items.length).toBeGreaterThan(0);
    const names = new Set<string>();
    for (const l of [L.facades, L.roofs, L.groundDecor!, L.roads])
      l.group.traverse((o) => {
        names.add(o.name);
      });
    for (const n of [
      "facade_shopfronts",
      "roof_units",
      "roof_deck_pool",
      "roof_deck_boxes",
      "ground-decor",
    ])
      expect(names, n).toContain(n);
    const ids = kitIds(L.kits.group);
    // Shrubs (verge `vg…` ids), parked cars (`pk:` ids) and construction kits ride the kit union.
    expect(ids.some((id) => id.startsWith("vg"))).toBe(true);
    expect(ids.some((id) => id.startsWith("pk:"))).toBe(true);
    const construction = [...unionKits(p4Active)].filter(([k]) => k.startsWith("construction/"));
    expect(construction.length).toBeGreaterThan(0);
    for (const [, l] of construction) for (const p of l) expect(ids).toContain(p.id);
  });

  const roots = {
    facades: () => L.facades.group,
    "roofs and podium deck": () => L.roofs.group,
    "ground decor (verges, construction tracks and gravel)": () => L.groundDecor!.group,
    "road markings with parking stalls": () => L.roads.group,
    "streamed kits (shrubs, parked cars, construction)": () => L.kits.group,
  };
  for (const [name, root] of Object.entries(roots)) {
    it(`${name}: every drawable is userData.decorative and raycasts to nothing`, () => {
      const list = drawables(root());
      expect(list.length).toBeGreaterThan(0);
      for (const o of list) {
        expect(o.userData.decorative, `${name}/${o.name}`).toBe(true);
        expect(PROTO_RAYCASTS.has(o.raycast), `${name}/${o.name} raycast`).toBe(false);
        expect(o.userData.pick, `${name}/${o.name} pick`).toBeUndefined();
        o.updateMatrixWorld(true);
        const centre = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
        const rc = new THREE.Raycaster(
          new THREE.Vector3(centre.x, centre.y + 500, centre.z),
          new THREE.Vector3(0, -1, 0),
        );
        const hits: THREE.Intersection[] = [];
        o.raycast(rc, hits);
        expect(hits).toEqual([]);
        expect(rc.intersectObject(o, true)).toEqual([]);
      }
    });
  }

  it("the building under a facade is picked as that building", () => {
    const city = new THREE.Mesh(p4City.buildings, new THREE.MeshBasicMaterial());
    city.userData.pick = { kind: "building" };
    city.userData.faces = p4City.faces;
    const shop = p4City.footprints.find((f) => f.id === "shop")!;
    const xs = shop.ring.map((p) => p[0]);
    const zs = shop.ring.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const zMax = Math.max(...zs);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 1000);
    // Square on to the shop's south wall (largest z), at shopfront height.
    cam.position.set(cx, 2, zMax + 40);
    cam.lookAt(cx, 2, zMax);
    cam.updateMatrixWorld();
    expect(pickAt({ x: 0, y: 0 }, cam, [L.facades.group, L.kits.group, city])).toEqual({
      kind: "building",
      id: "shop",
    });
    // The facade alone gives nothing.
    expect(pickAt({ x: 0, y: 0 }, cam, [L.facades.group])).toBeNull();
  });

  it("parked cars are not in the motion layer and do not fade with Day or Rollout playback", () => {
    const cars = p4Content.parking!.cars;
    expect(cars.every((c) => c.id.startsWith("pk:"))).toBe(true);
    // The motion layer is built from the tiles' agents (`useMotion`: unionById over content.agents).
    const agents = unionById(p4Active, (t) => t.content.agents);
    expect(agents.length).toBeGreaterThan(0);
    expect(agents.some((a) => a.id.startsWith("pk:"))).toBe(false);

    const role = createRoleUniforms();
    const driver = createMotionDriver({ role, ambient: () => null, running: () => true });
    const layer = createMotionLayer(agents, lib(), realManifest, role, createMotionUniforms());
    driver.setAgents(layer);
    const carMeshes = drawables(L.kits.group).filter((o) =>
      ((o.userData.ids as string[] | undefined) ?? []).some((id) => id.startsWith("pk:")),
    );
    expect(carMeshes.length).toBeGreaterThan(0);
    // Disjoint from the fade path: no shared material, and not inside the driver's group.
    const fading = meshMaterials(layer.group);
    expect(fading.size).toBeGreaterThan(0);
    for (const m of carMeshes) {
      for (const mt of meshMaterials(m)) expect(fading.has(mt)).toBe(false);
      for (let p: THREE.Object3D | null = m; p; p = p.parent) expect(p).not.toBe(driver.group);
    }
    const snap = () =>
      carMeshes.map((m) => ({
        visible: m.visible,
        count: (m as THREE.InstancedMesh).count,
        opacity: [...meshMaterials(m)].map((x) => x.opacity),
        transparent: [...meshMaterials(m)].map((x) => x.transparent),
      }));
    const before = snap();
    const cam = new THREE.Vector3(100, 30, 100);
    driver.tick(0, cam);
    driver.setTarget(0); // day.on || rollout.on
    let t = 0;
    while (t < DECOR_FADE_MS + 2 * MOTION_FRAME_MS) {
      t += MOTION_FRAME_MS;
      driver.tick(t, cam);
    }
    expect(driver.opacity).toBe(0);
    expect([...fading].every((m) => m.opacity === 0)).toBe(true);
    expect(snap()).toEqual(before);
  });

  it("facades never exceed a building's height or leave its walls (sampled over the Elmina seed)", () => {
    const site = seedJson("site.json");
    const frame = createFrame(site.center);
    const layer = { buildings: seedJson("base/buildings.geojson") } as unknown as BuildingsLayer;
    const g = buildCityGeometry(layer, frame);
    const inputs = facadeInputs(g.footprints, layer, realManifest);
    expect(inputs.length).toBe(g.footprints.length);
    expect(inputs.length).toBeGreaterThan(1000);
    let quads = 0;
    // Every 7th building (a deterministic sample over the whole seed).
    for (let i = 0; i < inputs.length; i += 7) {
      const b = inputs[i]!;
      const f = g.footprints[i]!;
      // Same ring, height and base as the extrusion: the facade changes none of them.
      expect(b.ring).toBe(f.ring);
      expect(b.heightM).toBe(f.heightM);
      expect(b.minHeightM).toBe(f.minHeightM);
      const out = facadeInstances(b.ring, b.heightM, b.minHeightM, b.spec);
      const xs = b.ring.map((p) => p[0]);
      const zs = b.ring.map((p) => p[1]);
      const pad = WALL_OFFSET_M + 0.01;
      for (const arr of [out.windows, out.shopfronts])
        for (let k = 0; k + 15 < arr.length; k += 16) {
          quads++;
          const cy = arr[k + 13]!;
          const h = Math.hypot(arr[k + 4]!, arr[k + 5]!, arr[k + 6]!);
          expect(cy + h / 2).toBeLessThanOrEqual(b.heightM + 1e-4);
          expect(cy - h / 2).toBeGreaterThanOrEqual(b.minHeightM - 1e-4);
          const x = arr[k + 12]!;
          const z = arr[k + 14]!;
          expect(x).toBeGreaterThanOrEqual(Math.min(...xs) - pad);
          expect(x).toBeLessThanOrEqual(Math.max(...xs) + pad);
          expect(z).toBeGreaterThanOrEqual(Math.min(...zs) - pad);
          expect(z).toBeLessThanOrEqual(Math.max(...zs) + pad);
        }
    }
    expect(quads).toBeGreaterThan(1000);
  }, 60_000);
});

describe("honesty 7: the Kanopi podium deck (ruling P4-M)", () => {
  it("its pool is base water #7fb6c9 and the podium w1545153991 still picks as its building", () => {
    expect(DECK_POOL_COLOUR.toLowerCase()).toBe("#7fb6c9");
    const site = seedJson("site.json");
    const frame = createFrame(site.center);
    const all = seedJson("base/buildings.geojson");
    const landmarks = seedJson("base/landmarks.geojson");
    const podium = all.features.find(
      (f: { properties: { id?: string } }) => f.properties.id === "w1545153991",
    );
    expect(podium).toBeDefined();
    const layer = { buildings: ffc(podium), landmarks } as unknown as BuildingsLayer;
    const g = buildCityGeometry(layer, frame);
    const deck = roofInputs(g.footprints, layer, realManifest, frame).find(
      (r) => r.b.id === "w1545153991",
    )?.deck;
    expect(deck).toBeDefined();
    const roofs = createRoofLayer([], createRoleUniforms(), "medium", [deck!]);
    const pool = roofs.group.getObjectByName("roof_deck_pool") as THREE.InstancedMesh;
    expect((pool.material as THREE.MeshStandardMaterial).color.getHexString()).toBe("7fb6c9");
    const city = new THREE.Mesh(g.buildings, new THREE.MeshBasicMaterial());
    city.userData.pick = { kind: "building" };
    city.userData.faces = g.faces;
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 1000);
    const lookDown = (x: number, z: number) => {
      cam.position.set(x, 200, z);
      cam.lookAt(x, 0, z);
      cam.updateMatrixWorld();
      return pickAt({ x: 0, y: 0 }, cam, [roofs.group, city]);
    };
    const hit = { kind: "building", id: "w1545153991" };
    // On the pool, and on the last box (a planter), off the pool.
    expect(lookDown(deck!.pool[12]!, deck!.pool[14]!)).toEqual(hit);
    const b = deck!.boxes;
    expect(lookDown(b[b.length - 4]!, b[b.length - 2]!)).toEqual(hit);
  }, 60_000);
});

// ---- 8. overlay priority (Review Focus 5) ------------------------------------------------------

describe("honesty 8: every overlay draws above every decor object", () => {
  const line = (id: string, props: Record<string, unknown>, z: number) => ({
    type: "Feature",
    properties: { id, ...props },
    geometry: { type: "LineString", coordinates: [fll(0, z), fll(80, z), fll(120, z + 20)] },
  });
  const point = (id: string, x: number) => ({
    type: "Feature",
    properties: { id, name: id, type: "park" },
    geometry: { type: "Point", coordinates: fll(x, 0) },
  });
  const overlay = () => {
    const l = createOverlayLayer(far);
    l.update({
      access: ffc(
        line("a", { status: "blocked" }, 0),
        line("b", { status: "unknown" }, 10),
        line("c", { status: "ok" }, 20),
        point("p1", 5),
      ),
      accessVisible: true,
      gaps: ffc(line("a", { unknown_count: 1, relevant_count: 2 }, 0)),
      gapsOn: false,
      route: { type: "LineString", coordinates: [fll(0, 0), fll(100, 50)] },
      whatIf: {
        geojson: ffc(
          line("x", { whatif: true, side: "before" }, 30),
          line("y", { whatif: true, side: "after" }, 40),
        ),
      },
      water: ffc(box({}, [0, 0, 50, 50])),
      floodEdges: ffc(
        line("f1", { status: "flooded_likely" }, 50),
        line("f2", { status: "flooded_possible" }, 60),
      ),
      floodOn: true,
      waste: ffc(point("w1", 40)),
      wasteOn: true,
      evac: [
        {
          centre: { id: "e1", name: "Hall", coord: fll(60, 0) },
          reachable: true,
          route_status: "confirmed",
        },
      ] as never,
      focusPlaceId: "p1",
    });
    // No setView: marker labels need a canvas (node env); markers.test covers their order (15).
    const residents = createResidents(far);
    const [lon, lat] = fll(10, 10);
    residents.setDay([{ r: "r1", lon, lat, state: "walk" }] as never, "r1");
    l.attach(residents);
    return l;
  };

  it("overlay drawables: depthTest false and renderOrder >= 10, above every decor renderOrder", () => {
    const L = p4Layers();
    // The P3 ambient birds keep renderOrder 12 inside the MAIN scene, which the separate overlay
    // pass (its own scene, drawn after it) always covers; every other decor sits below 10.
    const { ambient: _birds, ...p3 } = decorativeLayers();
    const decorRoots = [
      ...Object.values(p3),
      L.facades.group,
      L.roofs.group,
      L.groundDecor!.group,
      L.roads.group,
      L.kits.group,
    ];
    let maxDecor = Number.NEGATIVE_INFINITY;
    let nDecor = 0;
    for (const r of decorRoots)
      for (const o of drawables(r)) {
        nDecor++;
        maxDecor = Math.max(maxDecor, o.renderOrder);
      }
    expect(nDecor).toBeGreaterThan(20);
    expect(maxDecor).toBeLessThan(10);

    const l = overlay();
    const all: THREE.Object3D[] = [];
    l.group.traverse((o) => {
      if ((o as THREE.Mesh).material) all.push(o);
    });
    // Status, what-if, route, flood edges, place / waste / evac markers, residents.
    expect(all.length).toBeGreaterThan(8);
    const orders = new Set<number>();
    for (const o of all) {
      for (const m of meshMaterials(o)) expect(m.depthTest, `${o.name} depthTest`).toBe(false);
      expect(o.renderOrder, o.name).toBeGreaterThanOrEqual(10);
      expect(o.renderOrder, o.name).toBeGreaterThan(maxDecor);
      orders.add(Math.floor(o.renderOrder));
    }
    // Status lines (10), what-if and flood edges (12), route (13), markers and residents (14).
    for (const k of [10, 12, 13, 14]) expect(orders, String(k)).toContain(k);

    // The flood fill is main-scene ground (depth tested, order 8), still above the ground decor.
    const fills: THREE.Object3D[] = [];
    l.groundGroup.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) fills.push(o);
    });
    expect(fills.length).toBeGreaterThan(0);
    const groundOrders = [L.groundDecor!.group, L.roads.group].flatMap((r) =>
      drawables(r).map((o) => o.renderOrder),
    );
    for (const f of fills) expect(f.renderOrder).toBeGreaterThan(Math.max(...groundOrders));
    l.dispose();
  });
});

// ---- 9. P4 decor colours never alias a flood colour -------------------------------------------

describe("honesty 9: no P4 decor colour equals a flood colour", () => {
  const FLOOD = ["#C53030", "#DD6B20", "#1e6fb8"].map((c) => new THREE.Color(c).getHex());
  const isFlood = (c: THREE.Color) => FLOOD.includes(c.getHex());

  it("the decor colour constants avoid them (stalls, gravel, tracks, verges, deck pool, roof tints)", () => {
    const named: Record<string, string> = {
      STALL_COLOUR,
      GRAVEL_TINT,
      TRACK_COLOUR,
      verge: LANDCOVER_COLOURS.grass!,
      DECK_POOL_COLOUR,
      ...Object.fromEntries(ROOF_TINTS.map((t, i) => [`ROOF_TINTS[${i}]`, t])),
    };
    for (const [k, hex] of Object.entries(named))
      expect(isFlood(new THREE.Color(hex)), k).toBe(false);
  });

  it("every colour actually drawn by the P4 decor meshes avoids them", () => {
    const L = p4Layers();
    const c = new THREE.Color();
    let checked = 0;
    for (const root of [L.facades.group, L.roofs.group, L.groundDecor!.group, L.roads.group])
      for (const o of drawables(root)) {
        const mesh = o as THREE.InstancedMesh;
        const mats = [...meshMaterials(o)];
        // The role material encodes AO / role / lit seed in its colours, not a display colour.
        if (mats.some((m) => m.name === "tl_role")) continue;
        for (const m of mats) {
          const col = (m as THREE.MeshStandardMaterial).color;
          if (col) {
            checked++;
            expect(isFlood(col), `${o.name} material`).toBe(false);
          }
        }
        const attr = mesh.geometry.getAttribute("color");
        if (attr)
          for (let i = 0; i < attr.count; i++) {
            c.setRGB(attr.getX(i), attr.getY(i), attr.getZ(i));
            checked++;
            expect(isFlood(c), `${o.name} vertex ${i}`).toBe(false);
          }
        if (mesh.isInstancedMesh && mesh.instanceColor)
          for (let i = 0; i < mesh.count; i++) {
            mesh.getColorAt(i, c);
            checked++;
            expect(isFlood(c), `${o.name} instance ${i}`).toBe(false);
          }
      }
    expect(checked).toBeGreaterThan(100);
  });

  it("no decorative kit palette in the real manifest (shrubs, parked cars, construction) uses them", () => {
    let n = 0;
    for (const [name, a] of Object.entries(realManifest.assets)) {
      if (!(a.decorative || a.group === "kit")) continue;
      for (const pals of Object.values(a.palettes))
        for (const pal of pals)
          for (const hex of pal) {
            n++;
            expect(isFlood(new THREE.Color(hex)), `${name} ${hex}`).toBe(false);
          }
    }
    expect(n).toBeGreaterThan(0);
  });
});
