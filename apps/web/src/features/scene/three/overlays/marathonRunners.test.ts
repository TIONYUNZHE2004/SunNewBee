import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { MARATHON } from "../../../closures/fixtures";
import { PLAY_S, RUNNERS } from "../../../closures/marathonPlay";
import { createFrame } from "../frame";
import { createMarathonRunners } from "./marathonRunners";

describe("marathon runners overlay (T-028)", () => {
  it("draws the runners and one car per rerouted trip, following the playback clock", () => {
    const m = {
      ...MARATHON,
      animation: {
        ...MARATHON.animation,
        rerouted_trips: [
          {
            from_id: "a",
            to_id: "b",
            profile: "drive",
            before_coordinates: MARATHON.animation.course_coordinates,
            after_coordinates: [
              [101.5, 3.1],
              [101.5, 3.11],
            ],
          },
        ],
      },
    };
    let t = 0;
    const child = createMarathonRunners(m, createFrame([101.5, 3.1]), () => t);
    expect(child.positions()).toEqual({ runners: RUNNERS, cars: 1 });
    const pts = child.group.children.filter((o) => o instanceof THREE.Points) as THREE.Points[];
    const runner = pts[0]?.geometry.getAttribute("position") as THREE.BufferAttribute;
    expect(runner.getX(0)).toBeCloseTo(0, 3); // at the start
    t = PLAY_S;
    child.setView?.({ x: 0, y: 100, z: 0 }, 0);
    expect(runner.getX(0)).toBeGreaterThan(1000); // ~1.1 km east, at the finish
    expect(child.group.children.some((o) => !(o instanceof THREE.Points))).toBe(true); // before line
    child.dispose();
  });
});
