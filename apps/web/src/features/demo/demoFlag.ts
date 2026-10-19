/** True when the URL carries the demo recording flag `?demo=1` (spec section 6.6). One helper for
 * everything that keys off it (the preset, `window.__journey` gating and trip auto-play). Kept in
 * its own module, free of store imports, so the scene store can read it without an import cycle. */
export function isDemoPreset(
  search: string = typeof location === "undefined" ? "" : location.search,
): boolean {
  return new URLSearchParams(search).get("demo") === "1";
}
