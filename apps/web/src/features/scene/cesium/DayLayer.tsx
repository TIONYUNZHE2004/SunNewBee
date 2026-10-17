import * as Cesium from "cesium";
import { useEffect, useMemo, useRef } from "react";
import { useCesium } from "resium";
import { useDay } from "../../../lib/api";
import { DAY_STYLE, type DayState, dotsAt, prepare, type Tracks } from "../../day/dayModel";
import { useScene } from "../sceneStore";

const HEIGHT_M = 3;

/** Elmina Day on the 3D map: synthetic residents out and about at the panel's clock, moving
 * along their engine-computed paths (yellow walking, blue driving, red waiting for the water).
 * One PointPrimitiveCollection; positions are updated when the clock changes. Display only. */
export function DayLayer() {
  const { viewer } = useCesium();
  const day = useScene((s) => s.day);
  const q = useDay(day.scenario, day.on);
  const tracks = (q.data as { tracks?: Tracks } | undefined)?.tracks;
  const prepared = useMemo(() => prepare(tracks), [tracks]);
  const coll = useRef<Cesium.PointPrimitiveCollection | null>(null);
  const pts = useRef(new Map<string, Cesium.PointPrimitive>());

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !day.on || !tracks) return;
    const c = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
    coll.current = c;
    pts.current = new Map();
    return () => {
      coll.current = null;
      pts.current = new Map();
      if (!viewer.isDestroyed()) {
        viewer.scene.primitives.remove(c);
        viewer.scene.requestRender();
      }
    };
  }, [viewer, day.on, tracks]);

  useEffect(() => {
    const c = coll.current;
    if (!viewer || viewer.isDestroyed() || !c || !day.on) return;
    const colors = Object.fromEntries(
      Object.entries(DAY_STYLE).map(([k, v]) => [k, Cesium.Color.fromCssColorString(v.color)]),
    ) as Record<DayState, Cesium.Color>;
    const live = new Set<string>();
    for (const d of dotsAt(prepared, day.t)) {
      live.add(d.r);
      let p = pts.current.get(d.r);
      if (!p) {
        p = c.add({
          position: Cesium.Cartesian3.ZERO,
          pixelSize: 7,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
        pts.current.set(d.r, p);
      }
      const focused = d.r === day.focus;
      p.show = true;
      p.color = colors[d.state];
      p.pixelSize = focused ? 16 : 7;
      p.outlineColor = focused ? Cesium.Color.WHITE : Cesium.Color.BLACK;
      p.outlineWidth = focused ? 3 : 1;
      p.position = Cesium.Cartesian3.fromDegrees(d.lon, d.lat, HEIGHT_M);
    }
    for (const [r, p] of pts.current) if (!live.has(r)) p.show = false;
    viewer.scene.requestRender();
  }, [viewer, day.on, day.t, day.focus, prepared]);

  return null;
}
