#!/usr/bin/env node
// Cuts the committed ~1 km² Elmina walk extract for the agent U-turn tests (demo polish A1):
// every walk LineString with at least one vertex inside a 1,000 m square centred on the hero
// district (HERO_CENTRE in src/features/scene/three/bookmarks.ts), whole (not clipped), with only
// `id` and `type` kept and coordinates rounded to 7 decimals (~1 cm). Display-test data only.
//
// Run from the repo root: node apps/web/scripts/cut-walk-extract.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const SRC = join(ROOT, "data", "seed", "elmina", "base", "walk.geojson");
const OUT = join(
  HERE,
  "..",
  "src",
  "features",
  "scene",
  "three",
  "motion",
  "fixtures",
  "elmina-hero-walk.json",
);
const CENTRE = [101.5095, 3.1805]; // HERO_CENTRE
const HALF_M = 500;

const RAD = Math.PI / 180;
const mPerDegLat = 110574;
const mPerDegLon = 111320 * Math.cos(CENTRE[1] * RAD);
const inside = ([lon, lat]) =>
  Math.abs((lon - CENTRE[0]) * mPerDegLon) <= HALF_M &&
  Math.abs((lat - CENTRE[1]) * mPerDegLat) <= HALF_M;
const r7 = (v) => Math.round(v * 1e7) / 1e7;

const walk = JSON.parse(readFileSync(SRC, "utf8"));
const features = walk.features
  .filter((f) => f.geometry?.type === "LineString" && f.geometry.coordinates.some(inside))
  .map((f) => ({
    type: "Feature",
    properties: { id: f.properties.id, type: f.properties.type },
    geometry: {
      type: "LineString",
      coordinates: f.geometry.coordinates.map(([lon, lat]) => [r7(lon), r7(lat)]),
    },
  }));
const out = {
  type: "FeatureCollection",
  note: "Cut by apps/web/scripts/cut-walk-extract.mjs from data/seed/elmina/base/walk.geojson (OSM, ODbL): 1 km square around HERO_CENTRE. Agent test fixture only.",
  centre: CENTRE,
  features,
};
writeFileSync(OUT, `${JSON.stringify(out)}\n`);
console.log(`wrote ${features.length} features to ${OUT}`);
