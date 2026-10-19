/**
 * The acceptance hook (`window.__tlAcceptance`) is installed in dev builds or when the page is
 * loaded with `?acceptance=1`. Kept apart from the hook module, which loads only when this is true.
 */
export function acceptanceEnabled(dev: boolean, search: string): boolean {
  return dev || new URLSearchParams(search).get("acceptance") === "1";
}
