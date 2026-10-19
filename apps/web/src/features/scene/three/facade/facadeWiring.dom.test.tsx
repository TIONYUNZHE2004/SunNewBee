// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import * as THREE from "three";
import { beforeEach, describe, expect, it } from "vitest";
import manifestJson from "../../../../../public/city/manifest.json";
import type { BuildingsLayer } from "../../../../lib/api";
import { newQueryClient, renderWithClient } from "../../../../test/helpers";
import { BuildingCard } from "../../../map-ui/BuildingCard";
import { useScene } from "../../sceneStore";
import { parseManifest } from "../assets/manifest";
import { facadeInputs, planCity } from "../assets/plan";
import { createMotionUniforms, createRoleUniforms } from "../assets/roleMaterial";
import { useCityInfo } from "../cityInfo";
import { buildCityGeometry } from "../cityMesh";
import { createFrame } from "../frame";
import { pickAt } from "../pick";
import { createFacadeLayer } from "./facadeLayer";
import { facadeInstances } from "./facadePlan";

/**
 * Task 6b wiring: a generic footprint that the real manifest would stretch to sz 2.0 is extruded
 * with a procedural facade; its card is unchanged ("(shown as a simple block)") and the extruded
 * mesh beneath the facade is still picked as that building through `pickAt`.
 */
const frame = createFrame([101.5, 3.18]);
const { manifest } = parseManifest(manifestJson);
const m = manifest!;

/** 20 m along x, 10 m along z, centred on the origin: the generic box (10 x 10) at sx 1, sz 2. */
const ring = [
  [-10, -5],
  [10, -5],
  [10, 5],
  [-10, 5],
  [-10, -5],
].map(([x, z]) => frame.toLonLat(x as number, z as number));
const layer = {
  as_of: "2026-10-17",
  attribution: [],
  buildings: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: {
          id: "g20",
          kind: "commercial",
          archetype: "generic",
          height_m: 9.6,
          display_height_source: "default",
        },
      },
    ],
  },
  landmarks: { type: "FeatureCollection", features: [] },
  parks: { type: "FeatureCollection", features: [] },
  water: { type: "FeatureCollection", features: [] },
  trees: { type: "FeatureCollection", features: [] },
} as unknown as BuildingsLayer;

function city() {
  const plan = planCity(layer, frame, m, () => true);
  const g = buildCityGeometry(layer, frame, { only: plan.extrude });
  const inputs = facadeInputs(g.footprints, layer, m);
  return { plan, g, inputs };
}

beforeEach(() => {
  useScene.getState().reset();
  useCityInfo.setState({ manifest: null, extruded: null });
});

describe("facade wiring: a stretched generic becomes an extrusion with a facade", () => {
  it("the real generic band would accept sz 2.0, but the plan extrudes it with a facade", () => {
    expect(m.assets.generic?.fit.xz[1]).toBeGreaterThanOrEqual(2);
    const { plan, inputs } = city();
    expect(plan.extrude.has("g20")).toBe(true);
    expect(plan.stats.fallback.generic_stretch).toBe(1);
    expect(inputs.map((b) => b.spec.buildingId)).toEqual(["g20"]);
    const layerOut = createFacadeLayer(inputs, createRoleUniforms(), "medium");
    expect(layerOut.group.children.length).toBeGreaterThan(0);
    layerOut.dispose();
  });

  it("its card is unchanged: generic type, shown as a simple block, OSM source, default height", () => {
    const { plan } = city();
    const qc = newQueryClient();
    qc.setQueryData(["buildings"], layer);
    useCityInfo.setState({ manifest: m, extruded: plan.extrude });
    useScene.getState().selectBuilding("g20");
    renderWithClient(<BuildingCard />, qc);
    expect(
      screen.getByText("Building type: Building (no specific type) (shown as a simple block)"),
    ).toBeVisible();
    expect(screen.getByText("Source: OSM · as of 2026-10-17")).toBeVisible();
    expect(screen.getByText("Height: Default estimate")).toBeVisible();
  });

  it("a click on a window picks the building beneath it (scene-level, through pickAt)", () => {
    const { g, inputs } = city();
    // The extruded city mesh exactly as engine.setCity builds it.
    const buildings = new THREE.Mesh(g.buildings, new THREE.MeshBasicMaterial());
    buildings.userData.pick = { kind: "building" };
    buildings.userData.faces = g.faces;
    const facades = createFacadeLayer(
      inputs,
      createRoleUniforms(),
      "medium",
      createMotionUniforms(),
    );
    const scene = new THREE.Scene();
    scene.add(buildings, facades.group);

    // A window on the +z (south) wall: aim the camera straight at its centre.
    const b = inputs[0]!;
    const out = facadeInstances(b.ring, b.heightM, b.minHeightM, b.spec);
    const centre = new THREE.Vector3();
    let found = false;
    for (let i = 0; i < out.windows.length / 16; i++) {
      centre.setFromMatrixPosition(new THREE.Matrix4().fromArray(out.windows, i * 16));
      if (centre.z > 5) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    camera.position.set(centre.x, centre.y, 60);
    camera.lookAt(centre.x, centre.y, 0);
    camera.updateMatrixWorld();
    scene.updateMatrixWorld();

    // The window really is in front of the wall under the cursor (raycast forced on for the check).
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), camera);
    const windowHits: THREE.Intersection[] = [];
    for (const mesh of facades.group.children as THREE.InstancedMesh[])
      THREE.InstancedMesh.prototype.raycast.call(mesh, ray, windowHits);
    const wallHit = ray.intersectObject(buildings, false)[0];
    expect(windowHits.length).toBeGreaterThan(0);
    expect(wallHit).toBeDefined();
    expect(Math.min(...windowHits.map((h) => h.distance))).toBeLessThan(wallHit!.distance);

    // The picker skips the decorative facade and names the building by face.
    expect(pickAt({ x: 0, y: 0 }, camera, [scene])).toEqual({ kind: "building", id: "g20" });
    expect(pickAt({ x: 0, y: 0 }, camera, [facades.group])).toBeNull();
    facades.dispose();
  });
});
