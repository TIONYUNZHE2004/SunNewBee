/** Pure line helpers in lon/lat with local metric maths (display-only decoration). */
const M_PER_DEG = 111_320;
const RAD = Math.PI / 180;

type Pt = [number, number];

/** Offset a line sideways by `m` metres (left of travel for positive `m`), mitred at corners. */
export function offsetLine(coords: Pt[], m: number): Pt[] {
  if (coords.length < 2) return coords.slice();
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

/** Cut a line into `dashM` dashes separated by `gapM` gaps; each dash is a two-point segment. */
export function dashSegments(coords: Pt[], dashM: number, gapM: number): Pt[][] {
  const out: Pt[][] = [];
  const period = dashM + gapM;
  let pos = 0; // metres along the line where the current period started
  let walked = 0;
  for (let i = 0; i + 1 < coords.length; i++) {
    const [x1, y1] = coords[i]!;
    const [x2, y2] = coords[i + 1]!;
    const k = Math.cos(((y1 + y2) / 2) * RAD) * M_PER_DEG;
    const len = Math.hypot((x2 - x1) * k, (y2 - y1) * M_PER_DEG);
    if (len === 0) continue;
    const at = (d: number): Pt => {
      const f = (d - walked) / len;
      return [x1 + (x2 - x1) * f, y1 + (y2 - y1) * f];
    };
    while (pos < walked + len) {
      const a = Math.max(pos, walked);
      const b = Math.min(pos + dashM, walked + len);
      if (b > a + 0.01 && pos + dashM <= walked + len + 1e-6) out.push([at(a), at(b)]);
      if (pos + dashM > walked + len) break;
      pos += period;
    }
    walked += len;
  }
  return out;
}
