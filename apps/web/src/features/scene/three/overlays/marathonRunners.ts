import * as THREE from "three";
import type { MarathonResult } from "../../../closures/closureSimModel";
import { DRESSING_STYLE } from "../../../closures/courseDressing";
import {
  detourTag,
  followedTrip,
  revealAt,
  type ShotId,
  shotAt,
} from "../../../closures/marathonCinematic";
import { carsAt, PLAY_STYLE, RUNNERS, runnersAt } from "../../../closures/marathonPlay";
import type { LonLat } from "../../geo";
import type { LocalFrame } from "../frame";
import { lineToLocal } from "../routeLine";
import type { OverlayChild } from "./accessLayers";
import { createLineBatch } from "./lines";
import { tagScale, tagSprite } from "./marathonCourse";
import { MARKER_ORDER } from "./markers";

/** Dot sizes in CSS pixels (constant on screen, so the playback reads at any zoom). */
export const RUNNER_PX = 11;
export const CAR_PX = 12;
const LIFT_M = 0.9; // low: a lifted dot drifts off its road in the close follow shots
const BEFORE_LIFT_M = 0.7;
const RIBBON_LIFT_M = 0.8;
/** A followed subject's tag floats this high (over a displayed person, ~2.7 m tall). */
const TAG_LIFT_M = 2.8;

const VERT = `uniform float uSize;
void main() {
  gl_PointSize = uSize;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
/** Round dots with a dark edge (runners), or rounded squares (cars). */
const FRAG = `uniform vec3 uColor;
uniform vec3 uEdge;
uniform float uRound;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = mix(max(abs(p.x), abs(p.y)), length(p), uRound);
  if (d > 0.5) discard;
  gl_FragColor = vec4(d > 0.36 ? uEdge : uColor, 1.0);
}`;

function dots(n: number, color: string, px: number, round: boolean) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uSize: { value: px * dpr },
      uColor: { value: new THREE.Color(color) },
      uEdge: { value: new THREE.Color(PLAY_STYLE.runnerEdge) },
      uRound: { value: round ? 1 : 0 },
    },
    depthTest: false,
    depthWrite: false,
    // the transparent pass: drawn after the (transparent) course lines by renderOrder, so a dot on
    // the ribbon is never painted over
    transparent: true,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; // positions move every frame
  points.renderOrder = MARKER_ORDER.labels - 2; // over the course line, under labels
  return points;
}

/** A suggestion tag at a place on the map (`suggestionRoad` → that road's first stretch). */
export interface PlayTag {
  text: string;
  at: LonLat;
}

/** Which tags show in which shots. */
const LEAD_SHOTS: ReadonlySet<ShotId> = new Set(["dive", "run"]);
const CAR_SHOTS: ReadonlySet<ShotId> = new Set(["cut", "car", "pull"]);
const SUGGESTION_SHOTS: ReadonlySet<ShotId> = new Set(["car", "pull"]);

/**
 * T-028 / T-031 "Watch the marathon" on the Stylised map, following the cinematic's clock
 * (`getT()`, screen seconds): the course ribbon draws itself from the start, runners move along
 * the engine's course line, one sample car per rerouted trip drives its after-closure route (the
 * followed one with its before route as a grey ghost), and tags anchored in 3D name the lead
 * runner, the detour (the engine's median numbers) and where a suggestion applies. Display only:
 * decorative numbers and speeds, never crowd sizes, vehicle counts or delays.
 */
export function createMarathonRunners(
  m: MarathonResult,
  frame: LocalFrame,
  getT: () => number,
  opts: { tags?: readonly PlayTag[]; makeCanvas?: () => HTMLCanvasElement } = {},
): OverlayChild & {
  positions(): { runners: number; cars: number; ribbon: number; tags: string[] };
  /** Hides the dots once 3D runners / cars are drawn; each stays as the fallback without its kit. */
  setDotsVisible(v: { runners: boolean; cars: boolean }): void;
} {
  const makeCanvas = opts.makeCanvas ?? (() => document.createElement("canvas"));
  const group = new THREE.Group();
  group.name = "marathon-play";
  const disposables: { dispose(): void }[] = [];
  const course = m.animation.course_coordinates;
  const trips = m.animation.rerouted_trips ?? [];
  const followed = followedTrip(m);
  const runners = dots(RUNNERS, PLAY_STYLE.runner, RUNNER_PX, true);
  const cars = dots(Math.max(trips.length, 1), PLAY_STYLE.car, CAR_PX, false);

  // the course ribbon: a soft glow and a bright core that draw themselves in (segment count)
  const courseLocal = lineToLocal(course as LonLat[], frame, 0);
  const segs = Math.max(0, courseLocal.length / 3 - 1);
  const ribbon = [
    createLineBatch(
      [courseLocal],
      { color: PLAY_STYLE.runner, widthPx: 16, opacity: 0.35 },
      RIBBON_LIFT_M,
      MARKER_ORDER.labels - 5,
    ),
    createLineBatch(
      [courseLocal],
      { color: PLAY_STYLE.runner, widthPx: 5 },
      RIBBON_LIFT_M,
      MARKER_ORDER.labels - 4,
    ),
  ];
  group.add(...ribbon);
  // the followed car's route before the closure: a grey ghost
  if (followed) {
    const before = lineToLocal(followed.before_coordinates as LonLat[], frame, 0);
    if (before.length >= 6)
      group.add(
        createLineBatch(
          [before],
          {
            color: PLAY_STYLE.before,
            widthPx: 5,
            opacity: 0.85,
            dash: { sizePx: 14, pattern: 0xff00 },
          },
          BEFORE_LIFT_M,
          MARKER_ORDER.labels - 3,
        ),
      );
  }
  group.add(runners, cars);

  type Tag = { sprite: THREE.Sprite; shots: ReadonlySet<ShotId>; follow?: "lead" | "car" };
  const tags: Tag[] = [];
  const addTag = (text: string, bg: string, shots: ReadonlySet<ShotId>, follow?: Tag["follow"]) => {
    const t = tagSprite(text, bg, DRESSING_STYLE.tagText, makeCanvas, 1);
    disposables.push(...t.disposables);
    t.sprite.visible = false;
    group.add(t.sprite);
    const tag: Tag = { sprite: t.sprite, shots, follow };
    tags.push(tag);
    return tag;
  };
  addTag("Lead runner", DRESSING_STYLE.kmBg, LEAD_SHOTS, "lead");
  const detour = detourTag(m);
  if (followed && detour) addTag(detour, PLAY_STYLE.car, CAR_SHOTS, "car");
  for (const s of opts.tags ?? []) {
    const tag = addTag(s.text, DRESSING_STYLE.tagBg, SUGGESTION_SHOTS);
    const [x, z] = frame.toLocal(s.at[0], s.at[1]);
    tag.sprite.position.set(x, LIFT_M, z);
  }

  let shown = { runners: 0, cars: 0, ribbon: 0, tags: [] as string[] };
  let res: [number, number] = [1, 1];
  let fov = 40;

  const place = (points: THREE.Points, at: [number, number][]) => {
    const attr = points.geometry.getAttribute("position") as THREE.BufferAttribute;
    at.forEach(([lon, lat], i) => {
      const [x, z] = frame.toLocal(lon, lat);
      attr.setXYZ(i, x, LIFT_M, z);
    });
    points.geometry.setDrawRange(0, at.length);
    attr.needsUpdate = true;
    return at.length;
  };
  const update = () => {
    const t = getT();
    const shot = shotAt(t).id;
    const drawn = Math.round(segs * revealAt(t));
    for (const b of ribbon)
      ((b as THREE.Mesh).geometry as THREE.InstancedBufferGeometry).instanceCount = drawn;
    const run = runnersAt(course, t);
    const car = carsAt(trips, t);
    for (const tag of tags) {
      tag.sprite.visible = tag.shots.has(shot);
      const at = tag.follow === "lead" ? run[0] : tag.follow === "car" ? car[0] : undefined;
      if (at) {
        const [x, z] = frame.toLocal(at[0], at[1]);
        tag.sprite.position.set(x, TAG_LIFT_M, z); // above a 3D runner's head or the car
      }
      tagScale(tag.sprite, fov, res[1]);
    }
    shown = {
      runners: place(runners, run),
      cars: place(cars, car),
      ribbon: drawn,
      tags: tags.filter((x) => x.sprite.visible).map((x) => x.sprite.userData.text as string),
    };
  };
  update();

  return {
    group,
    setView(_cam, _now, fovDeg) {
      if (fovDeg) fov = fovDeg;
      update();
    },
    setResolution(w, h) {
      res = [w, h];
      group.traverse((o) => {
        const mat = (o as THREE.Mesh).material as { resolution?: THREE.Vector2 } | undefined;
        mat?.resolution?.set(w, h);
      });
    },
    positions: () => shown,
    setDotsVisible(v) {
      runners.visible = v.runners;
      cars.visible = v.cars;
    },
    dispose() {
      for (const d of disposables) d.dispose();
      group.traverse((o) => {
        if (o instanceof THREE.Sprite) return;
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        (mesh.material as THREE.Material | undefined)?.dispose?.();
      });
    },
  };
}
