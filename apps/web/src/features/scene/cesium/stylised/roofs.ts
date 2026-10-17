import { cleanRing, isConvex, shrinkRing } from "./buildingsMesh";
import { type Building, hashUnit } from "./model";

export interface RoofItem {
  lon: number;
  lat: number;
  z: number;
  kind: "ac" | "tank";
  sizeM: number;
}

const M_PER_DEG = 111_320;
const RAD = Math.PI / 180;

function areaM2(ring: [number, number][]): number {
  const k = Math.cos(ring[0]![1] * RAD) * M_PER_DEG;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += ring[j]![0] * k * ring[i]![1] * M_PER_DEG - ring[i]![0] * k * ring[j]![1] * M_PER_DEG;
  return Math.abs(a / 2);
}

/** Seeded AC boxes and water tanks on larger convex flat roofs (display only). */
export function roofClutter(
  buildings: Building[],
  seed: string,
  { minAreaM2 = 250, max = 4000 } = {},
): RoofItem[] {
  const out: { v: RoofItem; r: number }[] = [];
  for (const b of buildings) {
    const ring = cleanRing(b.ring);
    if (ring.length < 3 || !isConvex(ring)) continue;
    const area = areaM2(ring);
    if (area < minAreaM2) continue;
    const inner = shrinkRing(ring, 2.5);
    if (inner.length < 3) continue;
    const n = Math.min(4, Math.floor(area / 250));
    for (let i = 0; i < n; i++) {
      const key = `${seed}:${b.id}:${i}`;
      const a = inner[Math.floor(hashUnit(key, "v") * inner.length)]!;
      const c = inner[Math.floor(hashUnit(key, "w") * inner.length)]!;
      const f = hashUnit(key, "f");
      const tank = hashUnit(key, "k") < 0.3;
      out.push({
        r: hashUnit(key, "cap"),
        v: {
          lon: a[0] + (c[0] - a[0]) * f,
          lat: a[1] + (c[1] - a[1]) * f,
          z: b.height,
          kind: tank ? "tank" : "ac",
          sizeM: tank ? 1.6 : 1.1 + hashUnit(key, "s") * 0.6,
        },
      });
    }
  }
  if (out.length <= max) return out.map((o) => o.v);
  return out
    .sort((x, y) => x.r - y.r)
    .slice(0, max)
    .map((o) => o.v);
}
