import { useDevsim } from "./devsimStore";
import type { DevelopmentPlan, DevelopmentPlayIntent } from "./types";

/** The List view / no-WebGL copy when the world has no parcel for the simulation (AC-H6). */
export const NOT_AVAILABLE = "Development simulation is not available for this map.";

const isPlan = (p: unknown): p is DevelopmentPlan =>
  !!p &&
  typeof p === "object" &&
  Array.isArray((p as DevelopmentPlan).acts) &&
  Array.isArray((p as DevelopmentPlan).bubbles) &&
  !!(p as DevelopmentPlan).site;

/**
 * A `development.play` scene intent, or null for any other intent. Read loosely: the generated
 * `SceneIntent` type learns this kind only when the API client is regenerated, and the server may
 * leave the plan out (a world without the parcel), in which case the web fetches it.
 */
export function asDevsimIntent(i: unknown): DevelopmentPlayIntent | null {
  const o = i as { kind?: unknown; plan?: unknown; brief_text?: unknown } | null | undefined;
  if (o?.kind !== "development.play") return null;
  return {
    kind: "development.play",
    plan: isPlan(o.plan) ? o.plan : undefined,
    brief_text: typeof o.brief_text === "string" ? o.brief_text : "",
  };
}

/** The plan for a brief from the API: the plan, "unavailable" on 404, "error" otherwise. */
export async function fetchDevsimPlan(
  briefText: string,
  fetchFn: typeof fetch = fetch,
): Promise<DevelopmentPlan | "unavailable" | "error"> {
  try {
    const res = await fetchFn("/api/developments/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief_text: briefText }),
    });
    if (res.status === 404) return "unavailable";
    if (!res.ok) return "error";
    const plan = (await res.json()) as unknown;
    return isPlan(plan) ? plan : "error";
  } catch {
    return "error";
  }
}

let generation = 0;

/**
 * Starts the simulation for an intent: an inlined plan plays at once; without one the plan is
 * fetched first (`loading`), then plays, or the store says `unavailable` / `error`. A newer intent
 * (or a stop) while the fetch runs wins: the stale answer is dropped.
 */
export async function beginDevsim(
  intent: DevelopmentPlayIntent,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const g = ++generation;
  const store = useDevsim.getState();
  store.start(intent.plan ?? null, intent.brief_text);
  if (intent.plan) {
    useDevsim.getState().play();
    return;
  }
  const out = await fetchDevsimPlan(intent.brief_text, fetchFn);
  const now = useDevsim.getState();
  if (g !== generation || now.status !== "loading") return;
  if (typeof out === "string") now.setStatus(out);
  else {
    now.setPlan(out);
    useDevsim.getState().play();
  }
}
