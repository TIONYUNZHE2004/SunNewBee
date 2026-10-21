import * as THREE from "three";
import type { DevelopmentPlan } from "../../../devsim/types";
import type { CrowdBody } from "../assets/crowdManifest";
import { peopleScale } from "../motion/agents";
import type { CrowdKit } from "../motion/crowdBake";
import { framePair } from "../motion/crowdGait";
import { type CrowdRenderer, createCrowdRenderer } from "../motion/crowdRenderer";
import { DEVSIM_COLOURS } from "../shared/clayTokens";
import type { DevsimFrame, DevsimPart } from "./devsimLayer";
import { devsimMoodWeights } from "./devsimView";
import { ease, span } from "./ease";
import { along, lengthOf, onPath, type SiteGeom, type XZ, yawOf } from "./geom";
import { toScreen } from "./project";

const NOOP = () => {};
export const MOVERS = 8;
export const WORKERS = 9;
const MOVE_IN = 36.4;
const MOVE_GAP = 0.8;
const SLOT_M = 2.3;
/** Name tags show only within this camera distance (gate 2: wide enough for Halim at the 19 s beat). */
const TAG_RANGE_M = 320;

/** Peak opacity of the speaker's backlight glow at full night (Q3: the speaker reads at dusk and night). */
const GLOW_MAX = 1;
/** The glow colour's gain over the token colour (additive light). */
const GLOW_GAIN = 1.6;

/** A soft round glow (white centre to clear edge), as a small RGBA texture (no canvas: tests run in node). */
export function glowTexture(n = 64): THREE.DataTexture {
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.5;
      const r = Math.min(1, Math.hypot(dx * 2, dy * 2));
      const a = (1 - r) ** 1.5;
      const i = (y * n + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}

/** The speaker's backlight at the sim sun: 0 by full day, up to GLOW_MAX at night (dusk partly). */
export function speakerGlow(sun: DevsimFrame["s"]["sun"]): number {
  return GLOW_MAX * (1 - devsimMoodWeights(sun).day);
}

/** Spotlight Residents, their bodies and preferred looks (the cast ids are the plan's). */
export const CAST_LOOKS: Record<string, { body: CrowdBody; looks: string[] }> = {
  halim: { body: "older_man", looks: ["oldman_casual_kopiah", "oldman_baju_melayu_cream"] },
  farid: { body: "adult_man", looks: ["man_casual_sky", "man_office_white"] },
  meiling: { body: "adult_woman", looks: ["woman_casual_bob", "woman_office_navy"] },
  kid: { body: "child", looks: ["child_casual_orange", "child_casual_mint"] },
  // tudung outfit (baju kurung with tudung)
  zainab: { body: "older_woman", looks: ["oldwoman_baju_kurung_blue", "oldwoman_casual_tudung"] },
  arjun: { body: "adult_man", looks: ["man_office_blue", "man_casual_sky"] },
};
const MOVER_LOOKS = [
  "man_baju_melayu_teal",
  "woman_baju_kurung_green",
  "man_casual_sky",
  "woman_casual_tudung",
  "man_office_white",
  "woman_baju_kurung_purple",
  "oldman_office_batik",
  "woman_casual_bob",
];
/** The ASSETS lane's worker look (if the manifest has one), else the adult man with runtime hat + vest. */
const WORKER_FALLBACK = "man_office_white";

export interface CastPose {
  x: number;
  z: number;
  yaw: number;
  walk: boolean;
}

/** Slot order: spotlight ids, then movers, then workers (fixed: probe index i = same person). */
export function castSlots(plan: DevelopmentPlan): string[] {
  const ids = plan.cast.map((c) => c.id);
  if (ids.includes("meiling")) ids.push("kid");
  for (let i = 0; i < MOVERS; i++) ids.push(`mover${i}`);
  for (let i = 0; i < WORKERS; i++) ids.push(`worker${i}`);
  return ids;
}

/** Worker loop: a stack, the tower foot nearest it, back (local points). */
function workerLoops(g: SiteGeom): XZ[][] {
  const stacks: XZ[] = [];
  for (let i = 0; i < 5; i++) {
    const s = (i - 2) * 7;
    const o = -4 + (i % 2) * 6;
    stacks.push([
      g.yard[0] + g.side[0] * s + g.out[0] * o,
      g.yard[1] + g.side[1] * s + g.out[1] * o,
    ]);
  }
  return Array.from({ length: WORKERS }, (_, i) => {
    const a = stacks[i % stacks.length] as XZ;
    let dx = a[0] - g.centre[0];
    let dz = a[1] - g.centre[1];
    const l = Math.hypot(dx, dz) || 1;
    const r = (i - 4) * 0.12;
    [dx, dz] = [
      (dx / l) * Math.cos(r) - (dz / l) * Math.sin(r),
      (dx / l) * Math.sin(r) + (dz / l) * Math.cos(r),
    ];
    const base: XZ = [g.centre[0] + dx * (g.radius + 3), g.centre[1] + dz * (g.radius + 3)];
    return [a, base, a];
  });
}

const loopCache = new WeakMap<SiteGeom, XZ[][]>();
/** `workerLoops`, once per site geometry. */
function workerLoopsOf(g: SiteGeom): XZ[][] {
  let l = loopCache.get(g);
  if (!l) {
    l = workerLoops(g);
    loopCache.set(g, l);
  }
  return l;
}

/**
 * Where each cast member is at screen time t (pure; null = off stage). Ported from the prototype's
 * `castAt`, with the brief's beats: Halim walks the detour (17.2-21.6 s), Farid by the hoarding,
 * movers queue on the entrance path and go in one by one, Halim greets Mei Ling at the door
 * (40.2-43.2 s), residents leave through the door (44-47 s), Mei Ling at the school-run queue,
 * Zainab at the park, Arjun at the mall, workers between the stacks and the tower by day.
 */
export function castAt(
  t: number,
  g: SiteGeom,
  opts: { workersActive: boolean; flowT?: number },
): Map<string, CastPose> {
  const o = new Map<string, CastPose>();
  const toward = (a: XZ, b: XZ) => yawOf([b[0] - a[0], b[1] - a[1]]);
  const inYaw = yawOf([-g.out[0], -g.out[1]]);
  const outYaw = yawOf(g.out);
  const pathLen = Math.hypot(g.node[0] - g.door[0], g.node[1] - g.door[1]);
  const put = (id: string, p: XZ, yaw: number, walk: boolean) =>
    o.set(id, { x: p[0], z: p[1], yaw, walk });

  // Construction: Halim on the detour, Farid by the hoarding
  if (t >= 16.6 && t < 23) {
    const L = lengthOf(g.halimPath);
    const u = span(t, 17.2, 21.6);
    const a = along(g.halimPath, L * u);
    put("halim", a.p, yawOf(a.dir), u > 0 && u < 1);
  }
  if (t >= 22.4 && t < 27.5) put("farid", g.farid, toward(g.farid, g.centre), false);
  // workers by day
  if (opts.workersActive) {
    const loops = workerLoopsOf(g);
    const ft = opts.flowT ?? t;
    loops.forEach((pts, i) => {
      const L = lengthOf(pts);
      const d = (ft * 1.3 + i * 7) % L;
      const a = along(pts, d);
      put(`worker${i}`, a.p, yawOf(a.dir), true);
    });
  }
  // Handover: movers queue and go in; the greeting at the door
  if (t >= 33.6 && t < 44) {
    for (let i = 0; i < MOVERS; i++) {
      const k =
        i +
        18 * (1 - ease(span(t, 33.6 + i * 0.2, MOVE_IN))) -
        Math.max(0, (t - MOVE_IN) / MOVE_GAP);
      if (k <= -0.4) continue;
      const moving = t < MOVE_IN || (t - MOVE_IN) % MOVE_GAP < MOVE_GAP * 0.6;
      put(`mover${i}`, onPath(g, 1.6 + Math.max(0, k) * SLOT_M, 0), inYaw, moving);
    }
  }
  if (t >= 34 && t < 44) {
    const ml = onPath(g, 4.5, 5.2);
    const faceSide = yawOf([-g.side[0], -g.side[1]]);
    put("meiling", ml, faceSide, false);
    put("kid", onPath(g, 4.5, 6.7), faceSide, false);
    const k = ease(span(t, 37.6, 40.2));
    const a = onPath(g, pathLen + 4, 4);
    const b = onPath(g, 7.2, 4.6);
    const hp: XZ = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    put("halim", hp, k >= 1 ? toward(hp, ml) : inYaw, k > 0 && k < 1);
    if (k >= 1) put("meiling", ml, toward(ml, hp), false);
  }
  // Daily Life: out through the door
  const exitAt = (t0: number, to: number, lat: number) => {
    const k = ease(span(t, t0, t0 + 2.6));
    return { p: onPath(g, -1 + (to + 1) * k, lat * k), walk: k > 0 && k < 1, vis: t >= t0 };
  };
  if (t >= 44 && t < 52) {
    const m = exitAt(44.3, pathLen - 3, 1.6);
    const kd = exitAt(44.5, pathLen - 3, 3);
    const look = t >= 47 ? toward(m.p, g.junction) : outYaw;
    if (m.vis) put("meiling", m.p, look, m.walk);
    if (kd.vis) put("kid", kd.p, look, kd.walk);
    const z = exitAt(45.1, 16, -1.6);
    const ar = exitAt(45.7, 12, 0.2);
    if (z.vis && t < 48.6) put("zainab", z.p, outYaw, z.walk);
    if (ar.vis && t < 48.8) put("arjun", ar.p, outYaw, ar.walk);
    // other residents leave for the day (44-47 s)
    for (let i = 0; i < 4; i++) {
      const e = exitAt(44 + i * 0.7, pathLen + 6, (i - 1.5) * 0.9);
      if (e.vis && t < 47.4 + i * 0.7) put(`mover${i}`, e.p, outYaw, e.walk);
    }
  }
  if (t >= 51.8 && t < 57.6) put("zainab", g.park, toward(g.park, g.centre), false);
  if (t >= 57) put("arjun", g.mall, toward(g.centre, g.mall), false);
  return o;
}

/** Text colour (#fff or near black) with the better contrast on `hex`. */
export function tagTextColour(hex: string): string {
  const c = new THREE.Color(hex);
  const L = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; // linear
  return 1.05 / (L + 0.05) >= (L + 0.05) / 0.061 ? DEVSIM_COLOURS.white : DEVSIM_COLOURS.nearBlack;
}

export interface CastOpts {
  plan: DevelopmentPlan;
  geom: SiteGeom;
  /** Name tags go in this element (absolute, pointer-events none); none in tests. */
  tagHost?: HTMLElement | null;
  /** Flow seconds (fast-forward clock) for the workers' walk. */
  flowT?: (t: number) => number;
}

/**
 * The cast (spec §5.3 Characters, P4 scope 2-3): Spotlight Residents, movers and workers drawn
 * with the app's GLB crowd models (baked crowd renderer, walk and idle clips), each Spotlight
 * Resident with a ground ring and a name tag in the plan's colour. Workers use the worker look when
 * the crowd manifest has one, else the adult man with a hard hat and hi-vis vest added here. Movers
 * carry boxes. The crowd kit arrives later (`setKit`); until then only rings and tags show.
 * Decorative: the names are illustrative casting.
 */
export type Cast = DevsimPart & {
  setKit(kit: CrowdKit | null): void;
  /** The ASSETS lane's one-look worker kit (`workerKit.ts`); null: hat + vest on the adult man. */
  setWorkerKit(kit: CrowdKit | null): void;
  /** The pose of a slot now (tests). */
  poseOf(id: string): CastPose | null;
};

export function createCast(o: CastOpts): Cast {
  const { geom: g, plan } = o;
  const slots = castSlots(plan);
  const group = new THREE.Group();
  group.name = "devsim-cast";
  group.raycast = NOOP;
  const disposers: (() => void)[] = [];
  const own = <T extends { dispose(): void }>(x: T) => {
    disposers.push(() => x.dispose());
    return x;
  };

  // rings under the Spotlight Residents
  const ringGeo = own(new THREE.TorusGeometry(0.75, 0.07, 8, 32).rotateX(Math.PI / 2));
  const rings = new Map<string, THREE.Mesh>();
  for (const c of plan.cast) {
    const m = new THREE.Mesh(ringGeo, own(new THREE.MeshBasicMaterial({ color: c.colour })));
    m.position.y = 0.06;
    m.visible = false;
    m.raycast = NOOP;
    rings.set(c.id, m);
    group.add(m);
  }

  // The speaker's backlight (spec §9 Q3): at dusk and night a soft warm glow just behind the
  // speaking resident, so they read against the darker street, as a stage light would. Decorative.
  const glowMat = own(
    new THREE.SpriteMaterial({
      map: own(glowTexture()),
      color: DEVSIM_COLOURS.headGlow,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0,
    }),
  );
  // brighter than white (additive, linear): a stage light, not a tint
  glowMat.color.multiplyScalar(GLOW_GAIN);
  const glow = new THREE.Sprite(glowMat);
  glow.name = "devsim-speaker-glow";
  glow.visible = false;
  glow.raycast = NOOP;
  // drawn before the (transparent) crowd, so the speaker stands in front of their light
  glow.renderOrder = -1;
  group.add(glow);
  let speaker: string | null = null;
  let glowK = 0;

  // name tags (DOM)
  const tags = new Map<string, HTMLDivElement>();
  if (o.tagHost && typeof document !== "undefined") {
    for (const c of plan.cast) {
      const el = document.createElement("div");
      el.textContent = c.name;
      el.dataset.devsimTag = c.id;
      el.setAttribute("aria-hidden", "true");
      Object.assign(el.style, {
        position: "absolute",
        left: "0",
        top: "0",
        pointerEvents: "none",
        padding: "1px 8px",
        borderRadius: "999px",
        font: "600 11px/1.5 system-ui, sans-serif",
        whiteSpace: "nowrap",
        background: c.colour,
        color: tagTextColour(c.colour),
        boxShadow: "0 1px 3px rgba(0,0,0,.3)",
        display: "none",
        zIndex: "5",
      });
      o.tagHost.appendChild(el);
      tags.set(c.id, el);
    }
    disposers.push(() => {
      for (const el of tags.values()) el.remove();
    });
  }

  // worker hat + vest and mover boxes (model space, same matrix as the body)
  const hatGeo = own(
    new THREE.SphereGeometry(0.17, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.6, 0),
  );
  const vestGeo = own(
    new THREE.CylinderGeometry(0.2, 0.19, 0.42, 12, 1, true).translate(0, 1.18, 0),
  );
  const boxGeo = own(new THREE.BoxGeometry(0.42, 0.34, 0.42).translate(0, 1.0, 0.3));
  const hats = own(
    new THREE.InstancedMesh(
      hatGeo,
      own(
        new THREE.MeshStandardMaterial({ color: DEVSIM_COLOURS.castHelmetYellow, roughness: 0.35 }),
      ),
      WORKERS,
    ),
  );
  const vests = own(
    new THREE.InstancedMesh(
      vestGeo,
      own(
        new THREE.MeshStandardMaterial({
          color: DEVSIM_COLOURS.castVestOrange,
          roughness: 0.6,
          emissive: DEVSIM_COLOURS.castVestOrange,
          emissiveIntensity: 0.15,
          side: THREE.DoubleSide,
        }),
      ),
      WORKERS,
    ),
  );
  const boxes = own(
    new THREE.InstancedMesh(
      boxGeo,
      own(new THREE.MeshStandardMaterial({ color: DEVSIM_COLOURS.castSkinTan, roughness: 0.8 })),
      MOVERS,
    ),
  );
  hats.name = "devsim-worker-hats";
  vests.name = "devsim-worker-vests";
  boxes.name = "devsim-mover-boxes";
  for (const m of [hats, vests, boxes]) {
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = true;
    m.raycast = NOOP;
    group.add(m);
  }

  let kit: CrowdKit | null = null;
  let crowd: CrowdRenderer | null = null;
  let workerHasLook = false;
  let wkit: CrowdKit | null = null;
  let wcrowd: CrowdRenderer | null = null;
  const firstWorker = slots.indexOf("worker0");
  let bodies: CrowdBody[] = [];
  let poses = new Map<string, CastPose>();
  let t = 0;
  let cam: THREE.Vector3 | null = null;
  const pts: [number, number, number][] = slots.map(() => [Number.NaN, 0, 0]);

  const lookFor = (k: CrowdKit, ids: string[], body: CrowdBody): number => {
    for (const id of ids) {
      const i = k.lookIndex.get(id);
      if (i !== undefined) return i;
    }
    const i = k.manifest.looks.findIndex((l) => l.body === body && !l.prop);
    return Math.max(0, i);
  };

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _y = new THREE.Vector3(0, 1, 0);

  const personBox = (id: string) => {
    const p = poses.get(id);
    if (!p) return null;
    const k = cam ? peopleScale(Math.hypot(p.x - cam.x, cam.y, p.z - cam.z)) : 1.55;
    const body = CAST_LOOKS[id]?.body;
    const h = (body === "child" ? 1.1 : body?.startsWith("older") ? 1.62 : 1.72) * k;
    return { x: p.x, z: p.z, h };
  };

  const draw = () => {
    let nh = 0;
    let nb = 0;
    for (const [i, id] of slots.entries()) {
      const p = poses.get(id);
      const pt = pts[i] as [number, number, number];
      const ring = rings.get(id);
      if (!p) {
        pt[0] = Number.NaN;
        crowd?.hide(i);
        if (wcrowd && firstWorker >= 0 && i >= firstWorker) wcrowd.hide(i - firstWorker);
        if (ring) ring.visible = false;
        continue;
      }
      pt[0] = p.x;
      pt[1] = 1;
      pt[2] = p.z;
      const d = cam ? Math.hypot(p.x - cam.x, cam.y, p.z - cam.z) : 50;
      const k = id === "kid" ? peopleScale(d) * 0.9 : peopleScale(d);
      if (ring) {
        ring.visible = true;
        ring.position.set(p.x, 0.06, p.z);
        ring.scale.setScalar(k / 1.55);
      }
      _m.compose(_p.set(p.x, 0.08, p.z), _q.setFromAxisAngle(_y, p.yaw), _s.set(k, k, k));
      const isWorker = id.startsWith("worker");
      if (isWorker && wcrowd && wkit) {
        crowd?.hide(i);
        const clip = (p.walk ? wkit.clips.adult_man.walk : wkit.clips.adult_man.idle) ?? null;
        if (clip) {
          const phase = (t / Math.max(0.1, clip.duration) + i * 0.137) % 1;
          const f = framePair(phase, clip.frames);
          wcrowd.set(i - firstWorker, d < 60 ? 0 : 1, _m, clip.row + f.f0, clip.row + f.f1, f.t);
        }
        continue;
      }
      // hat and vest only on a drawn worker body (never floating alone while the kit loads)
      if (isWorker && !workerHasLook && crowd && kit) {
        hats.setMatrixAt(nh, _m);
        vests.setMatrixAt(nh, _m);
        nh++;
      }
      const mi = id.startsWith("mover") ? Number(id.slice(5)) : -1;
      if (mi >= 0 && mi % 2 === 0 && t < 44) boxes.setMatrixAt(nb++, _m);
      if (crowd && kit) {
        const body = bodies[i] as CrowdBody;
        const clips = kit.clips[body];
        const clip = (p.walk ? clips.walk : clips.idle) ?? clips.idle ?? clips.walk;
        if (!clip) {
          crowd.hide(i);
          continue;
        }
        const phase = (t / Math.max(0.1, clip.duration) + i * 0.137) % 1;
        const f = framePair(phase, clip.frames);
        crowd.set(i, d < 60 ? 0 : 1, _m, clip.row + f.f0, clip.row + f.f1, f.t);
      }
    }
    hats.count = nh;
    vests.count = nh;
    boxes.count = nb;
    for (const m of [hats, vests, boxes]) m.instanceMatrix.needsUpdate = true;
    crowd?.commit();
    wcrowd?.commit();
  };

  return {
    group,
    poseOf: (id) => poses.get(id) ?? null,
    setWorkerKit(k) {
      if (wcrowd) {
        group.remove(wcrowd.group);
        wcrowd.dispose();
        wcrowd = null;
      }
      wkit = k;
      if (!k || firstWorker < 0) {
        draw();
        return;
      }
      wcrowd = createCrowdRenderer(
        k,
        Array.from({ length: WORKERS }, () => 0),
      );
      wcrowd.group.name = "devsim-workers";
      for (const m of wcrowd.meshes) m.castShadow = true;
      for (let i = 0; i < WORKERS; i++) wcrowd.hide(i);
      group.add(wcrowd.group);
      draw();
    },
    setKit(k) {
      if (crowd) {
        group.remove(crowd.group);
        crowd.dispose();
        crowd = null;
      }
      kit = k;
      if (!k) return;
      const looks = slots.map((id) => {
        const spec = CAST_LOOKS[id];
        if (spec) return lookFor(k, spec.looks, spec.body);
        if (id.startsWith("mover")) {
          const n = Number(id.slice(5));
          return lookFor(
            k,
            [MOVER_LOOKS[n % MOVER_LOOKS.length] as string],
            n % 2 ? "adult_woman" : "adult_man",
          );
        }
        // workers: the ASSETS lane's worker look when the kit has one, else the adult man
        const worker = k.manifest.looks.findIndex((l) => l.id.includes("worker"));
        workerHasLook = worker >= 0;
        return worker >= 0 ? worker : lookFor(k, [WORKER_FALLBACK], "adult_man");
      });
      bodies = looks.map((li) => (k.manifest.looks[li]?.body ?? "adult_man") as CrowdBody);
      crowd = createCrowdRenderer(k, looks);
      crowd.group.name = "devsim-cast-crowd";
      for (const m of crowd.meshes) m.castShadow = true;
      for (let i = 0; i < slots.length; i++) crowd.hide(i);
      group.add(crowd.group);
      draw();
    },
    update({ s, t: tt }: DevsimFrame) {
      t = tt;
      speaker = s.bubbles[0]?.who ?? null;
      glowK = speaker ? speakerGlow(s.sun) : 0;
      poses = castAt(tt, g, {
        workersActive: s.workersActive,
        ...(o.flowT ? { flowT: o.flowT(tt) } : {}),
      });
      draw();
    },
    people: () => pts,
    personBox,
    project(camera, size) {
      const moved = !cam || cam.distanceToSquared(camera.position) > 1e-4;
      cam = (cam ?? new THREE.Vector3()).copy(camera.position);
      if (moved) draw(); // display scale follows the camera distance
      const sb = speaker && glowK > 0.01 ? personBox(speaker) : null;
      if (sb) {
        // a metre behind the speaker from the camera: the body stands in front of the light
        const dx = sb.x - camera.position.x;
        const dz = sb.z - camera.position.z;
        const l = Math.hypot(dx, dz) || 1;
        glow.position.set(sb.x + dx / l, sb.h * 0.55, sb.z + dz / l);
        glow.scale.set(sb.h * 0.85, sb.h * 1.35, 1);
        glowMat.opacity = glowK;
        glow.visible = true;
      } else glow.visible = false;
      for (const [id, el] of tags) {
        const p = poses.get(id);
        const box = p ? personBox(id) : null;
        const d = p
          ? Math.hypot(p.x - camera.position.x, camera.position.y, p.z - camera.position.z)
          : 1e9;
        const sp =
          box && d < TAG_RANGE_M ? toScreen(camera, size, box.x, box.h + 0.6, box.z) : null;
        if (!sp || sp[0] < 0 || sp[1] < 0 || sp[0] > size[0] || sp[1] > size[1]) {
          if (el.style.display !== "none") el.style.display = "none";
          continue;
        }
        el.style.display = "";
        el.style.transform = `translate(${sp[0].toFixed(1)}px, ${sp[1].toFixed(1)}px) translate(-50%, -100%)`;
      }
    },
    dispose() {
      if (crowd) crowd.dispose();
      crowd = null;
      wcrowd?.dispose();
      wcrowd = null;
      for (const d of disposers) d();
      disposers.length = 0;
      group.clear();
    },
  };
}
