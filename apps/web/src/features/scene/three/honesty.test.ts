import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { statusStyle, WATER_COLOR } from "../styles";
import { createAmbient } from "./ambient/ambient";
import { createCityInstances } from "./assets/cityInstances";
import type { Placement } from "./assets/fit";
import type { AssetLibrary } from "./assets/library";
import type { Manifest } from "./assets/manifest";
import type { CityPlan } from "./assets/plan";
import { createMotionUniforms, createRoleUniforms } from "./assets/roleMaterial";
import { isFallback } from "./cityInfo";
import { fallbackColours } from "./fallbackStyle";
import { createFrame } from "./frame";
import { createGroundLayer } from "./ground/groundLayer";
import { LANDCOVER_COLOURS, landcoverMesh } from "./ground/landcover";
import type { Ribbon } from "./ground/ribbons";
import type { Agent } from "./motion/agents";
import { createMotionDriver, DECOR_FADE_MS, MOTION_FRAME_MS } from "./motion/motionClock";
import { createMotionLayer } from "./motion/motionLayer";
import { createFloodLayer, FLOOD_LIFT_M } from "./overlays/floodLayer";
import { pickAt } from "./pick";
import { createLampPools } from "./props/lampPools";
import { planSigns } from "./signs/signPlan";

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
