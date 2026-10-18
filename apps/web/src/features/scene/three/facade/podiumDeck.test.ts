import { describe, expect, it } from "vitest";
import { DECK_POOL_COLOUR, POOL_LIFT_M, podiumDeck } from "./podiumDeck";

type Pt = [number, number];
/** The Kanopi podium (OSM w1545153991) and its traced tower plate, in local metres (seed shape). */
const podium: Pt[] = [
  [19.3, 15.7],
  [49.6, 60.4],
  [147.4, -5.1],
  [117.2, -49.6],
];
const tower: Pt[] = [
  [14.7, 4.0],
  [28.5, 28.2],
  [61.9, 4.3],
  [100.1, -23.3],
  [83.5, -45.4],
];
const H = 8.71;

function inside(ring: Pt[], x: number, z: number) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!;
    const [xj, zj] = ring[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
function edgeDist(ring: Pt[], x: number, z: number) {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i]!;
    const [bx, bz] = ring[(i + 1) % ring.length]!;
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
}
const mats = (a: Float32Array) =>
  Array.from({ length: a.length / 16 }, (_, i) => Array.from(a.slice(i * 16, i * 16 + 16)));
/** The four footprint corners of a unit box / plane matrix. */
const corners = (m: number[]): Pt[] =>
  (
    [
      [-0.5, -0.5],
      [0.5, -0.5],
      [-0.5, 0.5],
      [0.5, 0.5],
    ] as const
  ).map(([sx, sz]) => [m[0]! * sx + m[8]! * sz + m[12]!, m[2]! * sx + m[10]! * sz + m[14]!]);

describe("podiumDeck (ruling P4-M: Kanopi's podium roof)", () => {
  const deck = podiumDeck({ id: "w1545153991", ring: podium, heightM: H }, [tower])!;

  it("has planter boxes, a raised pool and a pergola", () => {
    expect(deck).not.toBeNull();
    expect(deck.parts.planters).toBeGreaterThanOrEqual(6);
    expect(deck.parts.pergola).toBeGreaterThanOrEqual(4);
    expect(deck.pool.length).toBe(16);
    expect(deck.colours.length / 3).toBe(deck.boxes.length / 16);
    expect(DECK_POOL_COLOUR).toBe("#7fb6c9");
  });

  it("puts the pool plane 1.2 m above the podium roof and everything on the roof", () => {
    expect(mats(deck.pool)[0]![13]).toBeCloseTo(H + POOL_LIFT_M, 6);
    expect(POOL_LIFT_M).toBe(1.2);
    for (const m of mats(deck.boxes)) expect(m[13]).toBeGreaterThanOrEqual(H - 1e-6);
  });

  it("keeps every item on the podium, 1.0 m clear of its edge, and off the tower plate", () => {
    for (const m of [...mats(deck.boxes), ...mats(deck.pool)])
      for (const [x, z] of corners(m)) {
        expect(inside(podium, x, z)).toBe(true);
        expect(edgeDist(podium, x, z)).toBeGreaterThanOrEqual(1.0 - 1e-6);
        expect(inside(tower, x, z)).toBe(false);
        expect(edgeDist(tower, x, z)).toBeGreaterThanOrEqual(1.5 - 1e-6);
      }
  });

  it("is deterministic and empty when the roof has no room", () => {
    const again = podiumDeck({ id: "w1545153991", ring: podium, heightM: H }, [tower])!;
    expect(Array.from(again.boxes)).toEqual(Array.from(deck.boxes));
    expect(Array.from(again.pool)).toEqual(Array.from(deck.pool));
    const tiny: Pt[] = [
      [0, 0],
      [6, 0],
      [6, 4],
      [0, 4],
    ];
    expect(podiumDeck({ id: "t", ring: tiny, heightM: 5 }, [])).toBeNull();
    expect(podiumDeck({ id: "t", ring: [], heightM: 5 }, [])).toBeNull();
  });
});
