import { describe, expect, it } from "vitest";
import { createFrame } from "../frame";
import { createRoadLabels, MAX_ROAD_LABELS, type RoadLabelRow } from "./roadLabels";

const frame = createFrame([101.5, 3.0]);
const canvas = () =>
  ({ width: 0, height: 0, getContext: () => null }) as unknown as HTMLCanvasElement;
// 15 roads on a line eastwards from the frame origin, about 100 m apart
const rows: RoadLabelRow[] = Array.from({ length: 15 }, (_, i) => ({
  name: `Jalan ${i}`,
  road_class: "residential",
  length_m: 200,
  anchor: [101.5 + i * 0.0009, 3.0],
  bearing_deg: 0,
}));

describe("road names on the Stylised map (T-028)", () => {
  it("shows the nearest few, and a closed or course road always, first", () => {
    const layer = createRoadLabels(rows, frame, new Set(["Jalan 14"]), canvas);
    layer.setResolution?.(1000, 800);
    layer.setView?.({ x: 0, y: 300, z: 0 }, 0, 40);
    const shown = layer.shown();
    expect(shown[0]).toBe("Jalan 14"); // the farthest, still shown first: it is closed
    expect(shown.slice(1)).toEqual(rows.slice(0, MAX_ROAD_LABELS).map((r) => r.name));
    expect(layer.group.children.filter((c) => c.visible)).toHaveLength(MAX_ROAD_LABELS + 1);
    layer.dispose();
  });

  it("hides names beyond range and never makes a label pickable", () => {
    const layer = createRoadLabels(rows, frame, new Set(), canvas);
    layer.setView?.({ x: 50_000, y: 300, z: 0 }, 0, 40);
    expect(layer.shown()).toEqual([]);
    layer.setView?.({ x: 0, y: 300, z: 0 }, 0, 40);
    const hits: unknown[] = [];
    for (const c of layer.group.children) c.raycast({} as never, hits as never);
    expect(hits).toEqual([]);
    layer.dispose();
  });

  it("ranks names by the point the camera looks at, not by the camera's own position", () => {
    const layer = createRoadLabels(rows, frame, new Set(), canvas);
    // camera far south and up, looking at Jalan 14's anchor
    const [tx, tz] = frame.toLocal(101.5 + 14 * 0.0009, 3.0);
    layer.setView?.({ x: 0, y: 600, z: 700 }, 0, 40, { x: tx, y: 0, z: tz });
    expect(layer.shown()[0]).toBe("Jalan 14");
    layer.dispose();
  });
});
