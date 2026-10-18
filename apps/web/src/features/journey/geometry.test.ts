import { describe, expect, it } from "vitest";
import { createFrame } from "../scene/three/frame";
import { placeCard } from "./cardPlacement";
import demoPlan from "./fixtures/demoPlan.json";
import { miniMapLayout } from "./miniMap";
import { createRoutePath } from "./routePath";
import type { JourneyPlan } from "./timeline";

const plan = demoPlan as unknown as JourneyPlan;
const frame = createFrame([101.5135, 3.18]);
const toLocal = (lon: number, lat: number) => frame.toLocal(lon, lat);

describe("createRoutePath", () => {
  const path = createRoutePath(plan, toLocal);

  it("starts at the first polyline point and ends at the last", () => {
    const [x0, z0] = toLocal(...(plan.polyline[0] as [number, number]));
    const [x1, z1] = toLocal(...(plan.polyline.at(-1) as [number, number]));
    expect(path.pointAt(0)[0]).toBeCloseTo(x0, 6);
    expect(path.pointAt(0)[1]).toBeCloseTo(z0, 6);
    const end = path.pointAt(path.planLength);
    expect(end[0]).toBeCloseTo(x1, 6);
    expect(end[1]).toBeCloseTo(z1, 6);
  });

  it("plan metres map onto the polyline within 1 % (the frame is accurate to < 1 m)", () => {
    expect(path.planLength).toBe(963.5);
    expect(Math.abs(path.length / path.planLength - 1)).toBeLessThan(0.01);
  });

  it("clamps outside the route and moves monotonically along it", () => {
    expect(path.pointAt(-5)).toEqual(path.pointAt(0));
    expect(path.pointAt(5000)).toEqual(path.pointAt(path.planLength));
    let prev = path.pointAt(0);
    let walked = 0;
    for (let m = 0.1; m <= path.planLength; m += 0.1) {
      const p = path.pointAt(m);
      walked += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      prev = p;
    }
    expect(Math.abs(walked - path.length)).toBeLessThan(1);
  });

  it("span lines merge runs of the same status and cover the whole route", () => {
    const lines = path.spanLines();
    expect(lines.map((l) => l.eval)).toEqual(["UNKNOWN", "PASS", "UNKNOWN", "PASS"]);
    expect(lines[0]?.from_m).toBe(0);
    expect(lines.at(-1)?.to_m).toBe(963.5);
    for (let i = 1; i < lines.length; i++) expect(lines[i]?.from_m).toBe(lines[i - 1]?.to_m);
    for (const l of lines) {
      expect(l.points.length % 3).toBe(0);
      expect(l.points.length).toBeGreaterThanOrEqual(6);
    }
  });
});

describe("miniMapLayout", () => {
  const mm = miniMapLayout(plan, 220, 10);

  it("fits the route inside the view box with the padding", () => {
    for (const p of mm.spans.flatMap((s) => s.points)) {
      expect(p[0]).toBeGreaterThanOrEqual(10 - 1e-9);
      expect(p[0]).toBeLessThanOrEqual(210 + 1e-9);
      expect(p[1]).toBeGreaterThanOrEqual(10 - 1e-9);
      expect(p[1]).toBeLessThanOrEqual(mm.height - 10 + 1e-9);
    }
  });

  it("keeps north up and the aspect ratio of the route", () => {
    const pts = mm.spans.flatMap((s) => s.points);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    const path = createRoutePath(plan, toLocal);
    const all = Array.from({ length: 200 }, (_, i) => path.pointAt((i / 199) * path.planLength));
    const lw = Math.max(...all.map((p) => p[0])) - Math.min(...all.map((p) => p[0]));
    const lh = Math.max(...all.map((p) => p[1])) - Math.min(...all.map((p) => p[1]));
    expect(w / h).toBeCloseTo(lw / lh, 1);
    // the start is further north than the end on the demo route iff its lat is larger
    const [, latS] = plan.polyline[0] as [number, number];
    const [, latE] = plan.polyline.at(-1) as [number, number];
    expect(Math.sign(mm.heroAt(0)[1] - mm.heroAt(963.5)[1])).toBe(Math.sign(latE - latS));
  });

  it("the hero dot sits on the drawn route at every metre (< 0.5 px from a span vertex chain)", () => {
    for (let m = 0; m <= 963.5; m += 7.3) {
      const [x, y] = mm.heroAt(m);
      const d = Math.min(
        ...mm.spans.flatMap((s) =>
          s.points.slice(1).map((b, i) => segDist([x, y], s.points[i] as number[], b)),
        ),
      );
      expect(d).toBeLessThan(0.5);
    }
  });

  it("one marker per plan event at its metre, coloured by kind", () => {
    expect(mm.events).toHaveLength(plan.events.length);
    expect(mm.events.map((e) => e.kind)).toEqual(plan.events.map((e) => e.kind));
  });
});

function segDist(p: number[], a: number[], b: number[]): number {
  const [px, py] = p as [number, number];
  const [ax, ay] = a as [number, number];
  const [bx, by] = b as [number, number];
  const dx = bx - ax;
  const dy = by - ay;
  const L = dx * dx + dy * dy;
  const t = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

describe("placeCard", () => {
  const vp = { w: 1440, h: 900 };
  const card = { w: 290, h: 170 };

  it("sits above the anchor, centred, when there is room", () => {
    const p = placeCard({ x: 700, y: 500 }, card, vp);
    expect(p.left).toBe(700 - 145);
    expect(p.top).toBe(500 - 26 - 170);
    expect(p.side).toBe("above");
  });

  it("flips below an anchor near the top", () => {
    const p = placeCard({ x: 700, y: 40 }, card, vp);
    expect(p.side).toBe("below");
    expect(p.top).toBe(40 + 26);
  });

  it("is always fully inside the viewport (anchors anywhere, also off screen or missing)", () => {
    const anchors = [null];
    for (let x = -800; x <= 2400; x += 97)
      for (let y = -600; y <= 1600; y += 89) anchors.push({ x, y } as never);
    for (const size of [card, { w: 240, h: 220 }, { w: 1430, h: 890 }])
      for (const a of anchors) {
        const p = placeCard(a, size, vp, 8);
        expect(p.left).toBeGreaterThanOrEqual(0);
        expect(p.top).toBeGreaterThanOrEqual(0);
        expect(p.left + size.w).toBeLessThanOrEqual(vp.w);
        expect(p.top + size.h).toBeLessThanOrEqual(vp.h);
        if (size.w + 16 <= vp.w && size.h + 16 <= vp.h) {
          expect(p.left).toBeGreaterThanOrEqual(8);
          expect(p.top).toBeGreaterThanOrEqual(8);
          expect(p.left + size.w).toBeLessThanOrEqual(vp.w - 8);
          expect(p.top + size.h).toBeLessThanOrEqual(vp.h - 8);
        }
      }
  });

  it("keeps clear of a top inset (the label, HUD and route tag) when the card fits below it", () => {
    for (const y of [-100, 0, 120, 260, 500, 880]) {
      const p = placeCard({ x: 600, y }, card, { ...vp, top: 250 }, 8);
      expect(p.top).toBeGreaterThanOrEqual(258);
      expect(p.top + card.h).toBeLessThanOrEqual(vp.h - 8);
    }
    // no room under the inset: still fully inside the viewport
    const p = placeCard({ x: 600, y: 10 }, card, { w: 400, h: 300, top: 250 }, 8);
    expect(p.top).toBeGreaterThanOrEqual(0);
    expect(p.top + card.h).toBeLessThanOrEqual(300);
  });

  it("moves off the mini-map rectangle when it would cover it, staying inside the viewport", () => {
    const mm = { x: 1200, y: 16, w: 224, h: 170 };
    for (const a of [
      { x: 1300, y: 300 },
      { x: 1350, y: 120 },
      { x: 1100, y: 250 },
    ]) {
      const p = placeCard(a, card, { ...vp, avoid: [mm] }, 8);
      const overlaps =
        p.left < mm.x + mm.w &&
        p.left + card.w > mm.x &&
        p.top < mm.y + mm.h &&
        p.top + card.h > mm.y;
      expect(overlaps).toBe(false);
      expect(p.left).toBeGreaterThanOrEqual(8);
      expect(p.top + card.h).toBeLessThanOrEqual(vp.h - 8);
    }
    // a card far from the rectangle is not moved
    expect(placeCard({ x: 400, y: 500 }, card, { ...vp, avoid: [mm] })).toEqual(
      placeCard({ x: 400, y: 500 }, card, vp),
    );
  });

  it("non-finite anchors count as missing", () => {
    const p = placeCard({ x: Number.NaN, y: 3 }, card, vp);
    expect(p.anchored).toBe(false);
    expect(Number.isFinite(p.left) && Number.isFinite(p.top)).toBe(true);
  });
});
