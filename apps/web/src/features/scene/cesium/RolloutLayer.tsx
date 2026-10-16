import * as Cesium from "cesium";
import { useEffect } from "react";
import { useCesium } from "resium";
import { useRiverRollout } from "../../../lib/api";
import { kindAt, phase, pointAlong, RESIDENT_STYLE, routeAt } from "../../whatif/rolloutModel";
import { useScene } from "../sceneStore";

const LOOP_S = 12; // seconds for one walk along a route (display only, not a travel time)
const HEIGHT_M = 3;

/** Synthetic residents walking their engine-computed route to the nearest centre at the
 * current river stage; cut-off residents stand still in red. One PointPrimitiveCollection and
 * one clock tick handler (cheap in requestRenderMode). */
export function RolloutLayer() {
  const { viewer } = useCesium();
  const rollout = useScene((s) => s.rollout);
  const q = useRiverRollout(rollout.on);
  const data = q.data;

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !rollout.on || !data) return;
    const points = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
    const colors = Object.fromEntries(
      Object.entries(RESIDENT_STYLE).map(([k, v]) => [k, Cesium.Color.fromCssColorString(v.color)]),
    ) as Record<keyof typeof RESIDENT_STYLE, Cesium.Color>;
    const routes = data.routes as Record<string, { coordinates: number[][] }>;
    const items = data.residents.map((r) => {
      const { routeId, moving } = routeAt(r, rollout.stage);
      // No route at all: stand (grey) at the start, so every sampled resident is visible.
      const origin = r.origin_coord && r.origin_coord.length >= 2 ? [r.origin_coord] : [];
      const coords = routeId ? (routes[routeId]?.coordinates ?? origin) : origin;
      const p = points.add({
        position: Cesium.Cartesian3.ZERO,
        pixelSize: 9,
        color: colors[kindAt(r, rollout.stage)],
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        show: coords.length > 0,
      });
      return { p, coords, moving, offset: phase(r.id) };
    });
    const scratch = new Cesium.Cartesian3();
    const t0 = performance.now();
    const place = () => {
      const t = (performance.now() - t0) / 1000 / LOOP_S;
      for (const it of items) {
        if (!it.coords.length) continue;
        const f = it.moving ? (t + it.offset) % 1 : 0;
        const [lon, lat] = pointAlong(it.coords, f);
        it.p.position = Cesium.Cartesian3.fromDegrees(lon, lat, HEIGHT_M, undefined, scratch);
      }
      viewer.scene.requestRender();
    };
    place();
    const animate = items.some((i) => i.moving);
    const wasAnimating = viewer.clock.shouldAnimate;
    viewer.clock.shouldAnimate = wasAnimating || animate;
    const remove = animate ? viewer.clock.onTick.addEventListener(place) : () => {};
    return () => {
      remove();
      viewer.clock.shouldAnimate = wasAnimating;
      if (!viewer.isDestroyed()) {
        viewer.scene.primitives.remove(points);
        viewer.scene.requestRender();
      }
    };
  }, [viewer, rollout.on, rollout.stage, data]);

  return null;
}
