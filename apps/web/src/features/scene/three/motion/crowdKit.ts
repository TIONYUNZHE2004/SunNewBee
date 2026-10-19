import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  CROWD_BODIES,
  CROWD_MANIFEST_URL,
  type CrowdManifest,
  parseCrowdManifest,
} from "../assets/crowdManifest";
import { assembleCrowdKit, type BodyBake, bakeBody, type CrowdKit } from "./crowdBake";

/** Lets the main thread breathe between bodies (an idle slice in the browser, a macrotask elsewhere). */
export const idleSlice = (): Promise<void> =>
  new Promise((resolve) => {
    const ric = (
      globalThis as {
        requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    if (typeof ric === "function") ric(() => resolve(), { timeout: 200 });
    else setTimeout(resolve, 0);
  });

/** A crowd kit load not finished by then rejects (useMotion falls back to the legacy people kit). */
export const CROWD_LOAD_TIMEOUT_MS = 15_000;

/**
 * Loads the crowd kit (C-T7): the manifest, then each body glb in turn, baking it in its own slice
 * (about 25 ms per body on a desktop CPU in node), so the first frame never waits on it. Decorative.
 */
export async function loadCrowdKit(
  opts: {
    base?: string;
    signal?: AbortSignal;
    fetchJson?: (url: string) => Promise<unknown>;
    loadGlb?: (url: string) => Promise<ArrayBuffer>;
    slice?: () => Promise<void>;
    timeoutMs?: number;
  } = {},
): Promise<CrowdKit> {
  const base = opts.base ?? "/city/";
  // One signal for the caller's abort and the timeout; every await below races it.
  const ac = new AbortController();
  const onAbort = () => ac.abort(new Error("crowd kit load aborted"));
  if (opts.signal?.aborted) onAbort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(
    () => ac.abort(new Error("crowd kit load timed out")),
    opts.timeoutMs ?? CROWD_LOAD_TIMEOUT_MS,
  );
  const stopped = new Promise<never>((_, reject) => {
    const fail = () => reject(ac.signal.reason);
    if (ac.signal.aborted) fail();
    else ac.signal.addEventListener("abort", fail, { once: true });
  });
  stopped.catch(() => {});
  const race = <T>(p: Promise<T>) => Promise.race([p, stopped]);
  try {
    return await loadKit(opts, base, ac.signal, race);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

async function loadKit(
  opts: {
    fetchJson?: (url: string) => Promise<unknown>;
    loadGlb?: (url: string) => Promise<ArrayBuffer>;
    slice?: () => Promise<void>;
  },
  base: string,
  signal: AbortSignal,
  race: <T>(p: Promise<T>) => Promise<T>,
): Promise<CrowdKit> {
  const get = async (url: string) => {
    const r = await fetch(url, { signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
  };
  const raw = await race(
    (opts.fetchJson ?? (async (u: string) => (await get(u)).json()))(CROWD_MANIFEST_URL),
  );
  const { manifest, problems } = parseCrowdManifest(raw);
  if (!manifest) throw new Error(`crowd manifest: ${problems.join("; ")}`);
  const loadGlb = opts.loadGlb ?? (async (u: string) => (await get(u)).arrayBuffer());
  const slice = opts.slice ?? idleSlice;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const bakes: BodyBake[] = [];
  for (const body of CROWD_BODIES) {
    const spec = (manifest as CrowdManifest).bodies[body];
    // Versioned by size so a regenerated glb is never served from a stale HTTP cache.
    const buf = await race(loadGlb(`${base}${spec.file}?v=${spec.bytes}`));
    const gltf = await race(loader.parseAsync(buf, ""));
    await race(slice());
    bakes.push(bakeBody(manifest, body, gltf));
  }
  const kit = assembleCrowdKit(manifest, bakes);
  if (signal.aborted) {
    kit.dispose();
    throw signal.reason;
  }
  return kit;
}
