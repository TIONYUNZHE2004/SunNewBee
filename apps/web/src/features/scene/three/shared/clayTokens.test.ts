import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { ROUTE_STYLE, statusStyle, WATER_COLOR } from "../../styles";
import { readsAsWater } from "../colourHue";
import {
  applyClayTier,
  CLAY,
  CLAY_PALETTE,
  type ClayRole,
  clayMaterial,
  clayTier,
  EFFECT_COLOURS,
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
    expect(CLAY_PALETTE.park).toBe("#a3d273");
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
