import * as THREE from "three";
import { useDevsimAnchors } from "../../../devsim/anchors";
import { BUILD_CAM_KEYS, type CamKey } from "../../../devsim/timeline";
import type { DevelopmentPlan, Probe, Rect, StateAt } from "../../../devsim/types";
import { setTreeCut } from "../assets/treeCut";
import type { Clearance } from "../clearance";
import type { DevsimOverlay } from "../engine";
import type { LocalFrame } from "../frame";
import { cameraRangeM, devsimAoWeight } from "./devsimView";
import { dayness } from "./ease";
import { inRing, type SiteGeom, siteGeom, TOWER_STOREY_M } from "./geom";
import { onStage, screenRect, toScreen } from "./project";
import { craneAt, moveInAoKeep, type SetPiecesAt, setPiecesAt, setPieceTiming } from "./setPieces";
import { stateAt } from "./state";

/** The subject of a 45 s plan camera beat (`buildSubject`). */
export type BuildSubject = "site" | "halim" | "tower" | "farid" | "door";

/**
 * Pure: the 45 s plan's beat subjects from its camera keys (`BUILD_CAM_KEYS`), as the times each
 * subject starts: the opening key frames the site's ground, a key aimed at Halim's mid point is
 * Halim, Farid's is Farid, a key `path` metres out from the door is the door, any other is the
 * tower. One source with the camera, so a key moved in `timeline.ts` moves the subject too.
 */
export function buildSubjectBreaks(
  keys: readonly CamKey[] = BUILD_CAM_KEYS,
): { t: number; subject: BuildSubject }[] {
  const kind = (k: CamKey, i: number): BuildSubject => {
    if (i === 0) return "site";
    const a = k.targetAnchor;
    if (typeof a === "string")
      return a === "farid" ? "farid" : a === "halimMid" ? "halim" : "tower";
    if ("path" in a) return "door";
    return a.lerp.includes("halimMid") ? "halim" : a.lerp.includes("farid") ? "farid" : "tower";
  };
  const out: { t: number; subject: BuildSubject }[] = [];
  keys.forEach((k, i) => {
    const subject = kind(k, i);
    if (out.at(-1)?.subject !== subject) out.push({ t: k.t, subject });
  });
  return out;
}

/** Pure: the subject at screen time t (the last break at or before t). */
export function buildSubjectAt(
  t: number,
  breaks: readonly { t: number; subject: BuildSubject }[] = BUILD_SUBJECT_BREAKS,
): BuildSubject {
  let sub: BuildSubject = breaks[0]?.subject ?? "site";
  for (const b of breaks) if (t >= b.t) sub = b.subject;
  return sub;
}

const BUILD_SUBJECT_BREAKS = buildSubjectBreaks();

/** Everything a part needs for one frame. */
export interface DevsimFrame {
  s: StateAt;
  /** Screen seconds. */
  t: number;
  /** 0 by day, 1 at night (from the sun elevation). */
  night: number;
  /** Construction set pieces at t (`setPieces.ts`); the layer always sets it, tests may leave it out. */
  sp?: SetPiecesAt;
}

/** A piece of the devsim scene (tower, site kit, cast): posed from the frame state. */
export interface DevsimPart {
  group: THREE.Object3D;
  update(f: DevsimFrame): void;
  /** World points of the people this part draws now (probe samples). */
  people?(): readonly (readonly [number, number, number])[];
  /** World points of the vehicles this part draws now. */
  vehicles?(): readonly (readonly [number, number, number])[];
  /** The world box (feet to head) of a Spotlight Resident shown now, by cast id. */
  personBox?(id: string): { x: number; z: number; h: number } | null;
  /** Objects the AO pass must leave out (additive glows, translucent paint). */
  aoExcluded?(): readonly THREE.Object3D[];
  /** Per-frame screen work (name tags). */
  project?(camera: THREE.Camera, size: readonly [number, number]): void;
  /** Fields for `window.__tl.demo.state()` ("bld"; spec §7, AC-W3/W4). */
  demoState?(): object;
  dispose(): void;
}

/** The tower part's extra reads (the tower rect and Q4). */
export interface TowerPart extends DevsimPart {
  /** Height of the drawn tower top (0 before the first floor). */
  topM(): number;
  /** The window-lit share actually applied to the tower windows. */
  litFraction(): number;
}

export interface DevsimLayer extends DevsimOverlay {
  readonly plan: DevelopmentPlan;
  readonly geom: SiteGeom;
  /** Poses everything for screen time t (reads the timeline once). */
  setT(t: number): void;
  /** The state last applied (null before the first setT). */
  state(): StateAt | null;
  add(part: DevsimPart): void;
  setTower(part: TowerPart | null): void;
  /** The drawn tower top now (0 without floors). */
  towerTopM(): number;
  /** The scene part of `window.__devsim.probe()`. */
  probe(): SceneProbe;
  /** Every part's demo-hook fields merged (`registerDemoState("bld", …)`). */
  demoState(): Record<string, unknown>;
}

export interface DevsimLayerOpts {
  plan: DevelopmentPlan;
  frame: LocalFrame;
  /** The plan's closed edge from the walk layer (lon/lat), when found. */
  closedEdge?: number[][] | null;
  /** The drawn streets (lon/lat centrelines and widths): the school-run queue's lane follows them. */
  roads?: readonly { coords: readonly (readonly number[])[]; widthM: number }[] | null;
  /** The city's drawn-building grid (cameraInsideBuilding). */
  clearance?: () => Clearance | null;
  /** Decorative flow samples (world points) from the motion layer, for the probe. */
  flowSamples?: () => {
    people: readonly (readonly [number, number, number])[];
    vehicles: readonly (readonly [number, number, number])[];
  } | null;
  /** Rolling average fps, for the probe. */
  fps?: () => number | undefined;
  /** Write anchors to `useDevsimAnchors` (default true). */
  anchors?: boolean;
}

/** The scene part of the probe. */
export type SceneProbe = Partial<Probe>;

/** Max points per kind in a probe sample (far above the slots; only a runaway guard). */
const PROBE_MAX = 20000;
/** The decorative occluder cut runs for speakers within this camera distance. */
const CUT_RANGE_M = 260;
/** It stops this far short of the speaker's chest (cut radius 1.8 m, so ~1 m clear of them). */
const CUT_STOP_M = 2.8;
/** The Brief's site label shows until Construction starts (screen s). */
const SITE_LABEL_UNTIL = 4;
/** The hypothetical label's box (FE `HypotheticalLabel`, about 300 x 52 px) and a margin. */
const LABEL_W = 300;
const LABEL_H = 52;
const LABEL_MARGIN = 8;

/**
 * True when the label (hung above `p`, bottom centre) fits inside the stage; otherwise the anchor
 * is withheld and the overlay places the label itself (AC-H3: on stage whenever the tower is).
 */
export function labelFits(p: [number, number] | null, size: readonly [number, number]): boolean {
  return (
    !!p &&
    p[1] >= LABEL_H + LABEL_MARGIN &&
    p[1] <= size[1] - LABEL_MARGIN &&
    p[0] >= LABEL_W / 2 + LABEL_MARGIN &&
    p[0] <= size[0] - LABEL_W / 2 - LABEL_MARGIN
  );
}

/**
 * The Development Simulation scene (spec §5.3 Scene): a group in the main scene holding the tower,
 * the construction kit and the cast, posed from `stateAt(t)`; every frame (engine `beforeRender`)
 * it projects the screen anchors the DOM overlays follow (`useDevsimAnchors`) and keeps the probe
 * sample. Decorative: nothing here is a fact.
 */
export function createDevsimLayer(o: DevsimLayerOpts): DevsimLayer {
  const geom = siteGeom(o.plan, o.frame, o.closedEdge, o.roads);
  // warm the per-plan set piece tables (crane slew) now, not on the first played frame
  craneAt(o.plan, 0);
  const group = new THREE.Group();
  group.name = "devsim";
  group.userData.decorative = true;
  const parts: DevsimPart[] = [];
  let tower: TowerPart | null = null;
  let s: StateAt | null = null;
  let t = 0;
  // this frame's view for the on-demand probe
  const view = new THREE.PerspectiveCamera();
  const viewSize: [number, number] = [1, 1];
  let seen = false;
  let renderedT = Number.NaN;
  let lastTower: Rect | null = null;
  let lastSpeaker: Rect | null = null;
  let lastWho: string | null = null;
  let lastHeadOnStage = false;
  // the footprint's corners at the ground and the top (tops updated in place)
  const corners: [number, number, number][] = geom.ring.flatMap(
    ([x, z]): [number, number, number][] => [
      [x, 0, z],
      [x, 1, z],
    ],
  );
  const box: [number, number, number][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  let cutOn = false;
  /** Decorative occluders between the camera and a speaker are cut (null: off). */
  const cutTo = (cam: THREE.Vector3, chest: [number, number, number] | null) => {
    const dx = chest ? cam.x - chest[0] : 0;
    const dy = chest ? cam.y - chest[1] : 0;
    const dz = chest ? cam.z - chest[2] : 0;
    const d = Math.hypot(dx, dy, dz);
    if (!chest || d > CUT_RANGE_M || d < CUT_STOP_M + 1) {
      if (cutOn) setTreeCut(null);
      cutOn = false;
      return;
    }
    // stop short of the speaker so the cut never takes the speaker (the cast is decorative crowd)
    const k = CUT_STOP_M / d;
    setTreeCut({
      a: [cam.x, cam.y, cam.z],
      b: [chest[0] + dx * k, chest[1] + dy * k, chest[2] + dz * k],
    });
    cutOn = true;
  };
  let disposed = false;
  const siteCentre = (camera: THREE.Camera, size: readonly [number, number]) =>
    toScreen(camera, size, geom.centre[0], 1, geom.centre[1]);
  const onStageOrNull = (p: [number, number] | null, size: readonly [number, number]) =>
    onStage(p, size) ? p : null;

  /**
   * Instanced meshes with no instances still cost a draw call per pass (C10p): hidden for the
   * render, and shown again before parts pose the next frame, so a part's own `visible` is kept.
   */
  const emptyHidden: THREE.Object3D[] = [];
  const restoreEmpty = () => {
    for (const m of emptyHidden) m.visible = true;
    emptyHidden.length = 0;
  };
  const hideEmpty = (root: THREE.Object3D) => {
    if (!root.visible) return;
    const m = root as THREE.InstancedMesh;
    if (m.isInstancedMesh && m.count === 0) {
      m.visible = false;
      emptyHidden.push(m);
      return;
    }
    for (const c of root.children) hideEmpty(c);
  };

  const apply = () => {
    if (!s) return;
    restoreEmpty();
    const f: DevsimFrame = {
      s,
      t,
      night: 1 - dayness(s.sun.elevation),
      sp: setPiecesAt(o.plan, t, s),
    };
    for (const p of parts) p.update(f);
  };

  const insideBuilding = (cam: THREE.Vector3): boolean => {
    const c = o.clearance?.();
    if (c && c.topAt(cam.x, cam.z) > cam.y) return true;
    const top = tower?.topM() ?? 0;
    return top > 0 && cam.y < top && inRing(geom.ring, cam.x, cam.z);
  };

  const speakerOf = (st: StateAt) => st.bubbles[0]?.who ?? null;

  const personAt = (id: string): [number, number, number] | null => {
    for (const p of parts) {
      const b = p.personBox?.(id);
      if (b) return [b.x, b.h * 0.6, b.z];
    }
    return null;
  };
  const door: [number, number, number] = [
    geom.door[0] + geom.out[0] * 5,
    1.5,
    geom.door[1] + geom.out[1] * 5,
  ];
  /**
   * The 45 s plan's beat subject (`timeline.ts` BUILD_CAM_KEYS): the site, Halim on the detour,
   * the tower (lorry route, Raya hold), Farid, the tower again (monsoon, the worker beside it,
   * topping out), the door for the move-in, and the tower in the Daily Life wide shot.
   */
  const buildSubject = (
    tt: number,
    towerMid: [number, number, number],
  ): [number, number, number] => {
    switch (buildSubjectAt(tt)) {
      case "site":
        return [geom.centre[0], 0, geom.centre[1]];
      case "halim":
        return personAt("halim") ?? towerMid;
      case "farid":
        return personAt("farid") ?? [geom.farid[0], 1, geom.farid[1]];
      case "door":
        return door;
      default:
        return towerMid;
    }
  };
  /**
   * The world centre of the spec §4.4 subject of the camera beat at t (QA lane request: probe
   * `subject`): site, yard, tower, Halim, Farid, entrance, Mei Ling at the junction, Zainab, Arjun,
   * and the tower again for the wide shots.
   */
  const build = setPieceTiming(o.plan).mode === "schedule";
  const subjectWorld = (tt: number): [number, number, number] | null => {
    const top = Math.max(tower?.topM() ?? 0, TOWER_STOREY_M);
    const towerMid: [number, number, number] = [geom.centre[0], top / 2, geom.centre[1]];
    if (build) return buildSubject(tt, towerMid);
    if (tt < 3.6) return [geom.centre[0], 0, geom.centre[1]];
    // the yard's work area: the crew between the stacks (30 m behind the tower) and its foot
    if (tt < 10.4) return [geom.centre[0] - geom.out[0] * 18, 3, geom.centre[1] - geom.out[1] * 18];
    if (tt < 17.2) return towerMid;
    if (tt < 22.8) return personAt("halim") ?? towerMid;
    if (tt < 28) return personAt("farid") ?? [geom.farid[0], 1, geom.farid[1]];
    if (tt < 34.6) return towerMid;
    if (tt < 47) {
      const d = 5;
      return [geom.door[0] + geom.out[0] * d, 1.5, geom.door[1] + geom.out[1] * d];
    }
    if (tt < 52.8)
      return (
        personAt("meiling") ?? [
          geom.node[0] + (geom.junction[0] - geom.node[0]) * 0.45,
          1,
          geom.node[1] + (geom.junction[1] - geom.node[1]) * 0.45,
        ]
      );
    if (tt < 58) return personAt("zainab") ?? [geom.park[0], 1, geom.park[1]];
    if (tt < 63.6) return personAt("arjun") ?? [geom.mall[0], 1, geom.mall[1]];
    return towerMid;
  };

  return {
    group,
    plan: o.plan,
    geom,
    setT(next) {
      if (disposed) return;
      t = Number.isFinite(next) ? next : 0;
      s = stateAt(t, o.plan);
      apply();
    },
    state: () => s,
    towerTopM: () => tower?.topM() ?? 0,
    add(part) {
      parts.push(part);
      group.add(part.group);
      if (s) apply();
    },
    setTower(part) {
      if (tower) {
        const i = parts.indexOf(tower);
        if (i >= 0) parts.splice(i, 1);
        group.remove(tower.group);
        tower.dispose();
      }
      tower = part;
      if (part) this.add(part);
    },
    beforeRender(camera, size) {
      if (disposed || !s) return;
      restoreEmpty();
      for (const p of parts) p.project?.(camera, size);
      const top = tower?.topM() ?? 0;
      if (top > 0) for (const c of corners) if (c[1] !== 0) c[1] = top;
      const towerRect: Rect | null = top > 0 ? screenRect(camera, size, corners) : null;
      const topPt =
        top > 0 ? toScreen(camera, size, geom.centre[0], top + 6, geom.centre[1]) : null;
      const who = speakerOf(s);
      let speaker: Rect | null = null;
      let head: [number, number] | null = null;
      let chest: [number, number, number] | null = null;
      const others: { id: string; rect: Rect; head: [number, number] }[] = [];
      // every speaker of a bubble shown now, so each bubble anchors at its own speaker
      const speaking = new Set(s.bubbles.map((x) => x.who));
      const speakers: { id: string; rect: Rect; head: [number, number] | null }[] = [];
      for (const c of o.plan.cast) {
        for (const p of parts) {
          const b = p.personBox?.(c.id);
          if (!b) continue;
          const r = 0.5;
          box[0] = [b.x - r, 0, b.z - r];
          box[1] = [b.x + r, 0, b.z + r];
          box[2] = [b.x - r, b.h, b.z + r];
          box[3] = [b.x + r, b.h, b.z - r];
          const rect = screenRect(camera, size, box);
          const hp = toScreen(camera, size, b.x, b.h + 0.3, b.z);
          if (c.id === who) {
            speaker = rect;
            head = hp;
            chest = [b.x, b.h * 0.6, b.z];
          }
          if (speaking.has(c.id)) {
            if (rect) speakers.push({ id: c.id, rect, head: hp });
          } else if (rect && hp && onStage(hp, size)) others.push({ id: c.id, rect, head: hp });
          break;
        }
      }
      // The speaker is never hidden by a decorative street tree, car or prop: the shared decorative
      // occluder cut (journey cutaway, `treeCut.ts`) from the camera to just short of them.
      cutTo(camera.position, chest);
      const shownTop = onStage(topPt, size) ? topPt : null;
      if (o.anchors !== false)
        useDevsimAnchors.getState().set({
          tower: towerRect,
          towerTop: shownTop,
          speaker,
          speakerHead: speaker ? head : null,
          speakers,
          labelPoint: labelFits(topPt, size) ? topPt : null,
          siteLabel: t < SITE_LABEL_UNTIL ? onStageOrNull(siteCentre(camera, size), size) : null,
          others,
        });
      // the probe is computed on demand from this frame's camera (`probe()`)
      view.matrixWorldInverse.copy(camera.matrixWorldInverse);
      view.projectionMatrix.copy(camera.projectionMatrix);
      view.position.copy(camera.position);
      viewSize[0] = size[0];
      viewSize[1] = size[1];
      seen = true;
      renderedT = t;
      lastTower = towerRect;
      lastSpeaker = speaker;
      lastWho = who;
      lastHeadOnStage = !!speaker && onStage(head, size);
      hideEmpty(group);
    },
    aoExcluded: () => parts.flatMap((p) => p.aoExcluded?.() ?? []),
    // One range source (C10p review minor): the beat camera's range, the same number the
    // small-prop shadows switch on (`smallShadows`), so both change on the same frame; the
    // engine's measured range only before the first frame state. Off through the 45 s move-in
    // (AC-P2, `SET_PIECE_S.moveInAoOff`).
    aoWeight: (rangeM) =>
      devsimAoWeight(s ? cameraRangeM(s) : rangeM) * moveInAoKeep(setPieceTiming(o.plan), t),
    demoState() {
      const out: Record<string, unknown> = {};
      for (const p of parts) if (p.demoState) Object.assign(out, p.demoState());
      // the bubble's speaker in the last rendered frame: drawn (anchored bubble) and head on stage
      out.speaker = lastWho
        ? { who: lastWho, anchored: !!lastSpeaker, headOnStage: lastHeadOnStage }
        : null;
      return out;
    },
    probe() {
      if (!seen || !s) return {};
      // One entry per agent in a stable order (index i is the same agent in every frame); an agent
      // not drawn now, or behind the camera, is [-1, -1] (QA lane request). No cap below the slots.
      const people: [number, number][] = [];
      const vehicles: [number, number][] = [];
      const push = (
        out: [number, number][],
        pts: readonly (readonly [number, number, number])[] | undefined,
      ) => {
        if (!pts) return;
        for (const p of pts) {
          if (out.length >= PROBE_MAX) return;
          const q = Number.isFinite(p[0]) ? toScreen(view, viewSize, p[0], p[1], p[2]) : null;
          out.push(q ? [Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10] : [-1, -1]);
        }
      };
      for (const p of parts) {
        push(people, p.people?.());
        push(vehicles, p.vehicles?.());
      }
      const flow = o.flowSamples?.();
      push(people, flow?.people);
      push(vehicles, flow?.vehicles);
      const sw = subjectWorld(t);
      const sp = sw ? toScreen(view, viewSize, sw[0], sw[1], sw[2]) : null;
      const rects: Probe["rects"] = {};
      if (lastTower) rects.tower = lastTower;
      if (lastSpeaker) rects.speaker = lastSpeaker;
      const fps = o.fps?.();
      return {
        rects,
        people,
        vehicles,
        cameraInsideBuilding: insideBuilding(view.position),
        windowsLitFraction: tower?.litFraction() ?? 0,
        ...(sp ? { subject: { x: sp[0], y: sp[1] } } : {}),
        renderedT,
        ...(fps !== undefined ? { fps } : {}),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const p of parts) p.dispose();
      parts.length = 0;
      tower = null;
      group.clear();
      if (o.anchors !== false) useDevsimAnchors.getState().clear();
      if (cutOn) setTreeCut(null);
    },
  };
}

export { TOWER_STOREY_M };
