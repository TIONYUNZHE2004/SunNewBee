export const FLOOR_M = 3.2;
export const COL_M = 3.5;

export type Tone = "t0" | "t1" | "t2" | "t3" | "t4" | "t5";
export const TONE_LIST: Tone[] = ["t0", "t1", "t2", "t3", "t4", "t5"];
export type WindowStyle = "grid" | "strip" | "curtain";
export const STYLE_LIST: WindowStyle[] = ["grid", "strip", "curtain"];

/** Facade pattern: curtain glass on towers, strip windows on shops and offices, else a grid. */
export function windowStyleFor(kind: string, floors: number): WindowStyle {
  if (floors >= 12) return "curtain";
  if (/^(commercial|office|retail)$/.test(kind)) return "strip";
  return "grid";
}

export interface Building {
  id: string;
  ring: [number, number][];
  height: number;
  minHeight: number;
  kind: string;
  tone: Tone;
  style: WindowStyle;
  floors: number;
  perimeterM: number;
  cols: number;
  litSeed: number;
}

const FLOOR_BINS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 40];
const COL_BINS = [8, 12, 16, 24, 32, 48, 64, 128];
const M_PER_DEG = 111_320;

/**
 * FNV-1a 32-bit of `${salt}:${id}` with a murmur3 finaliser, scaled to [0,1). Deterministic.
 * The finaliser matters: plain FNV-1a barely moves the high bits when only the last character
 * changes, so sequential keys (`street:1`, `street:2`, ...) all landed near the same value.
 */
export function hashUnit(id: string, salt = ""): number {
  const s = `${salt}:${id}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 2 ** 32;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function outerRing(geom: unknown): [number, number][] | null {
  if (!isRec(geom) || geom.type !== "Polygon" || !Array.isArray(geom.coordinates)) return null;
  const ring = geom.coordinates[0];
  if (!Array.isArray(ring)) return null;
  const out: [number, number][] = [];
  for (const p of ring) {
    if (!Array.isArray(p)) return null;
    const x = p[0];
    const y = p[1];
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    )
      return null;
    out.push([x, y]);
  }
  if (new Set(out.map((p) => `${p[0]},${p[1]}`)).size < 3) return null;
  return out;
}

function ringPerimeterM(ring: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[i + 1]!;
    const k = Math.cos((((y1 + y2) / 2) * Math.PI) / 180);
    sum += Math.hypot((x2 - x1) * k * M_PER_DEG, (y2 - y1) * M_PER_DEG);
  }
  return sum;
}

export function toBuildings(fc: unknown): { buildings: Building[]; skipped: number } {
  const buildings: Building[] = [];
  let skipped = 0;
  const features = isRec(fc) && Array.isArray(fc.features) ? fc.features : [];
  features.forEach((feat: unknown, i: number) => {
    const ring = isRec(feat) ? outerRing(feat.geometry) : null;
    if (!isRec(feat) || !ring) {
      skipped++;
      return;
    }
    const props = isRec(feat.properties) ? feat.properties : {};
    const id = String(props.id ?? feat.id ?? `b${i}`);
    const h = props.height_m;
    const height = typeof h === "number" && Number.isFinite(h) && h > 0 ? h : 9;
    const mh = props.min_height_m;
    const minHeight =
      typeof mh === "number" && Number.isFinite(mh) ? clamp(mh, 0, height * 0.9) : 0;
    const perimeterM = ringPerimeterM(ring);
    const kind = typeof props.kind === "string" ? props.kind : "building";
    const floors = clamp(Math.round((height - minHeight) / FLOOR_M), 1, 40);
    buildings.push({
      id,
      ring,
      height,
      minHeight,
      kind,
      tone: TONE_LIST[Math.min(5, Math.floor(hashUnit(id, "tone") * 6))]!,
      style: windowStyleFor(kind, floors),
      floors,
      perimeterM,
      cols: clamp(Math.round(perimeterM / COL_M), 4, 128),
      litSeed: hashUnit(id, "lit"),
    });
  });
  return { buildings, skipped };
}

const binUp = (v: number, bins: number[]) => bins.find((b) => b >= v) ?? bins[bins.length - 1]!;

export function classKey(b: Building): string {
  return `${binUp(b.floors, FLOOR_BINS)}x${binUp(b.cols, COL_BINS)}`;
}

export function groupByClass(bs: Building[]): Map<string, Building[]> {
  const m = new Map<string, Building[]>();
  for (const b of bs) {
    const k = classKey(b);
    const g = m.get(k);
    if (g) g.push(b);
    else m.set(k, [b]);
  }
  return m;
}

type TreePoint = { id: string; lon: number; lat: number; h: number; tier2: boolean };
export function treesToPoints(fc: unknown): TreePoint[] {
  const out: TreePoint[] = [];
  const features = isRec(fc) && Array.isArray(fc.features) ? fc.features : [];
  features.forEach((feat: unknown, i: number) => {
    if (!isRec(feat) || !isRec(feat.geometry) || feat.geometry.type !== "Point") return;
    const c = feat.geometry.coordinates;
    if (!Array.isArray(c)) return;
    const [lon, lat] = c;
    if (typeof lon !== "number" || typeof lat !== "number") return;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    const props = isRec(feat.properties) ? feat.properties : {};
    const id = String(props.id ?? feat.id ?? `t${i}`);
    const h = props.height_m;
    out.push({
      id,
      lon,
      lat,
      h: typeof h === "number" && Number.isFinite(h) && h > 0 ? h : 4 + hashUnit(id, "th") * 4,
      tier2: hashUnit(id, "t2") < 0.5,
    });
  });
  return out;
}

function inRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function scatterTrees(
  parks: [number, number][][],
  seed: string,
  perHa: number,
): { lon: number; lat: number; h: number }[] {
  const out: { lon: number; lat: number; h: number }[] = [];
  parks.forEach((ring, pi) => {
    if (ring.length < 3 || !ring.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])))
      return;
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
    const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
    // Shoelace area in square metres.
    let a2 = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      a2 += ring[j]![0] * k * ring[i]![1] - ring[i]![0] * k * ring[j]![1];
    }
    const ha = (Math.abs(a2 / 2) * M_PER_DEG * M_PER_DEG) / 10_000;
    const target = Math.floor(ha * perHa);
    let placed = 0;
    for (let n = 0; placed < target && n < target * 10 + 10; n++) {
      const key = `${seed}:${pi}:${n}`;
      const x = x0 + hashUnit(key, "x") * (x1 - x0);
      const y = y0 + hashUnit(key, "y") * (y1 - y0);
      if (!inRing(x, y, ring)) continue;
      out.push({ lon: x, lat: y, h: 4 + hashUnit(key, "h") * 4 });
      placed++;
    }
  });
  return out;
}
