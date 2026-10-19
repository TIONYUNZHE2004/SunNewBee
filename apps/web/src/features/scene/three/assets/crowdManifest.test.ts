import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CROWD_BODIES,
  CROWD_PROPS,
  type CrowdManifest,
  OUTFIT_CATEGORIES,
  parseCrowdManifest,
} from "./crowdManifest";

/** C-T6: the committed crowd manifest meets P1 (bodies) and P2 (local dress, >= 24 looks). */
const url = new URL("../../../../../public/city/characters/crowd.json", import.meta.url);
const { manifest, problems } = parseCrowdManifest(JSON.parse(readFileSync(url, "utf8")));
const m = manifest as CrowdManifest;
const category = (outfit: string) => m.outfits[outfit]?.category;

describe("crowd manifest", () => {
  it("parses without problems and is decorative", () => {
    expect(problems).toEqual([]);
    expect(m.decorative).toBe(true);
    expect(m.note).toBe("Decorative details are illustrative.");
  });

  it("P1: the six base bodies, with distinct proportions", () => {
    expect(Object.keys(m.bodies).sort()).toEqual([...CROWD_BODIES].sort());
    const b = m.bodies;
    expect(b.child.height).toBeLessThan(b.school_age.height);
    expect(b.school_age.height).toBeLessThan(b.adult_woman.height);
    expect(b.child.headRatio).toBeLessThan(b.adult_man.headRatio);
    expect(b.older_man.stoopDeg).toBeGreaterThan(0);
    expect(b.older_woman.stoopDeg).toBeGreaterThan(0);
    expect(b.adult_man.stoopDeg).toBe(0);
  });

  it("P2: every body has >= 3 outfits, all used by looks", () => {
    for (const body of CROWD_BODIES) {
      const outfits = new Set(m.looks.filter((l) => l.body === body).map((l) => l.outfit));
      expect(outfits.size, body).toBeGreaterThanOrEqual(3);
      expect([...outfits].sort(), body).toEqual([...m.bodies[body].outfits].sort());
    }
  });

  it("P2: local dress categories, with their headwear", () => {
    const cats = new Set(m.looks.map((l) => category(l.outfit)));
    for (const c of OUTFIT_CATEGORIES) expect(cats.has(c), c).toBe(true);
    for (const [id, o] of Object.entries(m.outfits)) {
      if (o.category === "baju_kurung" || o.category === "school_pinafore")
        expect(o.headwear, id).toBe("tudung");
      if (o.category === "baju_melayu") expect(o.headwear, id).toBe("songkok");
    }
  });

  it("P2: >= 24 distinct looks, props counted as distinct", () => {
    expect(m.looks.length).toBeGreaterThanOrEqual(24);
    expect(new Set(m.looks.map((l) => l.id)).size).toBe(m.looks.length);
    const keys = m.looks.map((l) => JSON.stringify([l.body, l.outfit, l.prop, l.palette]));
    expect(new Set(keys).size).toBe(m.looks.length);
    const triples = new Set(m.looks.map((l) => JSON.stringify([l.body, l.outfit, l.prop])));
    expect(triples.size).toBeGreaterThanOrEqual(24); // distinct without counting palettes
    const props = new Set(m.looks.map((l) => l.prop).filter(Boolean));
    expect([...props].sort()).toEqual([...CROWD_PROPS].sort());
  });

  it("clips document their key rate for the baker", () => {
    for (const b of CROWD_BODIES)
      for (const [name, c] of Object.entries(m.bodies[b].clips)) {
        expect(c.keyFps, name).toBe(name.startsWith("idle") ? 10 : 30);
        expect(c.keys, name).toBe(Math.round(c.duration * c.keyFps) + 1);
        expect(c.frames, name).toBe(Math.round(c.duration * 30) + 1);
      }
  });

  it("looks use their prop's clips and meshes", () => {
    for (const l of m.looks) {
      expect(l.clips.walk, l.id).toBe(l.prop ? `walk_${l.prop}` : "walk");
      expect(l.clips.idle, l.id).toBe(l.prop ? `idle_${l.prop}` : "idle");
      expect(l.propMeshes.length > 0, l.id).toBe(l.prop !== null);
    }
  });
});
