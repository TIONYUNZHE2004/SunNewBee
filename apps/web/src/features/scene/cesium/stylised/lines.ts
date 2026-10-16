/** Pure line helpers in lon/lat with local metric maths (display-only decoration). */
const M_PER_DEG = 111_320;
const RAD = Math.PI / 180;

type Pt = [number, number];

/** Drop consecutive duplicate points (zero-length segments have no direction). */
function dedupe(coords: Pt[]): Pt[] {
  return coords.filter(
    (p, i) => i === 0 || p[0] !== coords[i - 1]![0] || p[1] !== coords[i - 1]![1],
  );
}

/** Offset a line sideways by `m` metres (left of travel for positive `m`), mitred at corners. */
export function offsetLine(input: Pt[], m: number): Pt[] {
  const coords = dedupe(input);
  if (coords.length < 2) return input.slice();
  const lat0 = coords[0]![1];
  const kx = Math.cos(lat0 * RAD) * M_PER_DEG;
  const xy = coords.map(([lon, lat]) => [lon * kx, lat * M_PER_DEG] as Pt);
  const normal = (a: Pt, b: Pt): Pt => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    return [-dy / len, dx / len]; // left of travel
  };
  const out: Pt[] = [];
  for (let i = 0; i < xy.length; i++) {
    const nPrev = i > 0 ? normal(xy[i - 1]!, xy[i]!) : null;
    const nNext = i < xy.length - 1 ? normal(xy[i]!, xy[i + 1]!) : null;
    let n: Pt;
    if (nPrev && nNext) {
      const sx = nPrev[0] + nNext[0];
      const sy = nPrev[1] + nNext[1];
      const sl = Math.hypot(sx, sy);
      // miter, limited to 2x the offset on sharp turns
      const cos = sl / 2;
      const scale = sl < 1e-6 ? 1 : Math.min(2, 1 / Math.max(cos, 0.5));
      n = sl < 1e-6 ? nPrev : [(sx / sl) * scale, (sy / sl) * scale];
    } else n = (nPrev ?? nNext)!;
    out.push([(xy[i]![0] + n[0] * m) / kx, (xy[i]![1] + n[1] * m) / M_PER_DEG]);
  }
  return out;
}

/**
 * Cut a line into `dashM` dashes separated by `gapM` gaps, measured by arc length along the whole
 * polyline. A dash that spans a vertex keeps that vertex (so a dash has 2+ points). A final dash
 * that would run past the line end is dropped, so every dash measures `dashM`.
 */
export function dashSegments(input: Pt[], dashM: number, gapM: number): Pt[][] {
  const coords = dedupe(input);
  if (coords.length < 2 || dashM <= 0) return [];
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    const [x1, y1] = coords[i - 1]!;
    const [x2, y2] = coords[i]!;
    const k = Math.cos(((y1 + y2) / 2) * RAD) * M_PER_DEG;
    cum.push(cum[i - 1]! + Math.hypot((x2 - x1) * k, (y2 - y1) * M_PER_DEG));
  }
  const total = cum[cum.length - 1]!;
  const at = (d: number, seg: number): Pt => {
    const [x1, y1] = coords[seg]!;
    const [x2, y2] = coords[seg + 1]!;
    const f = (d - cum[seg]!) / (cum[seg + 1]! - cum[seg]!);
    return [x1 + (x2 - x1) * f, y1 + (y2 - y1) * f];
  };
  const segOf = (d: number) => {
    let s = 0;
    while (s < coords.length - 2 && cum[s + 1]! <= d) s++;
    return s;
  };
  const out: Pt[][] = [];
  for (let start = 0; start + dashM <= total + 1e-6; start += dashM + gapM) {
    const end = Math.min(start + dashM, total);
    const sa = segOf(start);
    const dash: Pt[] = [at(start, sa)];
    for (let v = sa + 1; v < coords.length - 1 && cum[v]! < end - 1e-6; v++) {
      if (cum[v]! > start + 1e-6) dash.push(coords[v]!);
    }
    dash.push(at(end, segOf(Math.max(start, end - 1e-9))));
    out.push(dash);
  }
  return out;
}
