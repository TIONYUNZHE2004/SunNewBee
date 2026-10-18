import * as THREE from "three";
import type { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { describe, expect, it } from "vitest";
import { statusStyle } from "../../scene/styles";
import { createFrame } from "../../scene/three/frame";
import demoPlan from "../fixtures/demoPlan.json";
import type { JourneyPlan } from "../timeline";
import {
  createJourneyLayer,
  MARKER_LIFT_M,
  MARKER_STACK_M,
  RIBBON_GHOST_OPACITY,
  RIBBON_LIFT_M,
  RIBBON_WIDTH_M,
  RIBBON_WIDTH_PX,
} from "./journeyLayer";
import { projectToScreen } from "./project";

const plan = demoPlan as unknown as JourneyPlan;
const frame = createFrame([101.5135, 3.18]);
const mat = (o: THREE.Object3D) => (o as THREE.Mesh).material as LineMaterial;
const solid = (g: THREE.Object3D) => g.children.filter((o) => o.userData.ribbon === "solid");
const ghost = (g: THREE.Object3D) => g.children.filter((o) => o.userData.ribbon === "ghost");

describe("journey ribbon", () => {
  const layer = createJourneyLayer(plan, frame);

  it("one solid and one ghost line per same-status run, in travel order", () => {
    expect(solid(layer.ribbon).map((o) => o.userData.eval)).toEqual([
      "UNKNOWN",
      "PASS",
      "UNKNOWN",
      "PASS",
    ]);
    expect(ghost(layer.ribbon)).toHaveLength(4);
  });

  it("PASS is solid green, UNKNOWN amber dashes (styles.ts colours)", () => {
    for (const o of solid(layer.ribbon)) {
      const m = mat(o);
      if (o.userData.eval === "PASS") {
        expect(m.dashed).toBe(false);
        expect(`#${m.color.getHexString()}`).toBe(statusStyle("ok").color.toLowerCase());
        expect(m.opacity).toBe(1);
      } else {
        expect(m.dashed).toBe(true);
        expect(`#${m.color.getHexString()}`).toBe(statusStyle("unknown").color.toLowerCase());
      }
    }
  });

  it("depth-tested where visible; a faint ghost only where buildings hide it", () => {
    for (const o of solid(layer.ribbon)) {
      expect(mat(o).depthTest).toBe(true);
      expect(mat(o).depthWrite).toBe(false);
    }
    for (const o of ghost(layer.ribbon)) {
      expect(mat(o).depthTest).toBe(true);
      expect(mat(o).depthFunc).toBe(THREE.GreaterDepth);
      expect(mat(o).opacity).toBe(RIBBON_GHOST_OPACITY);
      expect(mat(o).transparent).toBe(true);
    }
    expect(RIBBON_GHOST_OPACITY).toBeLessThan(0.5);
  });

  it("is lifted above the ground and follows the plan polyline", () => {
    const first = solid(layer.ribbon)[0] as THREE.Mesh;
    const pos = (first.geometry.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute)
      .data.array as Float32Array;
    expect(pos[1]).toBeCloseTo(RIBBON_LIFT_M, 5);
    const [x, z] = frame.toLocal(...(plan.polyline[0] as [number, number]));
    expect(pos[0]).toBeCloseTo(x, 3);
    expect(pos[2]).toBeCloseTo(z, 3);
  });

  it("dashes keep their pixel length (scaled by metres per pixel)", () => {
    const unk = solid(layer.ribbon).find((o) => o.userData.eval === "UNKNOWN") as THREE.Object3D;
    layer.setMetresPerPixel(1);
    const a = mat(unk).dashSize;
    layer.setMetresPerPixel(0.25);
    expect(mat(unk).dashSize).toBeCloseTo(a / 4, 6);
  });

  it("world-unit lines (depth-correct); width ~RIBBON_WIDTH_PX on screen, clamped in metres", () => {
    for (const o of layer.ribbon.children) expect(mat(o).worldUnits).toBe(true);
    layer.setMetresPerPixel(0.3);
    for (const o of layer.ribbon.children)
      expect(mat(o).linewidth).toBeCloseTo(0.3 * RIBBON_WIDTH_PX, 6);
    layer.setMetresPerPixel(0.001); // close to the hero: a painted strip, not a thread
    for (const o of layer.ribbon.children) expect(mat(o).linewidth).toBe(RIBBON_WIDTH_M.min);
    layer.setMetresPerPixel(50); // far overview: capped
    for (const o of layer.ribbon.children) expect(mat(o).linewidth).toBe(RIBBON_WIDTH_M.max);
  });

  it("setResolution reaches every line material", () => {
    layer.setResolution(1440, 900);
    for (const o of layer.ribbon.children) expect(mat(o).resolution.toArray()).toEqual([1440, 900]);
  });
});

describe("journey markers", () => {
  const layer = createJourneyLayer(plan, frame);
  const sprites = layer.markers.children as THREE.Sprite[];

  it("live in their own scene, one sprite per plan event", () => {
    expect(layer.markers).toBeInstanceOf(THREE.Scene);
    expect(sprites).toHaveLength(plan.events.length);
    expect(sprites.every((s) => s instanceof THREE.Sprite)).toBe(true);
  });

  it("are never opaque quads: transparent, no depth, not tone mapped", () => {
    for (const s of sprites) {
      const m = s.material;
      expect(m.transparent).toBe(true);
      expect(m.depthTest).toBe(false);
      expect(m.depthWrite).toBe(false);
      expect(m.toneMapped).toBe(false);
    }
  });

  it("stand above the event's route point; events at the same metre stack up", () => {
    const ramp = plan.events.findIndex((e) => e.title === "Ramp");
    const bench2 = plan.events.findIndex((e) => e.title === "Urban Park bench 2");
    const a = layer.anchorOf(ramp) as [number, number, number];
    const b = layer.anchorOf(bench2) as [number, number, number];
    expect(a[0]).toBeCloseTo(b[0], 6);
    expect(a[1]).toBeCloseTo(MARKER_LIFT_M, 6);
    expect(b[1]).toBeCloseTo(MARKER_LIFT_M + MARKER_STACK_M, 6);
    expect(layer.anchorOf(99)).toBeNull();
  });

  it("the active marker grows; others keep the rest size", () => {
    layer.setActive(2);
    const s2 = sprites[2]?.scale.x ?? 0;
    const s0 = sprites[0]?.scale.x ?? 0;
    expect(s2).toBeGreaterThan(s0);
    layer.setActive(null);
    expect(sprites[2]?.scale.x).toBe(s0);
  });

  it("dispose frees every geometry and material", () => {
    const l = createJourneyLayer(plan, frame);
    let n = 0;
    l.ribbon.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      m?.addEventListener("dispose", () => n++);
    });
    for (const s of l.markers.children as THREE.Sprite[])
      s.material.addEventListener("dispose", () => n++);
    l.dispose();
    expect(n).toBe(l.ribbon.children.length + plan.events.length);
  });
});

describe("projectToScreen", () => {
  const cam = new THREE.PerspectiveCamera(45, 2, 1, 1000);
  cam.position.set(0, 0, 10);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();

  it("maps the view centre to the viewport centre (CSS px, y down)", () => {
    expect(projectToScreen(cam, [0, 0, 0], [800, 400])).toEqual({ x: 400, y: 200 });
    const up = projectToScreen(cam, [0, 1, 0], [800, 400]);
    expect(up?.y).toBeLessThan(200);
  });

  it("returns null behind the camera", () => {
    expect(projectToScreen(cam, [0, 0, 20], [800, 400])).toBeNull();
  });
});
