export type DemoName = "hero";

const KNOWN: readonly DemoName[] = ["hero"];

/** `?demo=hero` starts the hero walkthrough; anything else leaves the app unchanged. */
export function parseDemoParam(search: string): DemoName | null {
  const v = new URLSearchParams(search).get("demo");
  return KNOWN.find((k) => k === v) ?? null;
}
