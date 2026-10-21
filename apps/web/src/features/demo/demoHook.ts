/**
 * The demo test hook registry (spec §7): `window.__tl.demo` drives whichever demo playback is
 * selected ("nav" = navigation compare, "bld" = building impact) with `seek`, `play`, `pause` and
 * reads `state()`. Each playback registers itself (`registerDemo`); renderers and overlays add
 * their own fields to a key's state (`registerDemoState`, e.g. screen boxes). Installed only in
 * dev and e2e builds, never in production.
 */

export type DemoKey = "nav" | "bld";

export interface DemoApi {
  seek: (t: number) => void;
  play: () => void;
  pause: () => void;
  state: () => object;
}

export interface DemoHook {
  seek: (t: number) => void;
  play: () => void;
  pause: () => void;
  /** Selects the playback the other calls drive. */
  set: (key: DemoKey) => void;
  /** The selected playback's state plus every registered extra field; `key` names it. */
  state: () => Record<string, unknown>;
}

const apis = new Map<DemoKey, DemoApi>();
const extras = new Map<DemoKey, Set<() => object>>();
let active: DemoKey = "nav";

/** Registers (or replaces) a key's playback; returns an unregister function. */
export function registerDemo(key: DemoKey, api: DemoApi): () => void {
  apis.set(key, api);
  return () => {
    if (apis.get(key) === api) apis.delete(key);
  };
}

/** Adds fields to a key's `state()` (later registrations win on a name clash); returns an unregister function. */
export function registerDemoState(key: DemoKey, fn: () => object): () => void {
  let set = extras.get(key);
  if (!set) {
    set = new Set();
    extras.set(key, set);
  }
  set.add(fn);
  return () => {
    extras.get(key)?.delete(fn);
  };
}

/** The selected key (test helper and `state().key`). */
export const activeDemo = (): DemoKey => active;

export function createDemoHook(): DemoHook {
  return {
    seek: (t) => apis.get(active)?.seek(t),
    play: () => apis.get(active)?.play(),
    pause: () => apis.get(active)?.pause(),
    set: (key) => {
      if (key === "nav" || key === "bld") active = key;
    },
    state: () => {
      const api = apis.get(active);
      const out: Record<string, unknown> = { key: active, registered: !!api };
      if (api) Object.assign(out, api.state());
      for (const fn of extras.get(active) ?? []) Object.assign(out, fn());
      return out;
    },
  };
}

type HookTarget = { __tl?: { demo?: DemoHook; [k: string]: unknown } };

/**
 * Installs `window.__tl.demo` when `dev` (Vite dev server, which the e2e suite also runs) is true.
 * `e2e` is for a build that maps an e2e flag into the client explicitly (none does today:
 * `envPrefix` is TL_PUBLIC_, so `import.meta.env.VITE_E2E` is always undefined). Returns whether
 * it installed.
 */
export function installDemoHook(
  opts: { dev: boolean; e2e?: unknown },
  target: HookTarget = (typeof window !== "undefined" ? window : {}) as HookTarget,
): boolean {
  const e2e = opts.e2e === true || opts.e2e === "true" || opts.e2e === "1";
  if (!opts.dev && !e2e) return false;
  target.__tl = { ...(target.__tl ?? {}), demo: createDemoHook() };
  return true;
}

/** Test only: forget every registration and select "nav". */
export function resetDemoRegistry(): void {
  apis.clear();
  extras.clear();
  active = "nav";
}
