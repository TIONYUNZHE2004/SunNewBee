import * as THREE from "three";
import type { CrowdBody } from "../assets/crowdManifest";
import { peopleScale } from "../motion/agents";
import type { CrowdKit } from "../motion/crowdBake";
import { framePair } from "../motion/crowdGait";
import { createCrowdRenderer } from "../motion/crowdRenderer";
import {
  cheer,
  type localPath,
  type Placement,
  runnerPlacement,
  spectatorPlacements,
} from "./crowdLayout";

/** Runners drawn as people (decorative; not a crowd size). */
export const CROWD_RUNNERS = 30;
/** The walk clip played this many times faster, with a longer stride: reads as jogging. */
export const JOG_RATE = 2.3;
/** Within this distance a person uses the detailed LOD. */
const LOD0_M = 60;

const RUNNER_BODIES: readonly CrowdBody[] = ["adult_man", "adult_woman", "school_age"];

/**
 * T-031: the marathon's 3D people from the shared crowd kit (shaoxian's crowd system: baked
 * bone-matrix animation, two LOD BatchedMeshes). Runners jog along the course in lanes (the walk
 * clip sped up); spectators stand beside the closed course and at the start / finish, idle with a
 * small hop and sway (cheering). Lit, so it lives in the main scene (engine decor slot). Decoration:
 * "runners and spectators are illustrative, not crowd sizes".
 */
export function createMarathonCrowd(
  kit: CrowdKit,
  path: ReturnType<typeof localPath>,
  junctions: readonly [number, number][],
) {
  const spectators = spectatorPlacements(path, junctions);
  const looks = kit.manifest.looks;
  const plain = looks.map((l, i) => ({ l, i })).filter(({ l }) => !l.prop);
  const runnerLooks = plain.filter(({ l }) => RUNNER_BODIES.includes(l.body)).map(({ i }) => i);
  const anyLooks = plain.map(({ i }) => i);
  const pick = (pool: number[], n: number) => pool[(n * 7 + 3) % pool.length] ?? 0;
  const slotLooks = [
    ...Array.from({ length: CROWD_RUNNERS }, (_, n) => pick(runnerLooks, n)),
    ...spectators.map((_, n) => pick(anyLooks, n + 11)),
  ];
  const crowd = createCrowdRenderer(kit, slotLooks);
  crowd.group.name = "marathon-crowd";
  const bodyOf = (slot: number) => looks[slotLooks[slot] ?? 0]?.body ?? "adult_man";

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _y = new THREE.Vector3(0, 1, 0);

  const pose = (slot: number, pl: Placement, t: number, cam: THREE.Vector3, cheering: boolean) => {
    const clips = kit.clips[bodyOf(slot)];
    const clip = (pl.moving ? clips.walk : clips.idle) ?? clips.idle ?? clips.walk;
    if (!clip) {
      crowd.hide(slot);
      return;
    }
    const d = Math.hypot(pl.x - cam.x, cam.y, pl.z - cam.z);
    const k = peopleScale(d);
    const c = cheering ? cheer(t, pl.seed) : { lift: 0, sway: 0 };
    _m.compose(
      _p.set(pl.x, 0.08 + c.lift * k, pl.z),
      _q.setFromAxisAngle(_y, pl.yaw + c.sway),
      _s.set(k, k, k),
    );
    const rate = pl.moving ? JOG_RATE : 1;
    const phase = ((t * rate) / Math.max(0.1, clip.duration) + pl.seed) % 1;
    const f = framePair(phase, clip.frames);
    crowd.set(slot, d < LOD0_M ? 0 : 1, _m, clip.row + f.f0, clip.row + f.f1, f.t);
  };

  let lead: Placement | null = null;
  return {
    group: crowd.group,
    counts: () => ({ runners: CROWD_RUNNERS, spectators: spectators.length }),
    /** The lead runner as last posed (the camera follows this model). */
    lead: () => lead,
    /** Poses everyone at screen time t for a camera at `cam` (display scale by distance). */
    update(t: number, cam: THREE.Vector3) {
      for (let i = 0; i < CROWD_RUNNERS; i++) {
        const pl = runnerPlacement(path, t, i);
        if (i === 0) lead = pl;
        pose(i, pl, t, cam, false);
      }
      spectators.forEach((pl, n) => {
        pose(CROWD_RUNNERS + n, pl, t, cam, true);
      });
      crowd.commit();
    },
    dispose: () => crowd.dispose(),
  };
}
