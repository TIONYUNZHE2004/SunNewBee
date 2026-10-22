import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { MARATHON } from "../../../closures/fixtures";
import { shotStart } from "../../../closures/marathonCinematic";
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
    const canvas = () =>
      ({ width: 1, height: 1, getContext: () => null }) as unknown as HTMLCanvasElement;
    const child = createMarathonRunners(m, createFrame([101.5, 3.1]), () => t, {
      makeCanvas: canvas,
      tags: [{ text: "Marshal suggested here", at: [101.505, 3.1] }],
    });
    expect(child.positions()).toMatchObject({ runners: RUNNERS, cars: 1, ribbon: 0, tags: [] });
    const pts = child.group.children.filter((o) => o instanceof THREE.Points) as THREE.Points[];
    const runner = pts[0]?.geometry.getAttribute("position") as THREE.BufferAttribute;
    expect(runner.getX(0)).toBeCloseTo(0, 3); // at the start
    t = PLAY_S;
    child.setView?.({ x: 0, y: 100, z: 0 }, 0);
    expect(runner.getX(0)).toBeGreaterThan(1000); // ~1.1 km east, at the finish
    expect(child.group.children.some((o) => !(o instanceof THREE.Points))).toBe(true); // before line
    // the course ribbon has drawn itself; the car shot's tags show (detour, suggestion)
    expect(child.positions().ribbon).toBe(1);
    t = shotStart("car") + 1;
    child.setView?.({ x: 0, y: 100, z: 0 }, 0);
    expect(child.positions().tags).toEqual([
      "Detour (median of rerouted trips): +82.5 m · +0.2 min at walking pace",
      "Marshal suggested here",
    ]);
    t = shotStart("run") + 1;
    child.setView?.({ x: 0, y: 100, z: 0 }, 0);
    expect(child.positions().tags).toEqual(["Lead runner"]);
    child.setDotsVisible({ runners: false, cars: true });
    expect(pts[0]?.visible).toBe(false);
    child.dispose();
  });
});
