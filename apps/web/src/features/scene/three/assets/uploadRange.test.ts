import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { markUsed } from "./uploadRange";

describe("markUsed (ITER2 AC-D18: no whole-capacity instance uploads)", () => {
  it("uploads only the drawn front of an instance buffer", () => {
    const m = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 2048);
    const v0 = m.instanceMatrix.version;
    markUsed(m.instanceMatrix, 10);
    expect(m.instanceMatrix.version).toBe(v0 + 1);
    expect(m.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 160 }]);
    // a second mark replaces the range (never a stale wider one)
    markUsed(m.instanceMatrix, 3);
    expect(m.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 48 }]);
  });

  it("nothing drawn: nothing uploaded", () => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(2048 * 3), 3);
    markUsed(a, 0);
    expect(a.version).toBe(0);
    expect(a.updateRanges).toEqual([]);
  });
});
