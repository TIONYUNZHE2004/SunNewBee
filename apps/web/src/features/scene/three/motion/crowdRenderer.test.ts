import { readFileSync } from "node:fs";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { createMotionUniforms, createRoleUniforms } from "../assets/roleMaterial";
import { type Agent, easedDistance, PEOPLE_VISIBLE_M, peopleScale } from "./agents";
import type { CrowdKit } from "./crowdBake";
import { framePair, gaitStartPhase, seedPhase } from "./crowdGait";
import { loadCrowdKit } from "./crowdKit";
import { crowdLodBands, patchCrowdShader } from "./crowdRenderer";
import { lookSpeed } from "./crowdRules";
import { createMotionLayer, crowdLookIndex } from "./motionLayer";

/** C-T7 (P4, P5): the crowd renderer through the motion layer, on the committed crowd glbs. */
const pub = (p: string) => new URL(`../../../../../public${p}`, import.meta.url);
const readBuf = (p: string) => {
  const b = readFileSync(pub(p.split("?")[0] as string));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

let kit: CrowdKit;
let loadMs = 0;
beforeAll(async () => {
  const t0 = performance.now();
  kit = await loadCrowdKit({
    fetchJson: async (u) => JSON.parse(readFileSync(pub(u), "utf8")),
    loadGlb: async (u) => readBuf(u),
  });
  loadMs = performance.now() - t0;
}, 30_000);

const person = (id: string, x: number, z: number, look?: string): Agent => ({
  id,
  kind: "person",
  variant: "v",
  path: new Float32Array([x, z, x + 100, z]),
  length: 100,
  speed: 1.3,
  offset: 0,
  ...(look ? { look } : {}),
});
// No legacy kits: the library has nothing, so only the crowd draws people.
const emptyLib = {
  geometry: () => null,
  has: () => false,
  gpuBytes: () => 0,
  failed: [],
  dispose() {},
};
const manifest = { version: 1, as_of: "", precinctGroups: [], assets: {}, landmarks: {} } as never;
const make = (agents: Agent[], crowd: CrowdKit | null = kit) =>
  createMotionLayer(agents, emptyLib, manifest, createRoleUniforms(), createMotionUniforms(), {
    crowd,
  });
const cam = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
describe("crowd renderer", () => {
  it("loads and bakes the kit (loose wall-clock ceiling; the < 200 ms target is a gate measurement)", () => {
    expect(kit.bakeMs).toBeLessThan(2000);
    expect(loadMs).toBeLessThan(10_000);
  });

  it("a load that times out or is aborted rejects (useMotion then falls back to the legacy people kit)", async () => {
    const never = () => new Promise<never>(() => {});
    await expect(loadCrowdKit({ fetchJson: never, loadGlb: never, timeoutMs: 20 })).rejects.toThrow(
      /timed out/,
    );
    const ac = new AbortController();
    const p = loadCrowdKit({
      fetchJson: async (u) => JSON.parse(readFileSync(pub(u), "utf8")),
      loadGlb: async (u) => readBuf(u),
      signal: ac.signal,
    });
    ac.abort();
    await expect(p).rejects.toThrow(/aborted/);
  });

  it("gait phase is a pure function of id and distance on first sight (two runs agree)", () => {
    const run = () => {
      const layer = make([person("same", 0, 0)]);
      layer.tick(7300, cam(0, 30, 0));
      const out = Array.from(layer.crowd?.instances().slice(0, 3) ?? []);
      layer.dispose();
      return out;
    };
    expect(run()).toEqual(run());
    const layer = make([person("same", 0, 0)]);
    const look = kit.manifest.looks[layer.crowd!.lookOf(0)];
    layer.dispose();
    const clip = look ? kit.clips[look.body][look.clips.walk] : undefined;
    if (!look || !clip) throw new Error("no walk clip");
    // The layer walks the person at its look's speed (C-T8).
    const stride = kit.manifest.bodies[look.body].clips[look.clips.walk]!.stride;
    const p = person("same", 0, 0);
    const a = { ...p, speed: lookSpeed(p, look, stride) };
    const f = framePair(
      gaitStartPhase(a.id, easedDistance(a, 7.3), clip, peopleScale(30)),
      clip.frames,
    );
    expect(run()[0]).toBe(clip.row + f.f0);
  });

  it("P4: 400 people of every look cost at most 2 draw calls (<= 20); LOD0 and LOD1 by distance", () => {
    const n = 400;
    const looks = kit.manifest.looks;
    const agents = Array.from({ length: n }, (_, i) =>
      person(`p${i}`, (i % 20) * 6 - 60, Math.floor(i / 20) * 6, looks[i % looks.length]?.id),
    );
    const layer = make(agents);
    layer.tick(0, cam(0, 40, 0));
    const crowd = layer.crowd!;
    const [l0, l1] = crowd.visible();
    expect(l0 + l1).toBe(n);
    expect(l0).toBeGreaterThan(0);
    expect(l1).toBeGreaterThan(0);
    expect(crowd.drawCalls()).toBe(2);
    // Counted plan of the renderer's draws: every visible drawable in the layer. BatchedMesh draws
    // all its instances in one multi-draw call (three counts it once in renderer.info).
    let draws = 0;
    let instanced = 0;
    layer.group.traverse((o) => {
      if ((o as THREE.BatchedMesh).isBatchedMesh && o.visible) draws++;
      if ((o as THREE.InstancedMesh).isInstancedMesh) instanced++;
    });
    expect(draws).toBeLessThanOrEqual(20);
    expect(draws).toBe(2);
    // No legacy people-kit mesh (the shader limb swing is not used for crowd people).
    expect(instanced).toBe(0);
    // Triangles drawn per person within the LOD budgets.
    for (const lod of [0, 1] as const) {
      const bm = crowd.meshes[lod];
      for (let i = 0; i < n; i++) {
        if (!bm.getVisibleAt(i)) continue;
        const range = bm.getGeometryRangeAt(bm.getGeometryIdAt(i));
        expect(range?.count ?? 0).toBeLessThanOrEqual(3 * (kit.manifest.lods[lod]?.maxTris ?? 0));
      }
    }
  });

  it("R-J7 (supersedes P4's 300 m): LOD0 to 60 m, LOD1 to 800 m, hidden beyond 800 m", () => {
    expect(crowdLodBands(kit.manifest.lods)).toEqual([{ maxM: 60 }, { maxM: PEOPLE_VISIBLE_M }]);
    const layer = make([person("a", 0, 0)]);
    const at = (h: number) => {
      layer.tick(0, cam(0, h, 0));
      return layer.crowd!.visible();
    };
    expect(at(30)).toEqual([1, 0]);
    expect(at(200)).toEqual([0, 1]);
    expect(at(400)).toEqual([0, 1]);
    expect(at(790)).toEqual([0, 1]);
    // Hidden beyond 800 m outright (no LOD hysteresis past the cut).
    expect(at(820)).toEqual([0, 0]);
    expect(layer.crowd!.drawCalls()).toBe(0);
    expect(layer.crowd!.meshes.every((m) => !m.visible)).toBe(true);
  });

  it("a look id per agent is honoured; without one the look is a seeded pick", () => {
    const id = kit.manifest.looks.find((l) => l.prop === "wheelchair")!.id;
    const a = person("w", 0, 0, id);
    const b = person("seeded", 0, 5);
    const layer = make([a, b]);
    expect(layer.crowd!.lookOf(0)).toBe(kit.lookIndex.get(id));
    expect(crowdLookIndex(kit, b)).toBe(crowdLookIndex(kit, { ...b }));
    expect(layer.crowd!.lookOf(1)).toBe(crowdLookIndex(kit, b));
    // An unknown look id falls back to the seeded pick.
    expect(crowdLookIndex(kit, { ...b, look: "nope" })).toBe(crowdLookIndex(kit, b));
  });

  it("P5: instance rows sit in the look's walk clip at the agent's seeded phase; rows advance with distance", () => {
    const look = kit.manifest.looks[19]!;
    const clip = kit.clips[look.body][look.clips.walk]!;
    const layer = make([person("a", 0, 0, look.id), person("b", 0, 3, look.id)]);
    layer.tick(0, cam(0, 30, 0));
    const inst = layer.crowd!.instances();
    for (const [i, id] of ["a", "b"].entries()) {
      const f = framePair(seedPhase(id), clip.frames);
      expect(inst[i * 4]).toBe(clip.row + f.f0);
      expect(inst[i * 4 + 1]).toBe(clip.row + f.f1);
      expect(inst[i * 4 + 2]).toBeCloseTo(f.t, 5);
      expect(inst[i * 4 + 3]).toBe(kit.lookIndex.get(look.id));
    }
    // Different agents, different phases (no lockstep).
    expect(inst[0]).not.toBe(inst[4]);
    const before = inst[0] as number;
    layer.tick(100, cam(0, 30, 0));
    expect(layer.crowd!.instances()[0]).not.toBe(before);
    for (const r of [inst[0], inst[1]] as number[]) {
      expect(r).toBeGreaterThanOrEqual(clip.row);
      expect(r).toBeLessThanOrEqual(clip.row + clip.frames);
    }
  });

  it("decorative: no-op raycast, no shadow casting, opacity fades the crowd material", () => {
    const layer = make([person("a", 0, 0)]);
    layer.tick(0, cam(0, 30, 0));
    expect(layer.crowd!.group.userData.decorative).toBe(true);
    for (const m of layer.crowd!.meshes) {
      expect(m.userData.decorative).toBe(true);
      expect(m.castShadow).toBe(false);
      const hits: THREE.Intersection[] = [];
      m.raycast(new THREE.Raycaster(cam(0, 30, 0), new THREE.Vector3(0, -1, 0)), hits);
      expect(hits).toHaveLength(0);
    }
    layer.setOpacity(0.4);
    expect(layer.crowd!.material.opacity).toBeCloseTo(0.4);
    expect(layer.crowd!.material.transparent).toBe(true);
  });

  it("null kit (still loading) draws no people and keeps vehicles; dispose keeps the kit geometry", () => {
    const layer = make([person("a", 0, 0)], null);
    layer.tick(0, cam(0, 30, 0));
    expect(layer.crowd).toBeNull();
    const ok = make([person("a", 0, 0)]);
    ok.tick(0, cam(0, 30, 0));
    ok.dispose();
    expect(kit.geometries[0][0]?.getAttribute("position")).toBeTruthy();
  });

  it("the skinning shader patches three's physical and standard programs", () => {
    for (const lib of [THREE.ShaderLib.physical, THREE.ShaderLib.standard]) {
      const shader = {
        vertexShader: lib.vertexShader,
        fragmentShader: lib.fragmentShader,
        uniforms: {} as Record<string, unknown>,
      };
      patchCrowdShader(shader, { tlCrowdAnim: { value: null } });
      expect(shader.vertexShader).toContain("getIndirectIndex(gl_DrawID)");
      expect(shader.vertexShader).toContain("texelFetch(tlCrowdAnim");
      expect(shader.vertexShader).not.toContain("#include <skinning_vertex>");
      expect(shader.vertexShader).not.toContain("tlLimb");
      expect(shader.fragmentShader).toContain("texture2D(tlCrowdPal, vTlPal)");
      expect(shader.uniforms.tlCrowdAnim).toBeDefined();
    }
  });

  it("P9 boundary (partial, C-T8 owns the full test): crowd modules import no journey code", () => {
    for (const f of ["crowdBake.ts", "crowdGait.ts", "crowdKit.ts", "crowdRenderer.ts"]) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
      expect(src, f).not.toMatch(/from "[^"]*journey[^"]*"/);
    }
  });
});
