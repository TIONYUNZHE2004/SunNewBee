import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createRoleUniforms } from "../assets/roleMaterial";
import { beamAlpha, createVehicleLights, tailAlpha } from "./vehicleLights";

describe("vehicle lights (night beams and tail glows on the road)", () => {
  it("the beam is a cone: dark at the edges near the bumper, fading with distance", () => {
    expect(beamAlpha(0.5, 0.2)).toBeGreaterThan(beamAlpha(0.5, 0.8));
    expect(beamAlpha(0.05, 0.05)).toBe(0); // outside the narrow near end
    expect(beamAlpha(0.5, 1)).toBe(0);
    expect(tailAlpha(0.5, 0)).toBeGreaterThan(tailAlpha(0.5, 0.6));
  });

  it("draws nothing by day and one beam ahead, one tail glow behind each car at night", () => {
    const u = createRoleUniforms();
    const l = createVehicleLights(4, u);
    const [beams, tails] = l.group.children as THREE.InstancedMesh[];
    l.begin();
    l.add(0, 0, 0, 2, 1);
    l.end();
    expect(beams?.visible).toBe(false);

    u.uLightGlow.value = 1;
    l.begin();
    l.add(10, 20, 0, 2, 1); // facing +z
    l.end();
    expect(beams?.count).toBe(1);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    beams?.getMatrixAt(0, m);
    p.setFromMatrixPosition(m);
    expect(p.z).toBeCloseTo(22); // front bumper
    tails?.getMatrixAt(0, m);
    p.setFromMatrixPosition(m);
    expect(p.z).toBeCloseTo(18); // rear bumper

    l.setOpacity(0);
    l.begin();
    l.add(0, 0, 0, 2, 1);
    l.end();
    expect(beams?.visible).toBe(false);
    l.dispose();
  });
});
