/**
 * [hue 0-360, saturation 0-1] of a #rrggbb colour (HSL). Pure. Hue helpers for palette guard tests
 * (A-T9). The Phase B clay token guard must run `readsAsWater` over EVERY roof colour table (manifest
 * palettes, ROOF_TINTS, KIND_COLOUR, NEUTRAL_COLOURS, the clay table), not just one.
 */
export function hueSat(hex: string): [number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255) as [
    number,
    number,
    number,
  ];
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  const d = hi - lo;
  if (d === 0) return [0, 0];
  const s = d / (1 - Math.abs(hi + lo - 1));
  let h = hi === r ? ((g - b) / d) % 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [(h + 360) % 360, s];
}

/** True when a roof colour would read as water: within +-25 deg of the water hue and saturation > 0.15. */
export function readsAsWater(hex: string, water: string): boolean {
  const [h, s] = hueSat(hex);
  if (s <= 0.15) return false;
  const dh = Math.abs(h - hueSat(water)[0]);
  return Math.min(dh, 360 - dh) <= 25;
}
