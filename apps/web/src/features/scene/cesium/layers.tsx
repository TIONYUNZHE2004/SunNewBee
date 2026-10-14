import * as Cesium from "cesium";
import { useMemo } from "react";
import { Entity, LabelGraphics, PointGraphics, PolygonGraphics, PolylineGraphics } from "resium";
import { useEvacCentres, useLayer, useScenarioWater } from "../../../lib/api";
import { ENV } from "../../../lib/env";
import { lineFeatures, pointFeatures, waterPolygons } from "../geo";
import { useScene } from "../sceneStore";
import { ROUTE_STYLE, statusStyle, WATER_COLOR } from "../styles";

const heightRef = () =>
  ENV.googleKey ? Cesium.HeightReference.CLAMP_TO_3D_TILE : Cesium.HeightReference.CLAMP_TO_GROUND;
const flat = (coords: number[][]) => coords.flatMap((c) => [c[0] as number, c[1] as number]);

function Line({
  coords,
  color,
  dashed,
  width,
}: {
  coords: number[][];
  color: string;
  dashed: boolean;
  width: number;
}) {
  const material = useMemo(
    () =>
      dashed
        ? new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString(color),
            dashLength: 14,
          })
        : Cesium.Color.fromCssColorString(color),
    [dashed, color],
  );
  return (
    <Entity>
      <PolylineGraphics
        positions={Cesium.Cartesian3.fromDegreesArray(flat(coords))}
        width={width}
        clampToGround
        classificationType={Cesium.ClassificationType.BOTH}
        material={material}
      />
    </Entity>
  );
}

export function AccessLayer() {
  const { profile, scenarioId, lensVisible, focusPlaceId } = useScene();
  const q = useLayer("access", profile, scenarioId);
  const lines = useMemo(() => lineFeatures(q.data), [q.data]);
  const points = useMemo(() => pointFeatures(q.data), [q.data]);
  if (!lensVisible.access) return null;
  return (
    <>
      {lines.map((l) => {
        const st = statusStyle(l.status);
        return (
          <Line key={l.id} coords={l.coords} color={st.color} dashed={st.dashed} width={st.width} />
        );
      })}
      {points.map((p) => (
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
  if (!route) return null;
  return (
    <Line
      coords={route.geojson.coordinates as number[][]}
      color={ROUTE_STYLE.color}
      dashed={false}
      width={ROUTE_STYLE.width}
    />
  );
}

export function FloodLayer() {
  const { scenarioId, profile, lensVisible } = useScene();
  const water = useScenarioWater(scenarioId);
  const flood = useLayer("flood", profile, scenarioId);
  const evac = useEvacCentres(scenarioId, profile);
  const polys = useMemo(() => waterPolygons(water.data), [water.data]);
  const lines = useMemo(() => lineFeatures(flood.data), [flood.data]);
  if (!scenarioId || !lensVisible.flood) return null;
  const waterColor = Cesium.Color.fromCssColorString(WATER_COLOR).withAlpha(0.55);
  return (
    <>
      {polys.map((p) => (
        <Entity key={p.key}>
          <PolygonGraphics
            hierarchy={
              new Cesium.PolygonHierarchy(
                Cesium.Cartesian3.fromDegreesArray(flat(p.rings[0] ?? [])),
                p.rings
                  .slice(1)
                  .map(
                    (r) => new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flat(r))),
                  ),
              )
            }
            height={p.height}
            extrudedHeight={p.height - 40}
            perPositionHeight={false}
            material={waterColor}
          />
        </Entity>
      ))}
      {lines
        .filter((l) => l.status === "flooded_likely" || l.status === "flooded_possible")
        .map((l) => {
          const st = statusStyle(l.status);
          return (
            <Line
              key={`f-${l.id}`}
              coords={l.coords}
              color={st.color}
              dashed={st.dashed}
              width={st.width + 2}
            />
          );
        })}
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
            text={`${r.reachable ? "✓" : "✕"} ${r.centre.name}`}
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
  const { profile, scenarioId, lensVisible } = useScene();
  const q = useLayer("waste", profile, scenarioId);
  const points = useMemo(() => pointFeatures(q.data), [q.data]);
  if (!lensVisible.waste) return null;
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
            text={`♻ ${p.name}`}
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
