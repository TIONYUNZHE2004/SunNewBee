import * as THREE from "three";
import type { MarathonResult } from "../../../closures/closureSimModel";
import { carsAt, PLAY_STYLE, RUNNERS, runnersAt } from "../../../closures/marathonPlay";
import type { LonLat } from "../../geo";
import type { LocalFrame } from "../frame";
import { lineToLocal } from "../routeLine";
import type { OverlayChild } from "./accessLayers";
import { createLineBatch } from "./lines";
import { MARKER_ORDER } from "./markers";

/** Dot sizes in CSS pixels (constant on screen, so the playback reads at any zoom). */
export const RUNNER_PX = 9;
export const CAR_PX = 12;
const LIFT_M = 2;
const BEFORE_LIFT_M = 0.7;

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
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; // positions move every frame
  points.renderOrder = MARKER_ORDER.labels - 2; // over the course line, under labels
  return points;
}

/**
 * T-028 "Watch the marathon" on the Stylised map: runners along the proposed course and one
 * sample car per rerouted trip driving its detour, with that trip's old route as a faint grey
 * line. Positions follow `getT()` (screen seconds) each frame. Display only: decorative numbers
 * and speeds, never crowd sizes, vehicle counts or delays.
 */
export function createMarathonRunners(
  m: MarathonResult,
  frame: LocalFrame,
  getT: () => number,
): OverlayChild & { positions(): { runners: number; cars: number } } {
  const group = new THREE.Group();
  group.name = "marathon-play";
  const course = m.animation.course_coordinates;
  const trips = m.animation.rerouted_trips ?? [];
  const runners = dots(RUNNERS, PLAY_STYLE.runner, RUNNER_PX, true);
  const cars = dots(Math.max(trips.length, 1), PLAY_STYLE.car, CAR_PX, false);
  const before = trips.map((tr) => lineToLocal(tr.before_coordinates as LonLat[], frame, 0));
  if (before.some((l) => l.length >= 6))
    group.add(
      createLineBatch(
        before,
        { color: PLAY_STYLE.before, widthPx: 3, opacity: 0.8 },
        BEFORE_LIFT_M,
        MARKER_ORDER.labels - 3,
      ),
    );
  group.add(runners, cars);
  let shown = { runners: 0, cars: 0 };

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
    shown = { runners: place(runners, runnersAt(course, t)), cars: place(cars, carsAt(trips, t)) };
  };
  update();

  return {
    group,
    setView: update,
    setResolution(w, h) {
      group.traverse((o) => {
        const mat = (o as THREE.Mesh).material as { resolution?: THREE.Vector2 } | undefined;
        mat?.resolution?.set(w, h);
      });
    },
    positions: () => shown,
    dispose() {
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        (mesh.material as THREE.Material | undefined)?.dispose?.();
      });
    },
  };
}
