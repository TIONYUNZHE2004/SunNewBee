import * as Cesium from "cesium";
import { useEffect, useMemo } from "react";
import {
  Entity,
  LabelGraphics,
  PointGraphics,
  PolygonGraphics,
  PolylineGraphics,
  useCesium,
} from "resium";
import { useEvacCentres, useLayer, useScenarioWater } from "../../../lib/api";
import { ENV } from "../../../lib/env";
import { groupByStatus, type LonLat, lineFeatures, pointFeatures, waterPolygons } from "../geo";
import { useScene } from "../sceneStore";
import { type EdgeStatus, ROUTE_STYLE, statusStyle, WATER_COLOR } from "../styles";

const heightRef = () =>
  ENV.googleKey ? Cesium.HeightReference.CLAMP_TO_3D_TILE : Cesium.HeightReference.CLAMP_TO_GROUND;
const flat = (coords: number[][]) => coords.flatMap((c) => [c[0] as number, c[1] as number]);
const FLOODED: EdgeStatus[] = ["flooded_likely", "flooded_possible"];

/** requestRenderMode: request a frame whenever `deps` change. */
function useRenderOn(...deps: unknown[]) {
  const { viewer } = useCesium();
  useEffect(() => {
    if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender();
  }, [viewer, ...deps]);
}

function material(status: EdgeStatus) {
  const st = statusStyle(status);
  const color = Cesium.Color.fromCssColorString(st.color);
  if (st.dotted)
    return Cesium.Material.fromType("PolylineDash", { color, dashLength: 10, dashPattern: 0xaaaa });
  if (st.dashed) return Cesium.Material.fromType("PolylineDash", { color, dashLength: 18 });
  return Cesium.Material.fromType("Color", { color });
}

/**
 * One GroundPolylinePrimitive per status (not one entity per edge): stays smooth with thousands of
 * edges. Patterns (solid / dashed / dotted) carry the status, not colour alone.
 */
function StatusLines({
  groups,
  extraWidth = 0,
}: {
  groups: Map<EdgeStatus, LonLat[][]>;
  extraWidth?: number;
}) {
  const { viewer } = useCesium();
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const scene = viewer.scene;
    if (!Cesium.GroundPolylinePrimitive.isSupported(scene)) return;
    const prims: Cesium.GroundPolylinePrimitive[] = [];
    for (const [status, lines] of groups) {
      const width = statusStyle(status).width + extraWidth;
      const prim = new Cesium.GroundPolylinePrimitive({
        geometryInstances: lines.map(
          (c) =>
            new Cesium.GeometryInstance({
              geometry: new Cesium.GroundPolylineGeometry({
                positions: Cesium.Cartesian3.fromDegreesArray(flat(c)),
                width,
              }),
            }),
        ),
        appearance: new Cesium.PolylineMaterialAppearance({ material: material(status) }),
        classificationType: Cesium.ClassificationType.BOTH,
      });
      scene.groundPrimitives.add(prim);
      prims.push(prim);
    }
    scene.requestRender();
    return () => {
      if (scene.isDestroyed()) return;
      for (const p of prims) scene.groundPrimitives.remove(p);
      scene.requestRender();
    };
  }, [viewer, groups, extraWidth]);
  return null;
}

export function AccessLayer() {
  const profile = useScene((s) => s.profile);
  const scenarioId = useScene((s) => s.scenarioId);
  const visible = useScene((s) => s.lensVisible.access);
  const focusPlaceId = useScene((s) => s.focusPlaceId);
  const q = useLayer("access", profile, scenarioId);
  const groups = useMemo(
    () => (visible ? groupByStatus(lineFeatures(q.data)) : new Map()),
    [q.data, visible],
  );
  const points = useMemo(() => pointFeatures(q.data), [q.data]);
  useRenderOn(q.data, visible, focusPlaceId);
  return (
    <>
      <StatusLines groups={groups} />
      {visible &&
        points.map((p) => (
          <Entity
            key={p.id}
            name={p.name}
            position={Cesium.Cartesian3.fromDegrees(p.coord[0], p.coord[1])}
          >
            <PointGraphics
              pixelSize={p.id === focusPlaceId ? 16 : 9}
              color={Cesium.Color.fromCssColorString("#0f5c63")}
              outlineColor={Cesium.Color.WHITE}
              outlineWidth={2}
              heightReference={heightRef()}
              disableDepthTestDistance={Number.POSITIVE_INFINITY}
            />
            {p.id === focusPlaceId && (
              <LabelGraphics
                text={p.name}
                font="600 15px sans-serif"
                fillColor={Cesium.Color.WHITE}
                showBackground
                backgroundColor={Cesium.Color.fromCssColorString("#0a4349")}
                pixelOffset={new Cesium.Cartesian2(0, -28)}
                heightReference={heightRef()}
                disableDepthTestDistance={Number.POSITIVE_INFINITY}
              />
            )}
          </Entity>
        ))}
      <RouteLayer />
    </>
  );
}

function RouteLayer() {
  const route = useScene((s) => s.route);
  const positions = useMemo(
    () =>
      route
        ? Cesium.Cartesian3.fromDegreesArray(flat(route.geojson.coordinates as number[][]))
        : [],
    [route],
  );
  const mat = useMemo(() => Cesium.Color.fromCssColorString(ROUTE_STYLE.color), []);
  useRenderOn(route);
  if (!route) return null;
  return (
    <Entity>
      <PolylineGraphics
        positions={positions}
        width={ROUTE_STYLE.width}
        clampToGround
        classificationType={Cesium.ClassificationType.BOTH}
        material={mat}
      />
    </Entity>
  );
}

export function FloodLayer() {
  const scenarioId = useScene((s) => s.scenarioId);
  const profile = useScene((s) => s.profile);
  const visible = useScene((s) => s.lensVisible.flood);
  const on = !!scenarioId && visible;
  const water = useScenarioWater(scenarioId);
  const flood = useLayer("flood", profile, scenarioId);
  const evac = useEvacCentres(scenarioId, profile);
  const polys = useMemo(
    () =>
      waterPolygons(water.data).map((p) => ({
        key: p.key,
        height: p.height,
        hierarchy: new Cesium.PolygonHierarchy(
          Cesium.Cartesian3.fromDegreesArray(flat(p.rings[0] ?? [])),
          p.rings
            .slice(1)
            .map((r) => new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flat(r)))),
        ),
      })),
    [water.data],
  );
  const groups = useMemo(() => {
    const all = on ? groupByStatus(lineFeatures(flood.data)) : new Map<EdgeStatus, LonLat[][]>();
    return new Map([...all].filter(([s]) => FLOODED.includes(s)));
  }, [flood.data, on]);
  const waterColor = useMemo(
    () => Cesium.Color.fromCssColorString(WATER_COLOR).withAlpha(0.55),
    [],
  );
  useRenderOn(polys, groups, evac.data, on);
  if (!on) return null;
  return (
    <>
      <StatusLines groups={groups} extraWidth={2} />
      {polys.map((p) => (
        <Entity key={p.key}>
          <PolygonGraphics
            hierarchy={p.hierarchy}
            height={p.height}
            extrudedHeight={p.height - 40}
            perPositionHeight={false}
            material={waterColor}
          />
        </Entity>
      ))}
      {(evac.data ?? []).map((r) => (
        <Entity
          key={r.centre.id}
          name={r.centre.name}
          position={Cesium.Cartesian3.fromDegrees(
            r.centre.coord[0] as number,
            r.centre.coord[1] as number,
          )}
        >
          <PointGraphics
            pixelSize={12}
            color={Cesium.Color.fromCssColorString(r.reachable ? "#1B873F" : "#C53030")}
            outlineColor={Cesium.Color.WHITE}
            outlineWidth={2}
            heightReference={heightRef()}
            disableDepthTestDistance={Number.POSITIVE_INFINITY}
          />
          <LabelGraphics
            text={`${r.centre.name}: ${r.reachable ? "Reachable" : "Not reachable"}`}
            font="600 14px sans-serif"
            showBackground
            backgroundColor={Cesium.Color.WHITE.withAlpha(0.9)}
            fillColor={Cesium.Color.BLACK}
            pixelOffset={new Cesium.Cartesian2(0, -24)}
            heightReference={heightRef()}
            disableDepthTestDistance={Number.POSITIVE_INFINITY}
          />
        </Entity>
      ))}
    </>
  );
}

export function WasteLayer() {
  const profile = useScene((s) => s.profile);
  const scenarioId = useScene((s) => s.scenarioId);
  const visible = useScene((s) => s.lensVisible.waste);
  const q = useLayer("waste", profile, scenarioId);
  const points = useMemo(() => pointFeatures(q.data), [q.data]);
  useRenderOn(points, visible);
  if (!visible) return null;
  return (
    <>
      {points.map((p) => (
        <Entity
          key={p.id}
          name={p.name}
          position={Cesium.Cartesian3.fromDegrees(p.coord[0], p.coord[1])}
        >
          <PointGraphics
            pixelSize={9}
            color={Cesium.Color.fromCssColorString("#6B46C1")}
            outlineColor={Cesium.Color.WHITE}
            outlineWidth={2}
            heightReference={heightRef()}
            disableDepthTestDistance={Number.POSITIVE_INFINITY}
          />
          <LabelGraphics
            text={`Waste point: ${p.name}`}
            font="13px sans-serif"
            showBackground
            backgroundColor={Cesium.Color.WHITE.withAlpha(0.9)}
            fillColor={Cesium.Color.BLACK}
            pixelOffset={new Cesium.Cartesian2(0, -22)}
            heightReference={heightRef()}
            disableDepthTestDistance={Number.POSITIVE_INFINITY}
          />
        </Entity>
      ))}
    </>
  );
}
