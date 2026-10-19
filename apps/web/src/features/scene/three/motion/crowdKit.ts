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
  } = {},
): Promise<CrowdKit> {
  const base = opts.base ?? "/city/";
  const get = async (url: string) => {
    const r = await fetch(url, { signal: opts.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
  };
  const raw = await (opts.fetchJson ?? (async (u: string) => (await get(u)).json()))(
    CROWD_MANIFEST_URL,
  );
  const { manifest, problems } = parseCrowdManifest(raw);
  if (!manifest) throw new Error(`crowd manifest: ${problems.join("; ")}`);
  const loadGlb = opts.loadGlb ?? (async (u: string) => (await get(u)).arrayBuffer());
  const slice = opts.slice ?? idleSlice;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const bakes: BodyBake[] = [];
  for (const body of CROWD_BODIES) {
    if (opts.signal?.aborted) throw new Error("aborted");
    const spec = (manifest as CrowdManifest).bodies[body];
    // Versioned by size so a regenerated glb is never served from a stale HTTP cache.
    const buf = await loadGlb(`${base}${spec.file}?v=${spec.bytes}`);
    const gltf = await loader.parseAsync(buf, "");
    await slice();
    bakes.push(bakeBody(manifest, body, gltf));
  }
  return assembleCrowdKit(manifest, bakes);
}
