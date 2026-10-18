import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createFrame } from "./frame";
import { createFloodLayer } from "./overlays/floodLayer";
import { createMarkers } from "./overlays/markers";
import { type PickHit, pickAt } from "./pick";

const frame = createFrame([101.5, 3.18]);
const VIEW = { width: 800, height: 800 };
/** NDC per CSS pixel on the 800 px test viewport. */
const PX = 2 / 800;
const fakeCanvas = () =>
  ({
    width: 0,
    height: 0,
    getContext: () => ({
      font: "",
      measureText: (t: string) => ({ width: t.length * 7 }),
      fillRect() {},
      fillText() {},
    }),
  }) as unknown as HTMLCanvasElement;

/** Looks down -z at the origin from 50 m. */
function camera() {
  const c = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  c.position.set(0, 0, 50);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
}

const mat = () => new THREE.MeshBasicMaterial();
const box = (z = 0, s = 4) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat());
  m.position.z = z;
  return m;
};

/** An extruded city mesh: a box whose +z (camera-facing) triangles 8 and 9 are building "a". */
function extruded(z = 0) {
  const m = box(z);
  m.userData.pick = { kind: "building" };
  m.userData.faces = { ids: ["a", "b"], starts: [8, 10] };
  return m;
}
function instanced(ids: string[], kind: "building" | "resident", z = 0) {
  const m = new THREE.InstancedMesh(new THREE.BoxGeometry(4, 4, 4), mat(), ids.length);
  ids.forEach((_id, i) => {
    m.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i * 10, 0, z));
  });
  m.userData.pick = { kind };
  m.userData.ids = ids;
  return m;
}
function sign(z = 2.05) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(3, 2), mat());
  m.position.z = z;
  m.userData.pick = { kind: "sign" };
  m.userData.signIds = ["s1"];
  return m;
}
function landmark(z = 0) {
  const m = box(z);
  m.userData.pick = { kind: "landmark", id: "kanopi-residences" };
  return m;
}
const markers = (kinds: ("place" | "evac" | "waste")[]) =>
  createMarkers(
    {
      places: kinds.includes("place")
        ? [{ id: "p1", name: "Playground", coord: frame.toLonLat(0, 0) }]
        : [],
      waste: kinds.includes("waste")
        ? [{ id: "w1", name: "Bin", coord: frame.toLonLat(0, 0) }]
        : [],
      evac: kinds.includes("evac")
        ? [
            {
              centre: { id: "c1", name: "Hall", coord: frame.toLonLat(0, 0) },
              reachable: true,
              route_status: "confirmed",
            },
          ]
        : [],
    },
    frame,
    fakeCanvas,
  ).group;
const floodEdges = () =>
  createFloodLayer(
    null,
    {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { id: "e1", flood_class: "likely_flooded" },
          geometry: {
            type: "LineString",
            coordinates: [frame.toLonLat(-20, 0), frame.toLonLat(20, 0)],
          },
        },
      ],
    },
    frame,
  ).group;

/** Where the markers (0.6 m above local 0, 0) land on screen. */
const MARK = (() => {
  const v = new THREE.Vector3(0, 0.6, 0).project(camera());
  return { x: v.x, y: v.y };
})();

const at = (roots: THREE.Object3D[], ndc = { x: 0, y: 0 }, linePx?: number): PickHit | null =>
  pickAt(ndc, camera(), roots, linePx, VIEW);

describe("pickAt", () => {
  it("keeps the fixed priority when everything overlaps under the cursor", () => {
    const parts: [PickHit, THREE.Object3D][] = [
      [{ kind: "place", id: "p1" }, markers(["place"])],
      [{ kind: "evac", id: "c1" }, markers(["evac"])],
      [{ kind: "waste", id: "w1" }, markers(["waste"])],
      [{ kind: "sign", id: "s1" }, sign()],
      [{ kind: "landmark", id: "kanopi-residences" }, landmark()],
      [{ kind: "resident", id: "r1" }, instanced(["r1"], "resident")],
      [{ kind: "floodEdge", id: "e1" }, floodEdges()],
      [{ kind: "building", id: "b7" }, instanced(["b7#0"], "building")],
    ];
    const roots = parts.map(([, o]) => o);
    for (const [want] of parts) {
      expect(at(roots, MARK)).toEqual(want);
      roots.shift();
    }
    expect(at(roots, MARK)).toBeNull();
  });

  it("never hits a decorative mesh: the building behind it is picked", () => {
    const deco = box(10);
    deco.userData.decorative = true; // its raycast still works: the picker must skip it
    const decoLandmark = landmark(12);
    decoLandmark.userData.decorative = true;
    const decoGroup = new THREE.Group();
    decoGroup.userData.decorative = true;
    const child = landmark(14); // inside a decorative group
    decoGroup.add(child);
    expect(at([decoGroup, decoLandmark, deco, extruded()])).toEqual({ kind: "building", id: "a" });
  });

  it("an instanced hit names the building with the row-unit #i stripped", () => {
    const m = instanced(["b9#0", "b9#1", "b10"], "building");
    expect(at([m])).toEqual({ kind: "building", id: "b9" });
    // the third instance sits 20 m to the right
    const ndcX = new THREE.Vector3(20, 0, 0).project(camera()).x;
    expect(at([m], { x: ndcX, y: 0 })).toEqual({ kind: "building", id: "b10" });
  });

  it("maps an extruded-mesh face to its building id", () => {
    const m = extruded();
    m.userData.faces = { ids: ["only"], starts: [0] };
    expect(at([m])).toEqual({ kind: "building", id: "only" });
  });

  it("without a viewport the screen-space kinds are never hit (not all hit)", () => {
    expect(pickAt(MARK, camera(), [markers(["place"]), floodEdges()])).toBeNull();
    expect(pickAt(MARK, camera(), [markers(["place"]), extruded()])).toEqual({
      kind: "building",
      id: "a",
    });
  });

  it("returns null when nothing is under the cursor", () => {
    expect(at([])).toBeNull();
    expect(at([extruded()], { x: 0.9, y: 0.9 })).toBeNull();
    // markers: 9 px disc + 2 px outline; 20 px away is a miss
    expect(at([markers(["place"])], { x: MARK.x + 20 * PX, y: MARK.y })).toBeNull();
    expect(at([markers(["place"])], { x: MARK.x + 6 * PX, y: MARK.y })).toEqual({
      kind: "place",
      id: "p1",
    });
  });

  it("picks a flood edge within 8 px of the line and not beyond", () => {
    const y = new THREE.Vector3(0, 0.3, 0).project(camera()).y;
    expect(at([floodEdges()], { x: 0.1, y: y + 6 * PX })).toEqual({ kind: "floodEdge", id: "e1" });
    expect(at([floodEdges()], { x: 0.1, y: y + 12 * PX })).toBeNull();
    expect(at([floodEdges()], { x: 0.1, y: y + 12 * PX }, 16)).toEqual({
      kind: "floodEdge",
      id: "e1",
    });
  });

  it("skips hidden objects, and a building in front hides a sign or landmark behind it", () => {
    const hidden = markers(["place"]);
    hidden.visible = false;
    expect(at([hidden, extruded()])).toEqual({ kind: "building", id: "a" });
    expect(at([sign(-10), landmark(-20), extruded(10)])).toEqual({ kind: "building", id: "a" });
    // overlay data is drawn on top: a building never occludes it
    expect(at([markers(["place"]), extruded(30)], MARK)).toEqual({ kind: "place", id: "p1" });
  });
});
