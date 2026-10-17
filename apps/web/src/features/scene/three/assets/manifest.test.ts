import { describe, expect, it } from "vitest";
import { parseManifest } from "./manifest";

const asset = () => ({
  group: "archetype",
  file: "archetypes/a.glb",
  bytes: 10,
  repeat: "none",
  frontage: "short",
  fit: { xz: [0.75, 1.35], y: [0.6, 1.6] },
  decorative: false,
  placement: null,
  jitter: {},
  variantByGroup: { default: "v" },
  palettes: { default: [["#f2efe8", "#3d4147", "#8a8f96"]] },
  variants: {
    v: {
      size: [1, 2, 3],
      lods: [
        { node: "a__v__LOD0", tris: 100, maxM: 300 },
        { node: "a__v__LOD1", tris: 10, maxM: null },
      ],
    },
  },
});
const base = (assets: Record<string, unknown> = { a: asset() }) => ({
  version: 1,
  as_of: "2026-10-17",
  roles: ["primary"],
  precinctGroups: [["valley", "elmina valley"]],
  assets,
  landmarks: { lakeside_mall: { anchor: [101.5, 3.18] } },
});

describe("parseManifest", () => {
  it("parses a minimal valid manifest", () => {
    const r = parseManifest(base());
    expect(r.problems).toEqual([]);
    expect(r.manifest?.assets.a?.variants.v?.lods[1]?.maxM).toBeNull();
    expect(r.manifest?.landmarks.lakeside_mall?.anchor).toEqual([101.5, 3.18]);
  });
  it("rejects another version", () => {
    expect(parseManifest({ ...base(), version: 2 }).manifest).toBeNull();
  });
  it("drops a bad asset and names it", () => {
    const bad = asset();
    (bad.variants.v.lods[0] as { tris: unknown }).tris = "many";
    const r = parseManifest(base({ a: asset(), b: bad }));
    expect(Object.keys(r.manifest?.assets ?? {})).toEqual(["a"]);
    expect(r.problems.some((p) => p.includes("b"))).toBe(true);
  });
  it("returns null for null or a string without throwing", () => {
    expect(parseManifest(null).manifest).toBeNull();
    expect(parseManifest("x").manifest).toBeNull();
  });
  it("treats a non #rrggbb palette colour as a problem", () => {
    const bad = asset();
    bad.palettes = { default: [["red", "#000000", "#ffffff"]] };
    const r = parseManifest(base({ a: asset(), bad }));
    expect(r.manifest?.assets.bad).toBeUndefined();
    expect(r.problems.some((p) => p.includes("bad"))).toBe(true);
  });
});
