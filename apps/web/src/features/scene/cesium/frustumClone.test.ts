import { describe, expect, it } from "vitest";
import { patchFrustumClone } from "./frustumClone";

/** Mimics Cesium 1.146's PerspectiveFrustum.clone: copies fov/near/far, drops the offsets. */
function makeFrustumClass() {
  class Frustum {
    fov = 1;
    near = 0.1;
    xOffset = 0;
    yOffset = 0;
    clone(result?: Frustum) {
      const r = result ?? new Frustum();
      r.fov = this.fov;
      r.near = this.near;
      return r;
    }
  }
  return Frustum;
}

describe("patchFrustumClone", () => {
  it("clones keep xOffset and yOffset (so the camera equals its clone and idle frames stop)", () => {
    const F = makeFrustumClass();
    const f = new F();
    f.xOffset = 0.0149;
    f.yOffset = -0.002;
    expect(f.clone().xOffset).toBe(0); // the bug
    patchFrustumClone(F as never);
    const c = f.clone();
    expect([c.xOffset, c.yOffset, c.fov]).toEqual([0.0149, -0.002, 1]);
    const into = new F();
    expect(f.clone(into)).toBe(into);
    expect(into.xOffset).toBe(0.0149);
  });

  it("is idempotent (patching twice wraps once)", () => {
    const F = makeFrustumClass();
    patchFrustumClone(F as never);
    const once = F.prototype.clone;
    patchFrustumClone(F as never);
    expect(F.prototype.clone).toBe(once);
  });
});
