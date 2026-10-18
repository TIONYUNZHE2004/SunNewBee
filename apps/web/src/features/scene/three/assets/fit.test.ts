import { describe, expect, it } from "vitest";
import {
  fitArchetype,
  footprintObb,
  hash01,
  jitterFor,
  type Obb,
  paletteFor,
  precinctGroupOf,
  variantFor,
  yawForFront,
} from "./fit";
import type { AssetSpec } from "./manifest";

const PAL: [string, string, string][] = [
  ["#111111", "#222222", "#333333"],
  ["#444444", "#555555", "#666666"],
  ["#777777", "#888888", "#999999"],
];
const spec = (over: Partial<AssetSpec> = {}): AssetSpec => ({
  group: "archetype",
  file: "archetypes/link_intermediate.glb",
  bytes: 1,
  repeat: "frontage",
  frontage: "short",
  fit: { xz: [0.75, 1.35], y: [0.6, 1.6] },
  decorative: false,
  placement: null,
  jitter: {},
  variantByGroup: { default: "gable", valley: "modern" },
  palettes: { default: PAL, valley: [["#aa0000", "#00aa00", "#0000aa"]] },
  variants: {
    gable: { size: [6.4, 8.5, 15.5], lods: [{ node: "x", tris: 1, maxM: null }] },
    modern: { size: [6.4, 8.5, 15.5], lods: [{ node: "y", tris: 1, maxM: null }] },
  },
  ...over,
});

/** Rectangle w (short) x l (long), long axis at `deg` (from +x toward -z), centred at (cx, cz). */
function rect(w: number, l: number, deg: number, cx = 0, cz = 0): [number, number][] {
  const a = (deg * Math.PI) / 180;
  const u = [Math.cos(a), -Math.sin(a)];
  const v = [-u[1]!, u[0]!];
  const pts: [number, number][] = [];
  for (const [s, t] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const)
    pts.push([cx + (s * l * u[0]! + t * w * v[0]!) / 2, cz + (s * l * u[1]! + t * w * v[1]!) / 2]);
  return pts;
}
const obbOf = (w: number, l: number, deg = 0): Obb => footprintObb(rect(w, l, deg))!;

describe("footprintObb", () => {
  it("recovers a rotated rectangle", () => {
    const o = footprintObb(rect(6.4, 15.5, 30, 10, -4))!;
    expect(o.w).toBeCloseTo(6.4, 2);
    expect(o.l).toBeCloseTo(15.5, 2);
    expect(o.fill).toBeCloseTo(1, 3);
    expect(((o.angle * 180) / Math.PI) % 180).toBeCloseTo(30, 1);
    expect(o.cx).toBeCloseTo(10, 3);
    expect(o.cz).toBeCloseTo(-4, 3);
  });
  it("gives an L-shape low fill, and the archetype refuses it", () => {
    const L: [number, number][] = [
      [0, 0],
      [16, 0],
      [16, 4],
      [4, 4],
      [4, 16],
      [0, 16],
    ];
    const o = footprintObb(L)!;
    expect(o.fill).toBeLessThan(0.75);
    expect(fitArchetype(o, spec(), "gable", 8.5, null, "L")).toBeNull();
  });
  it("returns null for a degenerate ring", () => {
    expect(footprintObb([[0, 0]])).toBeNull();
    expect(
      footprintObb([
        [0, 0],
        [1, 1],
        [2, 2],
      ]),
    ).toBeNull();
  });
});

describe("fitArchetype", () => {
  it("fits one house at scale 1", () => {
    const r = fitArchetype(obbOf(6.4, 15.5, 20), spec(), "gable", 8.5, null, "a")!;
    expect(r).toHaveLength(1);
    expect(r[0]!.sx).toBeCloseTo(1, 2);
    expect(r[0]!.sy).toBeCloseTo(1, 6);
    expect(r[0]!.sz).toBeCloseTo(1, 2);
  });
  it("splits a 64 m row into 10 units at 6.4 m steps", () => {
    const o = footprintObb(rect(15.5, 64, 0, 100, 50))!;
    const r = fitArchetype(o, spec(), "gable", 8.5, null, "row")!;
    expect(r).toHaveLength(10);
    for (const p of r) expect(p.sx).toBeCloseTo(1, 3);
    const xs = r.map((p) => p.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeCloseTo(6.4, 3);
    expect((xs[0]! + xs[9]!) / 2).toBeCloseTo(100, 3);
    expect(r.every((p) => Math.abs(p.z - 50) < 1e-6)).toBe(true);
    // units differ in palette
    expect(new Set(r.map((p) => p.palette.join())).size).toBeGreaterThan(1);
  });
  it("makes 3 units of a ragged 20 m row", () => {
    const r = fitArchetype(obbOf(15.5, 20), spec(), "gable", 8.5, null, "rag")!;
    expect(r).toHaveLength(3);
    expect(r[0]!.sx).toBeCloseTo(20 / 19.2, 3);
  });
  it("refuses a depth of 40 m (sz 2.6)", () => {
    expect(fitArchetype(obbOf(6.4, 40), spec(), "gable", 8.5, null, "deep")).toBeNull();
  });
  it("refuses a 30 m tall house (sy 3.5)", () => {
    expect(fitArchetype(obbOf(6.4, 15.5), spec(), "gable", 30, null, "tall")).toBeNull();
  });
  it("refuses generic below 0.85 fill via minFill", () => {
    const o = { ...obbOf(6.4, 15.5), fill: 0.8 };
    expect(
      fitArchetype(o, spec(), "gable", 8.5, null, "g", "default", { minFill: 0.85 }),
    ).toBeNull();
    expect(fitArchetype(o, spec(), "gable", 8.5, null, "g")).not.toBeNull();
  });
  it("is deterministic when the front is unknown", () => {
    const o = obbOf(6.4, 15.5, 37);
    const a = fitArchetype(o, spec(), "gable", 8.5, null, "same")![0]!.yaw;
    const b = fitArchetype(o, spec(), "gable", 8.5, null, "same")![0]!.yaw;
    expect(a).toBe(b);
  });
  it("faces the frontage normal when the front is unknown", () => {
    // long axis along x, frontage = short side, so +z (model) must map to +-x ... normal of short side is the long axis
    const r = fitArchetype(obbOf(6.4, 15.5, 0), spec(), "gable", 8.5, null, "n")![0]!;
    const nx = Math.sin(r.yaw);
    const nz = Math.cos(r.yaw);
    expect(Math.abs(nx)).toBeCloseTo(1, 6);
    expect(nz).toBeCloseTo(0, 6);
  });
  it("uses the given front azimuth", () => {
    const r = fitArchetype(obbOf(6.4, 15.5, 0), spec(), "gable", 8.5, 90, "f")![0]!;
    expect(r.yaw).toBeCloseTo(Math.PI / 2, 9);
  });
  it("snaps yaw to the box normal facing front_deg 100", () => {
    const r = fitArchetype(obbOf(6.4, 15.5, 0), spec(), "gable", 8.5, 100, "f")![0]!;
    expect(Math.sin(r.yaw)).toBeCloseTo(1, 9);
    expect(Math.cos(r.yaw)).toBeCloseTo(0, 9);
    const w = fitArchetype(obbOf(6.4, 15.5, 0), spec(), "gable", 8.5, 260, "f")![0]!;
    expect(Math.sin(w.yaw)).toBeCloseTo(-1, 9);
  });
});

describe("fitArchetype shallow-front swap", () => {
  it("fits a narrow plot facing a long wall as one unit with the front on the short wall", () => {
    // long axis along x; front_deg 20 faces the long wall (+z side) but is nearer +x than -x
    const r = fitArchetype(obbOf(6.4, 15.5, 0), spec(), "gable", 8.5, 20, "sw");
    expect(r).toHaveLength(1);
    expect(r![0]!.sx).toBeCloseTo(1, 2);
    expect(r![0]!.sz).toBeCloseTo(1, 2);
    expect(Math.sin(r![0]!.yaw)).toBeCloseTo(1, 9);
    expect(Math.cos(r![0]!.yaw)).toBeCloseTo(0, 9);
    const w = fitArchetype(obbOf(6.4, 15.5, 0), spec(), "gable", 8.5, 200, "sw")!;
    expect(Math.sin(w[0]!.yaw)).toBeCloseTo(-1, 9);
  });
  it("is unchanged when front_deg already faces a short wall", () => {
    const r = fitArchetype(obbOf(6.4, 15.5, 0), spec(), "gable", 8.5, 90, "f")!;
    expect(r).toHaveLength(1);
    expect(r[0]!.yaw).toBeCloseTo(Math.PI / 2, 9);
    expect(r[0]!.sx).toBeCloseTo(1, 2);
  });
  it("does not rescue a 6.4 x 40 m footprint", () => {
    expect(fitArchetype(obbOf(6.4, 40, 0), spec(), "gable", 8.5, 20, "deep")).toBeNull();
  });
  it("does not swap a non-frontage archetype", () => {
    const s = spec({ repeat: "none" as AssetSpec["repeat"] });
    expect(fitArchetype(obbOf(6.4, 15.5, 0), s, "gable", 8.5, 20, "nf")).toBeNull();
  });
});

describe("yawForFront", () => {
  it("maps azimuths to yaw", () => {
    expect(yawForFront(180)).toBeCloseTo(0, 12);
    expect(yawForFront(0)).toBeCloseTo(Math.PI, 12);
    const y = yawForFront(90);
    expect([Math.sin(y), Math.cos(y)]).toEqual([expect.closeTo(1, 9), expect.closeTo(0, 9)]);
  });
});

describe("groups, variants and palettes", () => {
  const groups: [string, string][] = [
    ["valley", "elmina valley"],
    ["lakeside", "lakeside"],
  ];
  it("resolves precinct groups case-insensitively, first match wins", () => {
    expect(precinctGroupOf("Elmina Valley 1", groups)).toBe("valley");
    expect(precinctGroupOf("Lakeside Residences", groups)).toBe("lakeside");
    expect(precinctGroupOf(undefined, groups)).toBe("default");
    expect(precinctGroupOf("Nowhere", groups)).toBe("default");
  });
  it("hash01 is in [0,1) and stable", () => {
    expect(hash01("a")).toBe(hash01("a"));
    expect(hash01("a")).toBeGreaterThanOrEqual(0);
    expect(hash01("a")).toBeLessThan(1);
    expect(hash01("a", "x")).not.toBe(hash01("a", "y"));
  });
  it("picks palettes deterministically from the group list, else default", () => {
    const s = spec();
    expect(paletteFor(s, "valley", "x")).toEqual(s.palettes.valley![0]);
    expect(paletteFor(s, "valley", "x")).toEqual(paletteFor(s, "valley", "x"));
    expect(PAL).toContainEqual(paletteFor(s, "nothing", "x"));
  });
  it("maps variants by group, then default", () => {
    const s = spec();
    expect(variantFor(s, "valley", 8.5)).toBe("modern");
    expect(variantFor(s, "other", 8.5)).toBe("gable");
  });
  it("chooses the highrise variant nearest the building height", () => {
    const hi = spec({
      variantByGroup: { default: "mid" },
      variants: {
        mid: { size: [20, 45, 20], lods: [{ node: "m", tris: 1, maxM: null }] },
        tall: { size: [20, 95, 20], lods: [{ node: "t", tris: 1, maxM: null }] },
      },
    });
    expect(variantFor(hi, "default", 95)).toBe("tall");
    expect(variantFor(hi, "default", 45)).toBe("mid");
  });
});

describe("jitterFor", () => {
  it("keeps people inside 1.6-1.7 m and the scale inside the band", () => {
    const person = spec({ jitter: { scale: 0.03 } });
    for (let i = 0; i < 1000; i++) {
      const j = jitterFor(person, `p${i}`);
      expect(j.scale).toBeGreaterThanOrEqual(0.97);
      expect(j.scale).toBeLessThanOrEqual(1.03);
      const h = 1.65 * j.scale;
      expect(h).toBeGreaterThanOrEqual(1.6);
      expect(h).toBeLessThanOrEqual(1.7);
    }
  });
  it("does nothing without jitter", () => {
    expect(jitterFor(spec(), "q")).toEqual({ scale: 1, hueShift: 0 });
  });
});
