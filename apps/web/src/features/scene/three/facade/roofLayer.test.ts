import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { BuildingsLayer } from "../../../../lib/api";
import { createRoleUniforms } from "../assets/roleMaterial";
import { buildCityGeometry } from "../cityMesh";
import { NEUTRAL_COLOURS } from "../fallbackStyle";
import { createFrame } from "../frame";
import { pickAt } from "../pick";
import { podiumDeck } from "./podiumDeck";
import { createRoofLayer } from "./roofLayer";
import { roofDressing } from "./roofPlan";

const item = (id: string, x0: number) => ({
  id,
  dressing: roofDressing(
    {
      id,
      ring: [
        [x0, 0],
        [x0 + 60, 0],
        [x0 + 60, -30],
        [x0, -30],
      ],
      heightM: 12,
      archetype: "factory",
    },
    NEUTRAL_COLOURS,
  ),
});
const items = [item("a", 0), item("b", 100)];

describe("createRoofLayer", () => {
  it("draws at most 3 instanced meshes", () => {
    const layer = createRoofLayer(items, createRoleUniforms(), "medium");
    expect(layer.group.children.length).toBeGreaterThan(0);
    expect(layer.group.children.length).toBeLessThanOrEqual(3);
    for (const m of layer.group.children) expect(m).toBeInstanceOf(THREE.InstancedMesh);
    layer.dispose();
  });

  it("is decorative and its raycast returns nothing", () => {
    const layer = createRoofLayer(items, createRoleUniforms(), "high");
    expect(layer.group.userData.decorative).toBe(true);
    layer.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(10, 50, -15), new THREE.Vector3(0, -1, 0));
    expect(ray.intersectObject(layer.group, true)).toEqual([]);
    layer.group.traverse((o) => {
      if (o === layer.group) return;
      expect(o.userData.decorative).toBe(true);
      expect(o.castShadow).toBe(false);
    });
    layer.dispose();
  });

  it("is empty at Low and with no items", () => {
    expect(createRoofLayer(items, createRoleUniforms(), "low").group.children).toHaveLength(0);
    expect(createRoofLayer([], createRoleUniforms(), "high").group.children).toHaveLength(0);
  });

  it("disposes", () => {
    const layer = createRoofLayer(items, createRoleUniforms(), "high");
    layer.dispose();
    expect(layer.group.children).toHaveLength(0);
  });
});

describe("createRoofLayer with the Kanopi podium deck (ruling P4-M)", () => {
  const podium: Array<[number, number]> = [
    [0, 0],
    [80, 0],
    [80, -50],
    [0, -50],
  ];
  const deck = podiumDeck({ id: "w1545153991", ring: podium, heightM: 8.71 }, [])!;

  it("adds a decorative deck group whose pool is base water (#7fb6c9), never picked", () => {
    const layer = createRoofLayer([], createRoleUniforms(), "medium", [deck]);
    const g = layer.group.getObjectByName("roof_deck") as THREE.Group;
    expect(g).toBeDefined();
    expect(g.userData.decorative).toBe(true);
    const pool = g.getObjectByName("roof_deck_pool") as THREE.InstancedMesh;
    expect((pool.material as THREE.MeshStandardMaterial).color.getHexString()).toBe("7fb6c9");
    expect(pool.count).toBe(1);
    const boxes = g.getObjectByName("roof_deck_boxes") as THREE.InstancedMesh;
    expect(boxes.count).toBe(deck.boxes.length / 16);
    layer.group.traverse((o) => {
      expect(o.userData.decorative).toBe(true);
      expect(o.castShadow).toBe(false);
    });
    layer.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(40, 50, -25), new THREE.Vector3(0, -1, 0));
    expect(ray.intersectObject(layer.group, true)).toEqual([]);
    layer.dispose();
    expect(layer.group.children).toHaveLength(0);
  });

  it("the podium under the deck is still picked as its building", () => {
    const frame = createFrame([101.5, 3.18]);
    const ll = ([x, z]: [number, number]) => frame.toLonLat(x, z);
    const fc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { id: "w1545153991", height_m: 8.71, kind: "other" },
          geometry: { type: "Polygon", coordinates: [[...podium, podium[0]!].map(ll)] },
        },
      ],
    };
    const g = buildCityGeometry({ buildings: fc } as unknown as BuildingsLayer, frame);
    const city = new THREE.Mesh(g.buildings, new THREE.MeshBasicMaterial());
    city.userData.pick = { kind: "building" };
    city.userData.faces = g.faces;
    const local = podiumDeck(
      { id: "w1545153991", ring: g.footprints[0]!.ring, heightM: 8.71 },
      [],
    )!;
    const layer = createRoofLayer([], createRoleUniforms(), "medium", [local]);
    // Straight down onto the pool plane's centre.
    const pm = local.pool;
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 1000);
    cam.position.set(pm[12]!, 200, pm[14]!);
    cam.lookAt(pm[12]!, 0, pm[14]!);
    expect(pickAt({ x: 0, y: 0 }, cam, [layer.group, city])).toEqual({
      kind: "building",
      id: "w1545153991",
    });
    layer.dispose();
  });

  it("Low draws no deck", () => {
    expect(createRoofLayer([], createRoleUniforms(), "low", [deck]).group.children).toHaveLength(0);
  });
});
