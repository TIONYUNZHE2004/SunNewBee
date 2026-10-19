import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CLAY, CLAY_PALETTE } from "../shared/clayTokens";
import {
  AO_FLOOR,
  AO_FLOOR_BY_ROLE,
  aoFloorGlsl,
  BEVEL_FRAGMENT,
  BEVEL_VERTEX,
  BUILDING_SHADER_BEVEL,
  bevelBoxOf,
  createMotionUniforms,
  createRoleMaterial,
  createRoleUniforms,
  FIXED_ROLE_COLOURS,
  type MotionUniforms,
  ROLE_CLAY,
  ROLE_SHEEN_GLSL,
  roleResponseGlsl,
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

  it("floors the baked AO so a zero corner never multiplies the role colour to black (A-T8)", () => {
    const { shader } = compile(true);
    expect(shader.fragmentShader).toContain("max(vColor.r, tlAoFloor)");
    expect(shader.fragmentShader).toContain(aoFloorGlsl());
  });

  it("per-role AO floors: glass is (nearly) exempt, walls and roofs keep contact shadows", () => {
    expect(AO_FLOOR_BY_ROLE).toHaveLength(8);
    for (const f of AO_FLOOR_BY_ROLE) {
      expect(f).toBeGreaterThanOrEqual(AO_FLOOR);
      expect(f).toBeLessThanOrEqual(1);
    }
    expect(AO_FLOOR_BY_ROLE[3]).toBeGreaterThanOrEqual(0.85);
    expect(AO_FLOOR_BY_ROLE[0]).toBe(AO_FLOOR);
    expect(AO_FLOOR_BY_ROLE[1]).toBe(AO_FLOOR);
    expect(aoFloorGlsl()).toContain("if (tlRole == 3) tlAoFloor = 0.85;");
  });

  it("no fake glass reflection: glass has no daylight emissive term", () => {
    const { shader } = compile(true);
    expect(shader.fragmentShader).not.toContain("GLASS_SKY");
    expect(shader.fragmentShader).toContain("if (tlRole == 3 && vColor.b < uLitShare)");
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

  it("parked: light-role faces take the vehicle body colour (primary palette), not the lamp colour", () => {
    const { shader } = compile(true, { kind: "parked" });
    const base = compile(true).shader;
    expect(shader.fragmentShader).toContain("else if (tlRole >= 7) tlBase = vPal0;");
    expect(base.fragmentShader).not.toContain("tlRole >= 7) tlBase = vPal0");
    // The single-mesh program reads the body colour from its uniform.
    expect(compile(false, { kind: "parked" }).shader.fragmentShader).toContain(
      "else if (tlRole >= 7) tlBase = uPal0;",
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

describe("clay role material (B-T1)", () => {
  it("High: physical clay with sheen; every shader patch lands in the physical program", () => {
    const uniforms = createRoleUniforms();
    const mat = createRoleMaterial({ instanced: true, uniforms, tier: "high", flicker: true });
    expect(mat).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect((mat as THREE.MeshPhysicalMaterial).sheen).toBe(CLAY.wall.sheen);
    expect(mat.roughness).toBe(CLAY.wall.roughness);
    const shader = {
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
      uniforms: {} as Record<string, { value: unknown }>,
    };
    // biome-ignore lint/suspicious/noExplicitAny: shader stub
    (mat.onBeforeCompile as any)(shader, null);
    expect(shader.fragmentShader).not.toContain("#include <color_fragment>");
    expect(shader.fragmentShader).toContain(roleResponseGlsl("wall"));
    // Per-role sheen lands after the physical lighting setup (USE_SHEEN guards Medium / Low).
    const at = shader.fragmentShader.indexOf("#include <lights_physical_fragment>");
    expect(at).toBeGreaterThan(-1);
    expect(shader.fragmentShader.indexOf(ROLE_SHEEN_GLSL)).toBeGreaterThan(at);
    expect(shader.fragmentShader).toContain("varying vec3 vPal0");
    expect(shader.vertexShader).toContain("attribute vec3 iPal0");
  });

  it("Medium / Low: the standard program (no sheen)", () => {
    for (const tier of ["medium", "low"] as const) {
      const mat = createRoleMaterial({ instanced: true, uniforms: createRoleUniforms(), tier });
      expect(mat).not.toBeInstanceOf(THREE.MeshPhysicalMaterial);
    }
  });

  it("per-role response: roughness from each role's token, metalness only on role 5 (metal)", () => {
    expect(ROLE_CLAY).toHaveLength(8);
    const glsl = roleResponseGlsl();
    ROLE_CLAY.forEach((role, i) => {
      const tok = CLAY[role];
      expect(glsl).toContain(`roughnessFactor = ${tok.roughness.toFixed(2)}`);
      if (i !== 5) expect(tok.metalness, role).toBe(0);
    });
    expect(CLAY[ROLE_CLAY[5]!].metalness).toBeGreaterThan(0);
  });

  it("people and vehicles take their own clay token", () => {
    const u = createRoleUniforms();
    expect(
      createRoleMaterial({ instanced: true, uniforms: u, kind: "person" }).userData.clayRole,
    ).toBe("person");
    expect(
      createRoleMaterial({ instanced: true, uniforms: u, kind: "parked" }).userData.clayRole,
    ).toBe("vehicle");
  });
});

describe("per-role sheen (B-T1 fix round 1)", () => {
  it("each role's sheen is scaled relative to the material's base token, with its sheen roughness", () => {
    for (const base of ["wall", "person", "vehicle"] as const) {
      const glsl = roleResponseGlsl(base);
      ROLE_CLAY.forEach((role) => {
        expect(glsl).toContain(`tlSheenK = ${(CLAY[role].sheen / CLAY[base].sheen).toFixed(4)}`);
        expect(glsl).toContain(`tlSheenR = ${CLAY[role].sheenRoughness.toFixed(2)}`);
      });
    }
    // Roles really differ (foliage 0.5 vs glass 0.15), so the multiplier is not a constant.
    expect(CLAY.foliage.sheen).not.toBe(CLAY.glass.sheen);
  });

  it("person materials compile the person-based multipliers", () => {
    const mat = createRoleMaterial({
      instanced: true,
      uniforms: createRoleUniforms(),
      kind: "person",
      tier: "high",
    });
    const shader = {
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
      uniforms: {} as Record<string, { value: unknown }>,
    };
    // biome-ignore lint/suspicious/noExplicitAny: shader stub
    (mat.onBeforeCompile as any)(shader, null);
    expect(shader.fragmentShader).toContain(roleResponseGlsl("person"));
  });
});

describe("tree trunks are clay (B-T1 fix round 1)", () => {
  it("kind tree: the dark role (trunks) draws CLAY_PALETTE.trunk; other kinds keep the fixed dark", () => {
    const c = (h: string) => {
      const k = new THREE.Color(h);
      return `tlRole == 4) tlBase = vec3(${k.r.toFixed(5)}, ${k.g.toFixed(5)}, ${k.b.toFixed(5)})`;
    };
    expect(compile(true, { kind: "tree" }).shader.fragmentShader).toContain(c(CLAY_PALETTE.trunk));
    expect(compile(true).shader.fragmentShader).toContain(c(FIXED_ROLE_COLOURS.dark));
  });
});

describe("shader bevel for archetype and landmark GLBs (B-T2, AC-B3)", () => {
  const box = { min: [-5, 0, -4], max: [5, 9, 4] } as {
    min: [number, number, number];
    max: [number, number, number];
  };
  const build = (instanced: boolean, lib: "standard" | "physical", bevel = true) => {
    const mat = createRoleMaterial({
      instanced,
      uniforms: createRoleUniforms(),
      ...(bevel ? { bevel: box } : {}),
      tier: lib === "physical" ? "high" : "medium",
    });
    const shader = {
      vertexShader: THREE.ShaderLib[lib].vertexShader,
      fragmentShader: THREE.ShaderLib[lib].fragmentShader,
      uniforms: {} as Record<string, { value: unknown }>,
    };
    // biome-ignore lint/suspicious/noExplicitAny: shader stub
    (mat.onBeforeCompile as any)(shader, null);
    return { mat, shader };
  };

  it("rounds within 0.45 m of the model box edges, normal only", () => {
    expect(BUILDING_SHADER_BEVEL.radiusM).toBe(0.45);
    // shading only: the vertex chunk never writes a position
    expect(BEVEL_VERTEX).not.toMatch(/transformed|gl_Position/);
    expect(BEVEL_FRAGMENT).toContain("normal = normalize(normal + tlAdd)");
  });

  for (const lib of ["standard", "physical"] as const)
    for (const instanced of [true, false])
      it(`patches the ${lib} program (${instanced ? "instanced" : "single mesh"}): the box, the radius, after the normal maps`, () => {
        const { mat, shader } = build(instanced, lib);
        expect(mat.customProgramCacheKey()).toMatch(/_bv$/);
        expect(shader.vertexShader).toContain(`#include <defaultnormal_vertex>
${BEVEL_VERTEX}`);
        expect(shader.fragmentShader).toContain(`#include <normal_fragment_maps>
${BEVEL_FRAGMENT}`);
        expect(shader.fragmentShader.indexOf("uniform vec3 uTlBoxMin")).toBeLessThan(
          shader.fragmentShader.indexOf("void main()"),
        );
        expect((shader.uniforms.uTlBoxMax!.value as THREE.Vector3).toArray()).toEqual([5, 9, 4]);
        expect((shader.uniforms.uTlBevel!.value as THREE.Vector2).toArray()).toEqual([
          BUILDING_SHADER_BEVEL.radiusM,
          BUILDING_SHADER_BEVEL.onFaceM,
        ]);
      });

  it("without a box nothing changes (kits, people, vehicles, facades)", () => {
    const { mat, shader } = build(true, "standard", false);
    expect(mat.customProgramCacheKey()).not.toMatch(/_bv/);
    expect(shader.fragmentShader).not.toContain("uTlBoxMin");
    expect(mat.userData.bevel).toBeUndefined();
  });

  it("bevelBoxOf reads the geometry's bounds", () => {
    const g = new THREE.BoxGeometry(2, 3, 4).translate(0, 1.5, 0);
    expect(bevelBoxOf(g)).toEqual({ min: [-1, 0, -2], max: [1, 3, 2] });
    expect(bevelBoxOf(new THREE.BufferGeometry())).toBeNull();
  });
});
