import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  CROWD_MANIFEST_URL,
  type CrowdClip,
  type CrowdLook,
  type CrowdManifest,
  parseCrowdManifest,
} from "../assets/crowdManifest";
import { assembleCrowdKit, bakeBody, type CrowdKit } from "../motion/crowdBake";

/** The ASSETS lane's site worker entry in crowd.json (top-level `worker` key; spec §8). */
export interface WorkerEntry {
  file: string;
  bytes: number;
  body: "adult_man";
  outfit: string;
  mesh: string;
  tris: [number, number];
  clips: Record<string, CrowdClip>;
  palette: Record<string, string>;
}

/** Look id of the worker in its own one-look kit. */
export const WORKER_LOOK_ID = "site_worker";

/**
 * The one-look manifest the worker kit is baked from: the crowd manifest's roles, bones and LODs,
 * the adult man body with the worker's own clips, and one look (the worker mesh, its palette).
 */
export function workerManifest(m: CrowdManifest, w: WorkerEntry): CrowdManifest {
  const look: CrowdLook = {
    id: WORKER_LOOK_ID,
    body: "adult_man",
    outfit: w.outfit,
    prop: null,
    mesh: w.mesh,
    propMeshes: [],
    clips: { walk: "walk", idle: "idle" },
    tris: w.tris,
    palette: w.palette,
  };
  return {
    ...m,
    bodies: { ...m.bodies, adult_man: { ...m.bodies.adult_man, clips: w.clips } },
    looks: [look],
  };
}

/**
 * Loads the site worker (crowd_worker.glb) as its own crowd kit with one look, or null when the
 * crowd manifest has no `worker` entry (the cast then dresses the adult man with a runtime hard hat
 * and vest). Decorative.
 */
export async function loadWorkerKit(
  opts: { base?: string; signal?: AbortSignal } = {},
): Promise<CrowdKit | null> {
  const base = opts.base ?? "/city/";
  const r = await fetch(CROWD_MANIFEST_URL, { signal: opts.signal });
  if (!r.ok) return null;
  const raw = (await r.json()) as { worker?: WorkerEntry };
  const w = raw.worker;
  if (!w?.file || !w.mesh || !w.clips?.walk || !w.clips?.idle || !w.palette) return null;
  const { manifest } = parseCrowdManifest(raw);
  if (!manifest) return null;
  const g = await fetch(`${base}${w.file}?v=${w.bytes}`, { signal: opts.signal });
  if (!g.ok) return null;
  const buf = await g.arrayBuffer();
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(buf, "");
  const wm = workerManifest(manifest, w);
  return assembleCrowdKit(wm, [bakeBody(wm, "adult_man", gltf)]);
}
