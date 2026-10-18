import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { DAY_STYLE } from "../../../day/dayModel";
import { RESIDENT_STYLE } from "../../../whatif/rolloutModel";
import { createFrame } from "../frame";
import {
  createResidents,
  FOCUS_SCALE,
  RESIDENT_HEIGHT_M,
  RESIDENT_ORDER,
  RESIDENT_WIDTH_M,
  residentIdAt,
  rolloutPoints,
} from "./residents";

const frame = createFrame([101.5, 3.0]);
const dot = (r: string, state: "walk" | "drive" | "wait", dx = 0) => ({
  r,
  lon: 101.5 + dx * 1e-5,
  lat: 3.0,
  state,
});
const fills = (g: THREE.Object3D) => {
  const out: THREE.InstancedMesh[] = [];
  g.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh && o.userData.pick)
      out.push(o as THREE.InstancedMesh);
  });
  return out;
};
const fill = (g: THREE.Object3D) => fills(g)[0] as THREE.InstancedMesh;
const colourAt = (m: THREE.InstancedMesh, i: number) => {
  const c = new THREE.Color();
  m.getColorAt(i, c);
  return c.getHex();
};
const scaleAt = (m: THREE.InstancedMesh, i: number) => {
  const mat = new THREE.Matrix4();
  m.getMatrixAt(i, mat);
  return new THREE.Vector3().setFromMatrixScale(mat).x;
};
const far = { x: 0, y: 0, z: 0 };

describe("capsule size", () => {
  it("is 1.2 m wide and 2.4 m tall, standing on y = 0", () => {
    const r = createResidents(frame);
    r.setDay([dot("a", "walk")], null);
    const box = new THREE.Box3().setFromBufferAttribute(
      fill(r.group).geometry.getAttribute("position") as THREE.BufferAttribute,
    );
    expect(RESIDENT_WIDTH_M).toBe(1.2);
    expect(RESIDENT_HEIGHT_M).toBe(2.4);
    expect(box.max.x - box.min.x).toBeCloseTo(1.2, 5);
    expect(box.max.y - box.min.y).toBeCloseTo(2.4, 5);
    expect(box.min.y).toBeCloseTo(0, 5);
  });
});

describe("Day residents", () => {
  it("colours each state from DAY_STYLE, one instance per dot", () => {
    const r = createResidents(frame);
    r.setDay([dot("a", "walk"), dot("b", "drive", 5), dot("c", "wait", 9)], null);
    const m = fill(r.group);
    expect(m.count).toBe(3);
    expect(colourAt(m, 0)).toBe(new THREE.Color(DAY_STYLE.walk.color).getHex());
    expect(colourAt(m, 1)).toBe(new THREE.Color(DAY_STYLE.drive.color).getHex());
    expect(colourAt(m, 2)).toBe(new THREE.Color(DAY_STYLE.wait.color).getHex());
  });

  it("places an instance at the projected position, y = 0", () => {
    const r = createResidents(frame);
    r.setDay([dot("a", "walk", 100)], null);
    const mat = new THREE.Matrix4();
    fill(r.group).getMatrixAt(0, mat);
    const p = new THREE.Vector3().setFromMatrixPosition(mat);
    const [x, z] = frame.toLocal(101.5 + 100 * 1e-5, 3.0);
    expect(p.x).toBeCloseTo(x, 4);
    expect(p.z).toBeCloseTo(z, 4);
    expect(p.y).toBe(0);
  });

  it("the focused resident is 1.6x larger and gets a white ring", () => {
    const r = createResidents(frame);
    r.setDay([dot("a", "walk"), dot("b", "walk", 5)], "b");
    const m = fill(r.group);
    expect(FOCUS_SCALE).toBe(1.6);
    expect(scaleAt(m, 1) / scaleAt(m, 0)).toBeCloseTo(1.6, 5);
    const ring = r.group.getObjectByName("resident-focus-ring") as THREE.Mesh;
    expect(ring.visible).toBe(true);
    expect((ring.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xffffff);
    r.setDay([dot("a", "walk")], null);
    expect(ring.visible).toBe(false);
  });

  it("setDay([]) hides everything", () => {
    const r = createResidents(frame);
    r.setDay([dot("a", "walk")], "a");
    expect(r.group.visible).toBe(true);
    r.setDay([], null);
    expect(fill(r.group).count).toBe(0);
    expect(r.group.visible).toBe(false);
  });

  it("grows past its first capacity and keeps every dot", () => {
    const r = createResidents(frame);
    const many = Array.from({ length: 700 }, (_, i) => dot(`r${i}`, "walk", i));
    r.setDay(many, null);
    expect(fill(r.group).count).toBe(700);
    expect(fills(r.group)).toHaveLength(1);
  });

  it("scales up with distance (displayScale) once the view is set", () => {
    const r = createResidents(frame);
    r.setDay([dot("a", "walk")], null);
    r.setView({ x: 0, y: 1000, z: 0 });
    expect(scaleAt(fill(r.group), 0)).toBeCloseTo(3, 5);
    r.setView({ x: 0, y: 10, z: 0 });
    expect(scaleAt(fill(r.group), 0)).toBeCloseTo(1, 5);
  });
});

describe("rollout residents", () => {
  const line: [number, number][] = [
    [101.5, 3.0],
    [101.5 + 100 * 1e-5, 3.0],
  ];
  it("colours from RESIDENT_STYLE", () => {
    const r = createResidents(frame);
    r.setRollout([
      { id: "x", kind: "reach", coords: line, moving: false, offset: 0 },
      { id: "y", kind: "cutOff", coords: line, moving: false, offset: 0 },
      { id: "z", kind: "noData", coords: line, moving: false, offset: 0 },
    ]);
    const m = fill(r.group);
    expect(m.count).toBe(3);
    expect(colourAt(m, 0)).toBe(new THREE.Color(RESIDENT_STYLE.reach.color).getHex());
    expect(colourAt(m, 1)).toBe(new THREE.Color(RESIDENT_STYLE.cutOff.color).getHex());
    expect(colourAt(m, 2)).toBe(new THREE.Color(RESIDENT_STYLE.noData.color).getHex());
  });

  it("walkers move along their route over time; the cut off stand still; no route is hidden", () => {
    const r = createResidents(frame);
    r.setRollout([
      { id: "w", kind: "reach", coords: line, moving: true, offset: 0 },
      { id: "s", kind: "cutOff", coords: line, moving: false, offset: 0.5 },
      { id: "n", kind: "noData", coords: [], moving: false, offset: 0 },
    ]);
    r.setView(far, 0);
    const m = fill(r.group);
    expect(m.count).toBe(2);
    const x = (i: number) => {
      const mat = new THREE.Matrix4();
      m.getMatrixAt(i, mat);
      return new THREE.Vector3().setFromMatrixPosition(mat).x;
    };
    const w0 = x(0);
    const s0 = x(1);
    r.setView(far, 6000);
    expect(x(0)).toBeGreaterThan(w0 + 20);
    expect(x(1)).toBeCloseTo(s0, 6);
  });

  it("Day and rollout dots can coexist in the one mesh", () => {
    const r = createResidents(frame);
    r.setDay([dot("a", "walk")], null);
    r.setRollout([{ id: "x", kind: "reach", coords: line, moving: false, offset: 0 }]);
    expect(fill(r.group).count).toBe(2);
  });
});

describe("picking and honesty", () => {
  it("names the resident at an instance; they are data, not decoration", () => {
    const r = createResidents(frame);
    r.setDay([dot("a", "walk"), dot("b", "wait", 4)], null);
    const m = fill(r.group);
    expect(m.userData.pick).toEqual({ kind: "resident" });
    expect(m.userData.decorative).toBeUndefined();
    expect(residentIdAt(m, 0)).toBe("a");
    expect(residentIdAt(m, 1)).toBe("b");
    expect(residentIdAt(m, 2)).toBeNull();
  });

  it("draws on top of the props, after the route and above the ground overlays", () => {
    const r = createResidents(frame);
    r.setDay([dot("a", "walk")], "a");
    expect(RESIDENT_ORDER).toBeGreaterThanOrEqual(14);
    r.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        expect((mesh.material as THREE.Material).depthTest).toBe(false);
        expect(mesh.renderOrder).toBeGreaterThanOrEqual(RESIDENT_ORDER);
      }
    });
  });

  it("dispose releases geometry and materials", () => {
    const r = createResidents(frame);
    r.setDay([dot("a", "walk")], "a");
    let disposed = 0;
    r.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.addEventListener("dispose", () => disposed++);
    });
    r.dispose();
    expect(disposed).toBeGreaterThan(0);
  });
});

describe("rolloutPoints", () => {
  const routes = {
    r1: {
      coordinates: [
        [101.5, 3.0],
        [101.501, 3.0],
      ],
    },
  };
  const res = [
    { id: "a", statuses: ["confirmed"], route_ids: ["r1"], origin_coord: [101.5, 3.0] },
    { id: "b", statuses: ["blocked"], route_ids: [null], origin_coord: [101.6, 3.0] },
    { id: "c", statuses: ["no_data"], route_ids: [null], origin_coord: null },
  ];
  it("walks the route, stands at the origin when cut off, and has no position without either", () => {
    const pts = rolloutPoints(res, routes, 0);
    expect(pts.map((p) => p.kind)).toEqual(["reach", "cutOff", "noData"]);
    expect(pts[0]?.moving).toBe(true);
    expect(pts[0]?.coords).toHaveLength(2);
    expect(pts[1]?.moving).toBe(false);
    expect(pts[1]?.coords).toEqual([[101.6, 3.0]]);
    expect(pts[2]?.coords).toEqual([]);
  });
});

describe("review fixes", () => {
  const line2: [number, number][] = [
    [101.5, 3.0],
    [101.5 + 100 * 1e-5, 3.0],
  ];
  it("walking() is true only for walkers with a route of two or more points", () => {
    const r = createResidents(frame);
    r.setRollout([
      { id: "x", kind: "reach", coords: [line2[0] as [number, number]], moving: true, offset: 0 },
    ]);
    expect(r.walking()).toBe(false);
    r.setRollout([{ id: "x", kind: "reach", coords: line2, moving: true, offset: 0 }]);
    expect(r.walking()).toBe(true);
    r.setRollout([]);
    expect(r.walking()).toBe(false);
  });

  it("an unknown Day state falls back to a neutral colour", () => {
    const r = createResidents(frame);
    r.setDay([{ r: "a", lon: 101.5, lat: 3, state: "bogus" as never }], null);
    expect(colourAt(fill(r.group), 0)).toBe(new THREE.Color(RESIDENT_STYLE.noData.color).getHex());
  });

  it("builds no meshes while there is nothing to draw, and keeps ids across camera frames", () => {
    const r = createResidents(frame);
    r.setDay([], null);
    expect(fills(r.group)).toHaveLength(0);
    r.setDay([dot("a", "walk"), dot("b", "walk", 3)], null);
    const m = fill(r.group);
    const ids = m.userData.ids;
    r.setView({ x: 5, y: 50, z: 5 });
    r.setView({ x: 9, y: 50, z: 5 });
    expect(m.userData.ids).toBe(ids);
  });
});
