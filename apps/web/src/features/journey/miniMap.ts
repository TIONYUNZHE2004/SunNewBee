import { createRoutePath, type SpanEval } from "./routePath";
import type { JourneyEventKind, JourneyPlan } from "./timeline";

export interface MiniMapLayout {
  width: number;
  height: number;
  /** Same-status runs as SVG points, in travel order. */
  spans: { eval: SpanEval; points: [number, number][] }[];
  events: { kind: JourneyEventKind; at_m: number; x: number; y: number }[];
  /** SVG position of the hero at `m` plan metres (the same route maths as the 3D hero). */
  heroAt(m: number): [number, number];
}

const RAD = Math.PI / 180;
const M_PER_DEG = 111_320;

/**
 * North-up mini-map of the plan route, `width` SVG units wide, with `pad` around it. Projection:
 * local equirectangular metres about the first route point (x east, y south, as SVG), uniformly
 * scaled. Height follows the route aspect ratio, capped at 1.25 x width.
 */
export function miniMapLayout(
  plan: Pick<JourneyPlan, "polyline" | "spans" | "events">,
  width: number,
  pad: number,
): MiniMapLayout {
  const [lon0, lat0] = (plan.polyline[0] ?? [0, 0]) as [number, number];
  const cosLat = Math.cos(lat0 * RAD);
  const toLocal = (lon: number, lat: number): [number, number] => [
    (lon - lon0) * cosLat * M_PER_DEG,
    -(lat - lat0) * M_PER_DEG,
  ];
  const path = createRoutePath(plan, toLocal);
  const lines = path.spanLines();
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const l of lines)
    for (let i = 0; i < l.points.length; i += 3) {
      const x = l.points[i] as number;
      const y = l.points[i + 2] as number;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 1;
    maxY = 1;
  }
  const inner = width - 2 * pad;
  const dx = Math.max(1e-6, maxX - minX);
  const dy = Math.max(1e-6, maxY - minY);
  const s = Math.min(inner / dx, (1.25 * width - 2 * pad) / dy);
  const height = dy * s + 2 * pad;
  const ox = pad + (inner - dx * s) / 2;
  const toSvg = (x: number, y: number): [number, number] => [
    ox + (x - minX) * s,
    pad + (y - minY) * s,
  ];
  const heroAt = (m: number) => {
    const [x, y] = path.pointAt(m);
    return toSvg(x, y);
  };
  return {
    width,
    height,
    spans: lines.map((l) => {
      const points: [number, number][] = [];
      for (let i = 0; i < l.points.length; i += 3)
        points.push(toSvg(l.points[i] as number, l.points[i + 2] as number));
      return { eval: l.eval, points };
    }),
    events: plan.events.map((e) => {
      const [x, y] = heroAt(e.at_m);
      return { kind: e.kind, at_m: e.at_m, x, y };
    }),
    heroAt,
  };
}
