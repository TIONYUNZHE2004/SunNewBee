import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  createMotionUniforms,
  createRoleMaterial,
  createRoleUniforms,
  type MotionUniforms,
} from "./roleMaterial";

function compile(
  instanced: boolean,
  extra: {
    kind?: "tree" | "person" | "vehicle" | "parked" | "static";
    motion?: MotionUniforms;
    flicker?: boolean;
  } = {},
) {
  const uniforms = createRoleUniforms();
  const mat = createRoleMaterial({ instanced, uniforms, ...extra });
  const shader = {
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    uniforms: {} as Record<string, { value: unknown }>,
  };
  // biome-ignore lint/suspicious/noExplicitAny: shader stub
  (mat.onBeforeCompile as any)(shader, null);
  return { mat, shader, uniforms };
}

describe("createRoleMaterial", () => {
  it("instanced: palette attributes, colour chunk replaced, shared uniforms", () => {
    const { mat, shader, uniforms } = compile(true);
    expect(shader.vertexShader).toContain("attribute vec3 iPal0");
    expect(shader.fragmentShader).not.toContain("#include <color_fragment>");
    expect(shader.fragmentShader).toContain("floor(vColor.g * 7.0 + 0.5)");
    expect(shader.uniforms.uWindowGlow).toBe(uniforms.uWindowGlow);
    expect(shader.uniforms.uLitShare).toBe(uniforms.uLitShare);
    expect(shader.uniforms.uLightGlow).toBe(uniforms.uLightGlow);
    expect(shader.uniforms.uAoStrength).toBe(uniforms.uAoStrength);
    expect(mat.vertexColors).toBe(true);
  });

  it("single mesh: uniform palette, no instanced attributes", () => {
    const { shader } = compile(false);
    expect(shader.vertexShader).not.toContain("iPal0");
    expect(shader.fragmentShader).toContain("uniform vec3 uPal0");
    expect(shader.uniforms.uPal0).toBeDefined();
    expect(shader.uniforms.uPal2).toBeDefined();
  });

  it("uniform defaults", () => {
    const u = createRoleUniforms();
    expect([
      u.uWindowGlow.value,
      u.uLitShare.value,
      u.uLightGlow.value,
      u.uAoStrength.value,
    ]).toEqual([0, 0.6, 0, 1]);
  });
});

describe("createRoleMaterial motion and kit kinds", () => {
  it("motion uniform defaults are 0, 1, 1", () => {
    const m = createMotionUniforms();
    expect([m.uTime.value, m.uSway.value, m.uLimb.value]).toEqual([0, 1, 1]);
  });

  it("tree injects uSway and the sway term, with shared motion uniforms", () => {
    const motion = createMotionUniforms();
    const { shader } = compile(true, { kind: "tree", motion });
    expect(shader.uniforms.uTime).toBe(motion.uTime);
    expect(shader.uniforms.uSway).toBe(motion.uSway);
    expect(shader.vertexShader).toContain("uniform float uSway");
    expect(shader.vertexShader).toContain("uTime * 1.3");
    expect(shader.vertexShader).toContain("0.25");
    expect(shader.vertexShader).toContain("color.b");
    expect(shader.vertexShader).toContain("instanceMatrix[3]");
  });

  it("person injects uLimb and the leg and arm pivots", () => {
    const motion = createMotionUniforms();
    const { shader } = compile(true, { kind: "person", motion });
    expect(shader.uniforms.uLimb).toBe(motion.uLimb);
    expect(shader.vertexShader).toContain("uniform float uLimb");
    expect(shader.vertexShader).toContain("0.9");
    expect(shader.vertexShader).toContain("1.35");
    expect(shader.vertexShader).toContain("0.95");
    expect(shader.vertexShader).toContain("0.45");
    expect(shader.vertexShader).toContain("uTime * 6.0");
  });

  it("vehicle carries both light colours and a 0.15 headlight floor", () => {
    const { shader } = compile(true, { kind: "vehicle" });
    const c = (h: string) => {
      const k = new THREE.Color(h);
      return `vec3(${k.r.toFixed(5)}, ${k.g.toFixed(5)}, ${k.b.toFixed(5)})`;
    };
    expect(shader.fragmentShader).toContain(c("#fff4d6"));
    expect(shader.fragmentShader).toContain(c("#ff3b30"));
    expect(shader.fragmentShader).toContain("max(uLightGlow, 0.15)");
  });

  it("parked: the static program with the light role unlit (no headlight, tail light or lamp glow)", () => {
    const base = compile(true);
    const { shader, mat } = compile(true, { kind: "parked" });
    expect(shader.vertexShader).toBe(base.shader.vertexShader);
    expect(shader.fragmentShader).not.toContain("tlRole >= 7) totalEmissiveRadiance");
    expect(shader.fragmentShader).not.toContain("max(uLightGlow, 0.15)");
    expect(base.shader.fragmentShader).toContain("tlRole >= 7) totalEmissiveRadiance");
    // Glass and every other role are as the static program draws them.
    expect(shader.fragmentShader).toContain("uWindowGlow");
    expect(mat.customProgramCacheKey()).not.toBe(base.mat.customProgramCacheKey());
    expect(mat.customProgramCacheKey()).not.toBe(
      compile(true, { kind: "vehicle" }).mat.customProgramCacheKey(),
    );
  });

  it("tree, person and vehicle use distinct program cache keys", () => {
    const k = (kind: "tree" | "person" | "vehicle" | "static") =>
      compile(true, { kind }).mat.customProgramCacheKey();
    expect(new Set([k("tree"), k("person"), k("vehicle")]).size).toBe(3);
  });

  it("without motion or kind the Phase 2 shader is unchanged", () => {
    const base = compile(true);
    for (const extra of [{ kind: "static" as const }, { kind: undefined }]) {
      const o = compile(true, extra);
      expect(o.shader.vertexShader).toBe(base.shader.vertexShader);
      expect(o.shader.fragmentShader).toBe(base.shader.fragmentShader);
      expect(o.mat.customProgramCacheKey()).toBe(base.mat.customProgramCacheKey());
    }
    expect(base.shader.vertexShader).not.toContain("uSway");
    expect(base.shader.uniforms.uTime).toBeUndefined();
  });
});

describe("createRoleMaterial window flicker", () => {
  it("uFlicker defaults to 0", () => {
    expect(createRoleUniforms().uFlicker.value).toBe(0);
  });

  it("without the flicker option the shader never mentions uFlicker", () => {
    const { shader } = compile(true);
    expect(shader.fragmentShader).not.toContain("uFlicker");
    expect(shader.uniforms.uFlicker).toBeUndefined();
  });

  it("with the option the lit-window term is gated by uFlicker and uses the spec factor", () => {
    const motion = createMotionUniforms();
    const { mat, shader, uniforms } = compile(true, { flicker: true, motion });
    expect(shader.uniforms.uFlicker).toBe(uniforms.uFlicker);
    expect(shader.uniforms.uTime).toBe(motion.uTime);
    expect(shader.fragmentShader).toContain("uniform float uFlicker");
    expect(shader.fragmentShader).toContain(
      "mix(1.0, 0.9 + 0.1 * step(0.97, fract(sin(vColor.b * 9301.0 + floor(uTime * 0.5)) * 43758.0)), uFlicker)",
    );
    expect(mat.customProgramCacheKey()).not.toBe(compile(true).mat.customProgramCacheKey());
  });

  it("an archetype material with flicker and motion has no vehicle branch and differs from Phase 2 only by the flicker term", () => {
    const base = compile(true);
    const f = compile(true, { flicker: true, motion: createMotionUniforms() });
    expect(f.shader.fragmentShader).not.toContain("max(uLightGlow, 0.15)");
    expect(f.shader.vertexShader).toBe(base.shader.vertexShader);
    const strip = f.shader.fragmentShader
      .replace("uniform float uTime;\nuniform float uFlicker;\n", "")
      .replace(/ \* mix\(1\.0, 0\.9[^;]*uFlicker\)/, "");
    expect(strip).toBe(base.shader.fragmentShader);
  });
});
