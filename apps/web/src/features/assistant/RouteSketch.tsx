import { ROUTE_STYLE } from "../scene/styles";

/** Fit [lon, lat] points into a w×h box (equirectangular, x scaled by cos(lat), aspect kept,
 * centred, `pad` px margin). Returns the SVG path and its end points. Pure. */
export function sketchPath(
  coords: [number, number][],
  w: number,
  h: number,
  pad = 14,
): { d: string; start: [number, number]; end: [number, number] } | null {
  if (coords.length < 2) return null;
  const lat0 = (coords.reduce((s, c) => s + c[1], 0) / coords.length) * (Math.PI / 180);
  const k = Math.cos(lat0);
  const xs = coords.map((c) => c[0] * k);
  const ys = coords.map((c) => c[1]);
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const dx = Math.max(maxX - minX, 1e-9);
  const dy = Math.max(maxY - minY, 1e-9);
  const s = Math.min((w - 2 * pad) / dx, (h - 2 * pad) / dy);
  const ox = (w - dx * s) / 2;
  const oy = (h - dy * s) / 2;
  const pts = xs.map((x, i) => [
    +(ox + (x - minX) * s).toFixed(1),
    +(oy + (maxY - (ys[i] as number)) * s).toFixed(1), // north up
  ]) as [number, number][];
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  return { d, start: pts[0] as [number, number], end: pts[pts.length - 1] as [number, number] };
}

/** The map's own route colour, so the sketch and the 3D route read as one thing. */
const ROUTE = ROUTE_STYLE.color;
const W = 320;
const H = 132;

/**
 * The answer's route as a small north-up line drawing: the server's real route geometry, drawn
 * once (it traces in), with a hollow start and a filled end. Not a map: no streets or scale.
 */
export function RouteSketch({
  coords,
  from,
  to,
  onShow,
}: {
  coords: [number, number][];
  from?: string;
  to?: string;
  /** Flies the 3D camera to the route; the sketch is a plain figure without it. */
  onShow?: () => void;
}) {
  const p = sketchPath(coords, W, H);
  if (!p) return null;
  const label = `Route sketch${from && to ? ` from ${from} to ${to}` : ""}`;
  const svg = (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      className="block h-auto w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <pattern id="route-sketch-dots" width="12" height="12" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.9" className="fill-fg/15" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#route-sketch-dots)" />
      <path
        d={p.d}
        fill="none"
        className="stroke-fg/10"
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={p.d}
        fill="none"
        stroke={ROUTE}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={220}
        strokeDasharray="220"
        className="motion-safe:animate-[trace_900ms_cubic-bezier(.2,.7,.2,1)_both]"
      />
      <circle
        cx={p.start[0]}
        cy={p.start[1]}
        r="5"
        className="fill-surface"
        stroke={ROUTE}
        strokeWidth="2.5"
      />
      <circle
        cx={p.end[0]}
        cy={p.end[1]}
        r="6"
        fill={ROUTE}
        className="stroke-surface"
        strokeWidth="2.5"
      />
    </svg>
  );
  return (
    <figure className="m-0 space-y-2">
      {onShow ? (
        <button
          type="button"
          onClick={onShow}
          aria-label={`${label}. Show on map`}
          className="block w-full overflow-hidden rounded-xl border border-edge bg-surface transition-colors hover:border-fg/25"
        >
          {svg}
        </button>
      ) : (
        <div className="overflow-hidden rounded-xl border border-edge bg-surface">{svg}</div>
      )}
      {from && to && (
        <figcaption className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 text-xs">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-full border-2 bg-surface"
            style={{ borderColor: ROUTE }}
          />
          <span className="text-fg">
            <span className="sr-only">From </span>
            {from}
          </span>
          <span
            aria-hidden="true"
            className="size-2.5 rounded-full"
            style={{ background: ROUTE }}
          />
          <span className="text-fg">
            <span className="sr-only">To </span>
            {to}
          </span>
        </figcaption>
      )}
    </figure>
  );
}
