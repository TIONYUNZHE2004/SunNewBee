import { describe, expect, it } from "vitest";
import { createFrame } from "../frame";
import { buildRoadGraph, roadGraphOf, SNAP_M } from "./roadGraph";

const frame = createFrame([101.5, 3.18]);
const ll = (x: number, z: number) => frame.toLonLat(x, z);
const line = (id: string, type: string, pts: [number, number][]) => ({
  type: "Feature",
  properties: { id, type },
  geometry: { type: "LineString", coordinates: pts.map(([x, z]) => ll(x, z)) },
});
const fc = (...features: unknown[]) => ({ type: "FeatureCollection", features });
const STREETS = new Set(["street", "major_road"]);

describe("buildRoadGraph", () => {
  it(`snaps line ends within ${SNAP_M} m into one node, and no farther`, () => {
    const g = buildRoadGraph(
      fc(
        line("a", "street", [
          [0, 0],
          [100, 0],
        ]),
        // 0.6 m off the end of a: the same node
        line("b", "street", [
          [100.6, 0],
          [100.6, 80],
        ]),
        // 1.6 m off: a node of its own
        line("c", "street", [
          [101.6, 0],
          [180, 0],
        ]),
      ),
      frame,
      STREETS,
    );
    expect(g.edges).toHaveLength(3);
    const [a, b, c] = g.edges;
    expect(a!.b).toBe(b!.a);
    expect(c!.a).not.toBe(a!.b);
    expect(g.degree(a!.b)).toBe(2);
    expect(g.degree(a!.a)).toBe(1);
    expect(g.degree(c!.a)).toBe(1);
  });

  it("keeps only the given types; keys edges by feature id and run", () => {
    const g = buildRoadGraph(
      fc(
        line("s", "street", [
          [0, 0],
          [50, 0],
        ]),
        line("f", "footway", [
          [50, 0],
          [50, 50],
        ]),
      ),
      frame,
      STREETS,
    );
    expect(g.edges.map((e) => e.key)).toEqual(["s:0"]);
    expect(g.byKey.get("s:0")!.width).toBe(6);
  });

  it("next never returns the incoming edge end unless the node has degree 1", () => {
    // A star of four streets at the origin plus a loop and a dead-end spur.
    const g = buildRoadGraph(
      fc(
        line("n", "street", [
          [0, 0],
          [0, -100],
        ]),
        line("e", "street", [
          [0, 0],
          [100, 0],
        ]),
        line("s", "street", [
          [0, 0],
          [0, 100],
        ]),
        line("w", "street", [
          [0, 0],
          [-100, 0],
        ]),
        line("loop", "street", [
          [100, 0],
          [150, 30],
          [150, -30],
          [100, 0],
        ]),
      ),
      frame,
      STREETS,
    );
    const centre = g.edges[0]!.a;
    expect(g.degree(centre)).toBe(4);
    for (const e of g.edges) {
      for (const node of [e.a, e.b]) {
        const arrived: 0 | 1 = e.b === node ? 1 : 0;
        for (let r = 0; r < 1; r += 0.01) {
          const s = g.next(e.id, node, r, { arrived });
          if (g.degree(node) === 1) {
            expect(s).toEqual({ edge: e.id, end: arrived });
          } else {
            expect(s).not.toBeNull();
            expect(s!.edge === e.id && s!.end === arrived).toBe(false);
          }
        }
      }
    }
    // every other edge end is reachable from the centre
    const seen = new Set<number>();
    for (let r = 0; r < 1; r += 0.01)
      seen.add(g.next(g.edges[0]!.id, centre, r, { arrived: 0 })!.edge);
    expect(seen.size).toBe(3);
    // the loop at node "east end" (degree 3: e, and both loop ends) continues round the loop
    const loop = g.byKey.get("loop:0")!;
    const s = g.next(loop.id, loop.b, 0.99, { arrived: 1 });
    expect(s).not.toEqual({ edge: loop.id, end: 1 });
  });

  it("accept filters the choices; null when nothing else is acceptable", () => {
    const g = buildRoadGraph(
      fc(
        line("a", "street", [
          [0, 0],
          [50, 0],
        ]),
        line("b", "major_road", [
          [50, 0],
          [100, 0],
        ]),
      ),
      frame,
      STREETS,
    );
    const a = g.byKey.get("a:0")!;
    expect(
      g.next(a.id, a.b, 0.5, { accept: (s) => g.edges[s.edge]!.type === "street" }),
    ).toBeNull();
    expect(g.next(a.id, a.b, 0.5)!.edge).toBe(g.byKey.get("b:0")!.id);
  });

  it("roadGraphOf builds once per walk layer, frame and type set", () => {
    const walk = fc(
      line("a", "street", [
        [0, 0],
        [50, 0],
      ]),
    );
    expect(roadGraphOf(walk, frame, STREETS)).toBe(
      roadGraphOf(walk, frame, new Set(["major_road", "street"])),
    );
    expect(roadGraphOf(walk, frame, new Set(["footway"]))).not.toBe(
      roadGraphOf(walk, frame, STREETS),
    );
  });
});
