import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createRoleMaterial, createRoleUniforms } from "./roleMaterial";

function compile(instanced: boolean) {
  const uniforms = createRoleUniforms();
  const mat = createRoleMaterial({ instanced, uniforms });
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
