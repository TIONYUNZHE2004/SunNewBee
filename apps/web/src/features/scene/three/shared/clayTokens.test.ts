import { readFileSync } from "node:fs";
import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { ROUTE_STYLE, statusStyle, WATER_COLOR } from "../../styles";
import { parseManifest } from "../assets/manifest";
import { readsAsWater } from "../colourHue";
import {
  applyClayTier,
  CLAY,
  CLAY_MIN_LIGHTNESS,
  CLAY_MIN_LUMINANCE,
  CLAY_PALETTE,
  type ClayRole,
  clayMaterial,
  clayPalette,
  clayTier,
  EFFECT_COLOURS,
  setClayStandardOnly,
  setClayTier,
  wallAndRoofColours,
} from "./clayTokens";

const HEX = /^#[0-9a-f]{6}$/;
const roles = Object.keys(CLAY) as ClayRole[];
const luminance = (hex: string): number => {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};

afterEach(() => setClayTier("high"));

describe("AC-B1: clay token table ranges", () => {
  it("has the surface roles the layers use", () => {
    for (const r of ["wall", "roof", "ground", "road", "park", "water", "slab", "prop", "person"])
      expect(roles).toContain(r);
  });

  it("every role: roughness 0.6-0.8, sheen > 0, sheenRoughness 0-1, lower-case #rrggbb colours", () => {
    for (const r of roles) {
      const tok = CLAY[r];
      expect(tok.roughness, r).toBeGreaterThanOrEqual(0.6);
      expect(tok.roughness, r).toBeLessThanOrEqual(0.8);
      expect(tok.sheen, r).toBeGreaterThan(0);
      expect(tok.sheen, r).toBeLessThanOrEqual(1);
      expect(tok.sheenRoughness, r).toBeGreaterThan(0);
      expect(tok.sheenRoughness, r).toBeLessThanOrEqual(1);
      expect(tok.sheenColor, r).toMatch(HEX);
      expect(tok.colours.length, r).toBeGreaterThan(0);
      for (const c of tok.colours) expect(c, r).toMatch(HEX);
    }
  });

  it("metalness is 0 except on prop roles, and only metal / propMetal have any", () => {
    const metallic = roles.filter((r) => CLAY[r].metalness > 0);
    expect(metallic.sort()).toEqual(["metal", "propMetal"]);
    for (const r of metallic) {
      expect(CLAY[r].prop, r).toBe(true);
      expect(CLAY[r].metalness, r).toBeLessThanOrEqual(0.5);
    }
  });

  it("pastel: wall, roof, ground, park and deck colours are light (HSL lightness >= 0.4)", () => {
    const hsl = { h: 0, s: 0, l: 0 };
    for (const r of ["wall", "ground", "park", "deck", "marking"] as const)
      for (const c of CLAY[r].colours) {
        new THREE.Color().setStyle(c, THREE.SRGBColorSpace).getHSL(hsl, THREE.SRGBColorSpace);
        expect(hsl.l, `${r} ${c}`).toBeGreaterThanOrEqual(0.4);
      }
  });

  it("the main surfaces carry the prototype's clay values (roughness ~0.7, sheen ~0.35)", () => {
    expect(CLAY.wall.roughness).toBe(0.7);
    expect(CLAY.wall.sheen).toBe(0.35);
    expect(CLAY_PALETTE.slab).toEqual(["#ddd6b6", "#a87a4f", "#8b5f3c", "#c69c6d"]);
    expect(CLAY_PALETTE.road.footway).toBe("#f2dbb2");
  });
});

describe("AC-B1 honesty guards on the token table", () => {
  it("no wall, roof or deck token reads as water (A-T9 guard extended)", () => {
    const bad = wallAndRoofColours().filter((c) => readsAsWater(c, CLAY_PALETTE.baseWater));
    expect(bad).toEqual([]);
  });

  it("base water is the decorative blue, never the flood blue; land-cover water is the same", () => {
    expect(CLAY_PALETTE.baseWater).toBe("#7fb6c9");
    expect(CLAY_PALETTE.landcover.water).toBe(CLAY_PALETTE.baseWater);
    expect(CLAY.water.colours).toEqual([CLAY_PALETTE.baseWater]);
    expect(CLAY_PALETTE.baseWater.toLowerCase()).not.toBe(WATER_COLOR.toLowerCase());
  });

  it("no clay or effect colour equals a data colour (flood, status, route)", () => {
    const data = new Set(
      [
        WATER_COLOR,
        ROUTE_STYLE.color,
        ...(["ok", "unknown", "blocked", "flooded_likely", "flooded_possible"] as const).map(
          (s) => statusStyle(s).color,
        ),
      ].map((c) => c.toLowerCase()),
    );
    const all = [...roles.flatMap((r) => CLAY[r].colours), ...Object.values(EFFECT_COLOURS)];
    expect(all.filter((c) => data.has(c.toLowerCase()))).toEqual([]);
  });

  it("every fixed archetype role colour is >= 0.08 luminance (AC-A9)", () => {
    for (const [k, c] of Object.entries(CLAY_PALETTE.fixedRole))
      expect(luminance(c), `${k} ${c}`).toBeGreaterThanOrEqual(0.08);
  });

  it("no wall, roof, ground or road token is near black (< 0.08 luminance)", () => {
    for (const r of ["wall", "roof", "ground", "road", "slab", "deck", "park"] as const)
      for (const c of CLAY[r].colours)
        expect(luminance(c), `${r} ${c}`).toBeGreaterThanOrEqual(0.08);
  });
});

describe("clayMaterial factory and quality tiering", () => {
  it("High: MeshPhysicalMaterial with the role's sheen, roughness and metalness", () => {
    const m = clayMaterial("wall", { tier: "high" });
    expect(m).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    const p = m as THREE.MeshPhysicalMaterial;
    expect(p.sheen).toBe(CLAY.wall.sheen);
    expect(p.sheenRoughness).toBe(CLAY.wall.sheenRoughness);
    expect(p.roughness).toBe(CLAY.wall.roughness);
    expect(p.metalness).toBe(0);
    expect(p.color.getHexString()).toBe(CLAY.wall.colours[0]!.slice(1));
    expect(m.userData.clayRole).toBe("wall");
  });

  it("Medium and Low degrade to MeshStandardMaterial (no sheen), same roughness / metalness", () => {
    for (const tier of ["medium", "low"] as const) {
      const m = clayMaterial("propMetal", { tier });
      expect(m).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect(m).not.toBeInstanceOf(THREE.MeshPhysicalMaterial);
      expect(m.roughness).toBe(CLAY.propMetal.roughness);
      expect(m.metalness).toBe(CLAY.propMetal.metalness);
    }
  });

  it("uses the module tier by default (set by the engine)", () => {
    expect(clayTier()).toBe("high");
    setClayTier("medium");
    expect(clayMaterial("roof")).not.toBeInstanceOf(THREE.MeshPhysicalMaterial);
    setClayTier("high");
    expect(clayMaterial("roof")).toBeInstanceOf(THREE.MeshPhysicalMaterial);
  });

  it("vertexColors defaults the base colour to white; an explicit colour wins", () => {
    expect(clayMaterial("ground", { vertexColors: true }).color.getHexString()).toBe("ffffff");
    expect(clayMaterial("water", { color: CLAY_PALETTE.baseWater }).color.getHexString()).toBe(
      "7fb6c9",
    );
  });

  it("passes other parameters through (polygon offset)", () => {
    const m = clayMaterial("ground", { polygonOffset: true, polygonOffsetFactor: -2 });
    expect(m.polygonOffset).toBe(true);
    expect(m.polygonOffsetFactor).toBe(-2);
  });

  it("applyClayTier drops sheen below High and restores it on High", () => {
    const root = new THREE.Group();
    const m = clayMaterial("wall", { tier: "high" }) as THREE.MeshPhysicalMaterial;
    const plain = new THREE.MeshStandardMaterial();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), m), new THREE.Mesh(undefined, plain));
    applyClayTier(root, "medium");
    expect(m.sheen).toBe(0);
    applyClayTier(root, "high");
    expect(m.sheen).toBe(CLAY.wall.sheen);
  });
});

const hslOf = (hex: string) =>
  new THREE.Color()
    .setStyle(hex, THREE.SRGBColorSpace)
    .getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);

describe("fix round 1: large-area roles are saturated pastels, not beige", () => {
  it("ground, land cover (not water) and park: saturation 0.25-0.5, lightness 0.6-0.82", () => {
    const large = [
      CLAY_PALETTE.ground,
      CLAY_PALETTE.park,
      CLAY_PALETTE.landcoverUnknown,
      ...Object.entries(CLAY_PALETTE.landcover)
        .filter(([k]) => k !== "water")
        .map(([, v]) => v),
    ];
    for (const c of large) {
      const { s, l } = hslOf(c);
      expect(s, c).toBeGreaterThanOrEqual(0.25);
      expect(s, c).toBeLessThanOrEqual(0.5);
      expect(l, c).toBeGreaterThanOrEqual(0.6);
      expect(l, c).toBeLessThanOrEqual(0.82);
    }
  });

  it("roads: a saturation floor (tinted, not dead grey) and a lightness ceiling (asphalt check)", () => {
    for (const k of ["major", "residential", "other"] as const) {
      const { s, l } = hslOf(CLAY_PALETTE.road[k]);
      expect(s, k).toBeGreaterThanOrEqual(0.06);
      expect(l, k).toBeLessThanOrEqual(0.6);
    }
    const foot = hslOf(CLAY_PALETTE.road.footway);
    expect(foot.s).toBeGreaterThanOrEqual(0.25);
    expect(foot.l).toBeLessThanOrEqual(0.85);
  });

  it("verge / grass greens share the foliage hue family (within 15 deg)", () => {
    const f = hslOf(CLAY_PALETTE.fixedRole.foliage).h * 360;
    for (const c of [CLAY_PALETTE.landcover.grass, CLAY_PALETTE.park]) {
      const d = Math.abs(hslOf(c).h * 360 - f);
      expect(Math.min(d, 360 - d), c).toBeLessThanOrEqual(15);
    }
  });
});

describe("fix round 1: manifest palettes load through the clay table", () => {
  const raw = JSON.parse(
    readFileSync(new URL("../../../../../public/city/manifest.json", import.meta.url), "utf8"),
  );
  const { manifest } = parseManifest(raw);

  it("every loaded palette colour: luminance >= 0.1, pastel lightness, no water hue", () => {
    expect(manifest).not.toBeNull();
    const bad: string[] = [];
    for (const [id, spec] of Object.entries(manifest!.assets))
      for (const [g, list] of Object.entries(spec.palettes))
        for (const trio of list)
          for (const c of trio) {
            if (luminance(c) < CLAY_MIN_LUMINANCE) bad.push(`${id}/${g} ${c} luminance`);
            if (hslOf(c).l < CLAY_MIN_LIGHTNESS - 1e-3) bad.push(`${id}/${g} ${c} lightness`);
            if (readsAsWater(c, CLAY_PALETTE.baseWater)) bad.push(`${id}/${g} ${c} water`);
          }
    expect(bad).toEqual([]);
  });

  it("the trees kit trunk (secondary) snaps to the clay trunk", () => {
    for (const list of Object.values(manifest!.assets.trees!.palettes))
      for (const trio of list) expect(trio[1]).toBe(CLAY_PALETTE.trunk);
  });

  it("grey palette roofs stay grey (large roofs still take a tint); coloured roofs stay coloured", () => {
    const grey = clayPalette(["#ece6da", "#6a6e75", "#b8704f"])[1];
    expect(hslOf(grey).s).toBeLessThanOrEqual(0.12);
    const terracotta = clayPalette(["#efe6d2", "#7a4332", "#9e8a6c"])[1];
    expect(hslOf(terracotta).s).toBeGreaterThanOrEqual(0.2);
    expect(hslOf(terracotta).l).toBeGreaterThanOrEqual(CLAY_MIN_LIGHTNESS - 1e-3);
  });

  it("a near-black or water-blue input is lifted and moved off the water hue", () => {
    const [w, r, a] = clayPalette(["#3d4147", "#7fb6c9", "#1a1a1a"]);
    for (const c of [w, r, a]) {
      expect(luminance(c), c).toBeGreaterThanOrEqual(CLAY_MIN_LUMINANCE);
      expect(readsAsWater(c, CLAY_PALETTE.baseWater), c).toBe(false);
    }
  });
});

describe("fix round 1: standard-only gate switch", () => {
  afterEach(() => setClayStandardOnly("ground", false));
  it("a standardOnly role is standard even on High; others keep sheen", () => {
    expect(CLAY.ground.standardOnly).toBe(false);
    setClayStandardOnly("ground", true);
    expect(clayMaterial("ground", { tier: "high" })).not.toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(clayMaterial("road", { tier: "high" })).toBeInstanceOf(THREE.MeshPhysicalMaterial);
  });
});
