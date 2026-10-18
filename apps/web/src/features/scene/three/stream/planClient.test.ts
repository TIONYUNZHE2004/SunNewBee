import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuildingsLayer } from "../../../../lib/api";
import { parseManifest } from "../assets/manifest";
import type { FacadeBuilding } from "../facade/facadeLayer";
import { createFrame } from "../frame";
import { createPlanClient, Superseded } from "./planClient";
import type { TileContent } from "./streamer";
import {
  bucketFacades,
  fromWire,
  NO_FACADES,
  type PlanReply,
  type PlanRequest,
  packReply,
  planTile,
  type TileInputs,
  tileFromKey,
  toWire,
} from "./tilePlan";
import { tileAt } from "./tiles";

const manifest = parseManifest(
  JSON.parse(
    readFileSync(new URL("../../../../../public/city/manifest.json", import.meta.url), "utf8"),
  ),
).manifest!;
const frame = createFrame([101.6, 3.3]);
const ll = (x: number, z: number) => frame.toLonLat(x, z);
const fc = (...features: unknown[]) => ({ type: "FeatureCollection", features });
const line = (id: string, type: string, pts: [number, number][]) => ({
  type: "Feature",
  properties: { id, type },
  geometry: { type: "LineString", coordinates: pts.map(([x, z]) => ll(x, z)) },
});
const rect = (x0: number, z0: number, w: number, d: number) => [
  [ll(x0, z0), ll(x0 + w, z0), ll(x0 + w, z0 + d), ll(x0, z0 + d), ll(x0, z0)],
];
const walk = fc(
  ...[20, 60, 100, 140, 180, 220].map((z) =>
    line(`s${z}`, "street", [
      [5, z],
      [495, z],
    ]),
  ),
  line("m1", "major_road", [
    [125, 5],
    [125, 245],
  ]),
);
const buildings = {
  attribution: [],
  buildings: fc({
    type: "Feature",
    properties: { id: "b1", height_m: 12, kind: "retail" },
    geometry: { type: "Polygon", coordinates: rect(40, 30, 20, 10) },
  }),
  parks: fc(),
  water: fc(),
  trees: fc(),
  landcover: fc({
    type: "Feature",
    properties: { id: "lc1", class: "parking" },
    geometry: { type: "Polygon", coordinates: rect(150, 150, 60, 40) },
  }),
  signage: fc({
    type: "Feature",
    properties: {
      id: "sg1",
      text: "Central Mart",
      building_id: "b1",
      source_url: "https://www.openstreetmap.org/way/1",
      source_label: "OpenStreetMap",
      as_of: "2026-10-17",
    },
    geometry: { type: "Point", coordinates: ll(50, 35) },
  }),
} as unknown as BuildingsLayer;
const facade: FacadeBuilding = {
  ring: [
    [40, 30],
    [50, 30],
    [50, 40],
    [40, 40],
  ],
  heightM: 9.6,
  minHeightM: 0,
  spec: {
    buildingId: "f1",
    storeys: 3,
    windowStyle: 0,
    bayM: 3.2,
    groundFloor: "plain",
    palette: { wall: "#ffffff", roof: "#3d4147", trim: "#cccccc" } as never,
  },
};
const inputs: TileInputs = {
  frame,
  walk,
  buildings,
  manifest,
  facades: bucketFacades([facade]),
};
const t00 = tileAt(10, 10);
const t10 = tileAt(260, 10);

/**
 * A fake module Worker: records posts; `answer()` plans the oldest unanswered `plan` with the real
 * wire path (the `init` inputs through a structured clone, `planTile`, `packReply`, another clone).
 */
class FakeWorker {
  onmessage: ((e: MessageEvent<PlanReply>) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  posted: PlanRequest[] = [];
  terminated = false;
  private inputs: TileInputs | null = null;
  private answered = 0;
  postMessage(m: PlanRequest) {
    const copy = structuredClone(m);
    if (copy.type === "init") this.inputs = fromWire(copy.inputs);
    this.posted.push(copy);
  }
  terminate() {
    this.terminated = true;
  }
  plans() {
    return this.posted.filter((m) => m.type === "plan");
  }
  answer() {
    const m = this.plans()[this.answered++];
    if (!m || m.type !== "plan" || !this.inputs) throw new Error("nothing to answer");
    const c = planTile(this.inputs, tileFromKey(m.key), m.ring, m.tier);
    const { reply, transfer } = packReply(m.seq, c, 1);
    this.onmessage?.({ data: structuredClone(reply, { transfer }) } as MessageEvent<PlanReply>);
  }
  fail() {
    this.onerror?.(new Event("error"));
  }
}
const fake = () => {
  const w = new FakeWorker();
  return { w, make: () => w as unknown as Worker };
};
const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createPlanClient (Worker protocol)", () => {
  it("posts the inputs once as init (frame as its origin), then one plan at a time", async () => {
    const { w, make } = fake();
    const c = createPlanClient(inputs, { worker: make });
    expect(c.mode).toBe("worker");
    expect(w.posted[0]?.type).toBe("init");
    const init = w.posted[0] as Extract<PlanRequest, { type: "init" }>;
    expect(init.inputs.origin).toEqual(frame.origin);
    const p1 = c.plan(t00, 0, "medium");
    expect(w.plans()).toHaveLength(1);
    expect(w.plans()[0]).toMatchObject({ type: "plan", key: "0,0", ring: 0, tier: "medium" });
    w.answer();
    const content = await p1;
    expect(content.ribbons.length).toBeGreaterThan(0);
    // The facade list is the inputs' own (identity kept for the facade layer), not a copy.
    expect(content.facades).toBe(inputs.facades?.get("0,0"));
    const p2 = c.plan(t10, 1, "medium");
    expect(w.plans()).toHaveLength(2);
    c.dispose();
    expect(w.terminated).toBe(true);
    await expect(p2).rejects.toBeInstanceOf(Superseded);
  });

  it("keeps at most one plan in flight: a newer request supersedes a waiting one, whose late result is dropped", async () => {
    const { w, make } = fake();
    const c = createPlanClient(inputs, { worker: make });
    const p1 = c.plan(t00, 0, "medium");
    const p2 = c.plan(t10, 0, "medium");
    const p3 = c.plan(t10, 1, "medium");
    // Still one posted plan: p1's. p1 and p2 are superseded at once.
    expect(w.plans()).toHaveLength(1);
    await expect(p1).rejects.toBeInstanceOf(Superseded);
    await expect(p2).rejects.toBeInstanceOf(Superseded);
    const got = vi.fn();
    p3.then(got);
    w.answer(); // p1's late result: dropped; then p3 is posted
    await settle();
    expect(got).not.toHaveBeenCalled();
    expect(w.plans()).toHaveLength(2);
    expect(w.plans()[1]).toMatchObject({ key: "1,0", ring: 1 });
    w.answer();
    await settle();
    expect(got).toHaveBeenCalledTimes(1);
  });

  it("a Worker error switches the session to main and the pending tile completes there", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { w, make } = fake();
    const c = createPlanClient(inputs, { worker: make });
    const p = c.plan(t00, 0, "medium");
    w.fail();
    expect(c.mode).toBe("main");
    expect(w.terminated).toBe(true);
    const content = await p;
    expect(content).toEqual(planTile(inputs, t00, 0, "medium"));
    // Later plans stay on the main thread.
    await expect(c.plan(t10, 0, "medium")).resolves.toBeDefined();
    expect(w.plans()).toHaveLength(1);
  });

  it("main mode without Worker, or when construction throws", async () => {
    const none = createPlanClient(inputs, { worker: () => null });
    expect(none.mode).toBe("main");
    await expect(none.plan(t00, 0, "medium")).resolves.toEqual(planTile(inputs, t00, 0, "medium"));
    const throws = createPlanClient(inputs, {
      worker: () => {
        throw new Error("no module workers");
      },
    });
    expect(throws.mode).toBe("main");
    // The default factory under vitest (node: no Worker global).
    expect(typeof Worker).toBe("undefined");
    expect(createPlanClient(inputs).mode).toBe("main");
  });

  it("a plan error from the Worker rejects that plan (not superseded)", async () => {
    const { w, make } = fake();
    const c = createPlanClient(inputs, { worker: make });
    const p = c.plan(t00, 0, "medium");
    w.onmessage?.({ data: { seq: 1, error: "boom" } } as MessageEvent<PlanReply>);
    await expect(p).rejects.toThrow("boom");
    expect(c.mode).toBe("worker");
  });
});

describe("Worker and main thread plan the same content (determinism)", () => {
  const keys: [ReturnType<typeof tileAt>, 0 | 1 | 2, "medium" | "high" | "low"][] = [
    [t00, 0, "medium"],
    [t00, 1, "high"],
    [t10, 2, "medium"],
    [t00, 0, "low"],
  ];
  it.each(keys)(
    "tile %#: wire round trip deep-equals the main-thread plan",
    async (tile, ring, tier) => {
      const { w, make } = fake();
      const c = createPlanClient(inputs, { worker: make });
      const p = c.plan(tile, ring, tier);
      w.answer();
      const viaWorker = await p;
      const main = planTile(inputs, tile, ring, tier);
      expect(viaWorker).toEqual(main);
      // Typed arrays arrive as typed arrays (transferred copies, never the planners' own).
      for (const r of viaWorker.ribbons) expect(r.positions).toBeInstanceOf(Float32Array);
    },
  );

  it("the parking stalls and verge strips cross as Float32Arrays, and the planners' arrays stay usable", () => {
    const c = planTile(inputs, t00, 0, "medium");
    expect(c.parking?.stalls).toBeInstanceOf(Float32Array);
    const before = c.ribbons[0]?.positions.length ?? 0;
    const { reply, transfer } = packReply(1, c, 1);
    structuredClone(reply, { transfer });
    // packReply copies first: the original arrays are not detached.
    expect(c.ribbons[0]?.positions.length).toBe(before);
    expect(transfer.length).toBeGreaterThan(0);
  });

  it("a tile without facades shares the empty list; init inputs are plain data", () => {
    const { w, make } = fake();
    const c = createPlanClient({ ...inputs, facades: new Map() }, { worker: make });
    const p = c.plan(t10, 0, "medium");
    w.answer();
    return p.then((content: TileContent) => {
      expect(content.facades).toBe(NO_FACADES);
      expect(() => structuredClone(toWire(inputs))).not.toThrow();
    });
  });
});
