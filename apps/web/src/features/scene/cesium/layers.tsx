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
import { useEvacCentres, useGaps, useLayer, useScenarioWater } from "../../../lib/api";
import { ENV } from "../../../lib/env";
import { centreMapMarker } from "../../../lib/routeStatus";
import {
  GAP_BANDS,
  GAP_CESIUM_DASH,
  type GapBand,
  gapsActive,
  parseGaps,
} from "../../gaps/gapModel";
import {
  floodEdgePickId,
  groupEdgesByStatus,
  type LonLat,
  lineFeatures,
  pointFeatures,
  waterPolygons,
} from "../geo";
import { useScene } from "../sceneStore";
import { CESIUM_DASH, type EdgeStatus, ROUTE_STYLE, statusStyle, WATER_COLOR } from "../styles";
import { heightRefFor, type MapStyle } from "./heightRef";

/** Stylised draws on the flat ellipsoid: clamp to ground there, to Google tiles only when realistic. */
const heightRef = (style: MapStyle) => heightRefFor(style, !!ENV.googleKey, Cesium.HeightReference);
const flat = (coords: number[][]) => coords.flatMap((c) => [c[0] as number, c[1] as number]);
const FLOODED: EdgeStatus[] = ["flooded_likely", "flooded_possible"];
type EdgeGroup = { id: string; coords: LonLat[] };

/** requestRenderMode: request a frame whenever `deps` change. */
function useRenderOn(...deps: unknown[]) {
  const { viewer } = useCesium();
  useEffect(() => {
    if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender();
  }, [viewer, ...deps]);
}

/** Labels of many markers overlap at city zoom: show them only near the camera (or when focused). */
const NEAR_LABEL = new Cesium.DistanceDisplayCondition(0, 1500);

interface LineStyle {
  color: string;
  alpha?: number;
  width: number;
  dash?: { dashLength: number; dashPattern: number };
}
const statusLine = (s: EdgeStatus): LineStyle => ({ ...statusStyle(s), dash: CESIUM_DASH[s] });
const gapLine = (b: GapBand): LineStyle => ({ ...GAP_BANDS[b], dash: GAP_CESIUM_DASH[b] });

function material({ color: css, alpha = 1, dash }: LineStyle) {
  const color = Cesium.Color.fromCssColorString(css).withAlpha(alpha);
  if (dash) return Cesium.Material.fromType("PolylineDash", { color, ...dash });
  return Cesium.Material.fromType("Color", { color });
}

/**
 * One GroundPolylinePrimitive per status (not one entity per edge): stays smooth with thousands of
 * edges. Patterns (solid / dashed / dotted) carry the status, not colour alone.
 */
function StatusLines<K extends string>({
  groups,
  extraWidth = 0,
  styleOf = statusLine as unknown as (k: K) => LineStyle,
}: {
  groups: Map<K, EdgeGroup[]>;
  extraWidth?: number;
  styleOf?: (k: K) => LineStyle;
}) {
  const { viewer } = useCesium();
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const scene = viewer.scene;
    if (!Cesium.GroundPolylinePrimitive.isSupported(scene)) {
      // Fallback: ordinary (non-draped) polylines so status is still visible.
      const collection = new Cesium.PolylineCollection();
      for (const [status, lines] of groups) {
        const width = styleOf(status).width + extraWidth;
        for (const { coords } of lines)
          collection.add({
            positions: Cesium.Cartesian3.fromDegreesArray(flat(coords)),
            width,
            material: material(styleOf(status)),
          });
      }
      scene.primitives.add(collection);
      scene.requestRender();
      return () => {
        if (scene.isDestroyed()) return;
        scene.primitives.remove(collection);
        scene.requestRender();
      };
    }
    const prims: Cesium.GroundPolylinePrimitive[] = [];
    for (const [status, lines] of groups) {
      const width = styleOf(status).width + extraWidth;
      const pickable = (FLOODED as string[]).includes(status);
      const prim = new Cesium.GroundPolylinePrimitive({
        // Flood edges carry a per-instance id so scene.pick maps a click back to its path.
        geometryInstances: lines.map(
          ({ id, coords }) =>
            new Cesium.GeometryInstance({
              id: pickable ? floodEdgePickId(id) : undefined,
              geometry: new Cesium.GroundPolylineGeometry({
                positions: Cesium.Cartesian3.fromDegreesArray(flat(coords)),
                width,
              }),
            }),
        ),
        appearance: new Cesium.PolylineMaterialAppearance({ material: material(styleOf(status)) }),
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
  }, [viewer, groups, extraWidth, styleOf]);
  return null;
}

export function AccessLayer() {
  const profile = useScene((s) => s.profile);
  const scenarioId = useScene((s) => s.scenarioId);
  const visible = useScene((s) => s.lensVisible.access);
  const gapsOn = useScene((s) => gapsActive(s.gapsVisible, s.profile));
  const focusPlaceId = useScene((s) => s.focusPlaceId);
  const mapStyle = useScene((s) => s.mapStyle);
  const q = useLayer("access", profile, scenarioId);
  // The gap bands replace the status lines while the Gaps layer is on (one meaning per line).
  const groups = useMemo(
    () => (visible && !gapsOn ? groupEdgesByStatus(lineFeatures(q.data)) : new Map()),
    [q.data, visible, gapsOn],
  );
  const points = useMemo(() => pointFeatures(q.data), [q.data]);
  useRenderOn(q.data, visible, gapsOn, focusPlaceId);
  return (
    <>
      <StatusLines groups={groups} />
      <GapsLayer />
      {visible &&
        points.map((p) => (
          <Entity
            key={p.id}
            name={p.name}
            properties={new Cesium.PropertyBag({ placeId: p.id })}
            position={Cesium.Cartesian3.fromDegrees(p.coord[0], p.coord[1])}
          >
            <PointGraphics
              pixelSize={p.id === focusPlaceId ? 16 : 9}
              color={Cesium.Color.fromCssColorString("#0f5c63")}
              outlineColor={Cesium.Color.WHITE}
              outlineWidth={2}
              heightReference={heightRef(mapStyle)}
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
                heightReference={heightRef(mapStyle)}
                disableDepthTestDistance={Number.POSITIVE_INFINITY}
              />
            )}
          </Entity>
        ))}
      <RouteLayer />
    </>
  );
}

/** Edges coloured by how many facts are not yet checked: three bands, each with a pattern. */
function GapsLayer() {
  const profile = useScene((s) => s.profile);
  const on = useScene((s) => gapsActive(s.gapsVisible, s.profile) && s.lensVisible.access);
  const q = useGaps(profile, on);
  const groups = useMemo(() => {
    const m = new Map<GapBand, EdgeGroup[]>();
    if (!on) return m;
    for (const i of parseGaps(q.data)) {
      if (i.kind !== "segment" || !i.band || i.coords.length < 2) continue;
      m.set(i.band, [...(m.get(i.band) ?? []), { id: i.id, coords: i.coords }]);
    }
    return m;
  }, [q.data, on]);
  useRenderOn(groups, on);
  return <StatusLines groups={groups} styleOf={gapLine} />;
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
  const focusPlaceId = useScene((s) => s.focusPlaceId);
  const mapStyle = useScene((s) => s.mapStyle);
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
    const all = on
      ? groupEdgesByStatus(lineFeatures(flood.data))
      : new Map<EdgeStatus, EdgeGroup[]>();
    return new Map([...all].filter(([s]) => FLOODED.includes(s)));
  }, [flood.data, on]);
  const waterColor = useMemo(
    () => Cesium.Color.fromCssColorString(WATER_COLOR).withAlpha(0.55),
    [],
  );
  useRenderOn(polys, groups, evac.data, on, mapStyle);
  if (!on) return null;
  return (
    <>
      <StatusLines groups={groups} extraWidth={2} />
      {polys.map((p) => (
        <Entity key={p.key}>
          {mapStyle === "stylised" ? (
            // Stylised ground is the flat ellipsoid: drape the scenario water on it (a surface
            // height above terrain would float as a slab over the flat city).
            <PolygonGraphics hierarchy={p.hierarchy} material={waterColor} />
          ) : (
            <PolygonGraphics
              hierarchy={p.hierarchy}
              height={p.height}
              extrudedHeight={p.height - 40}
              perPositionHeight={false}
              material={waterColor}
            />
          )}
        </Entity>
      ))}
      {(evac.data ?? []).map((r) => (
        <Entity
          key={r.centre.id}
          name={r.centre.name}
          properties={new Cesium.PropertyBag({ placeId: r.centre.id })}
          position={Cesium.Cartesian3.fromDegrees(
            r.centre.coord[0] as number,
            r.centre.coord[1] as number,
          )}
        >
          <PointGraphics
            pixelSize={12}
            color={Cesium.Color.fromCssColorString(centreMapMarker(r).color)}
            outlineColor={Cesium.Color.WHITE}
            outlineWidth={2}
            heightReference={heightRef(mapStyle)}
            disableDepthTestDistance={Number.POSITIVE_INFINITY}
          />
          <LabelGraphics
            text={`${r.centre.name}: ${centreMapMarker(r).text}`}
            distanceDisplayCondition={r.centre.id === focusPlaceId ? undefined : NEAR_LABEL}
            font="600 14px sans-serif"
            showBackground
            backgroundColor={Cesium.Color.WHITE.withAlpha(0.9)}
            fillColor={Cesium.Color.BLACK}
            pixelOffset={new Cesium.Cartesian2(0, -24)}
            heightReference={heightRef(mapStyle)}
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
  const focusPlaceId = useScene((s) => s.focusPlaceId);
  const mapStyle = useScene((s) => s.mapStyle);
  const points = useMemo(() => pointFeatures(q.data), [q.data]);
  useRenderOn(points, visible);
  if (!visible) return null;
  return (
    <>
      {points.map((p) => (
        <Entity
          key={p.id}
          name={p.name}
          properties={new Cesium.PropertyBag({ placeId: p.id })}
          position={Cesium.Cartesian3.fromDegrees(p.coord[0], p.coord[1])}
        >
          <PointGraphics
            pixelSize={9}
            color={Cesium.Color.fromCssColorString("#6B46C1")}
            outlineColor={Cesium.Color.WHITE}
            outlineWidth={2}
            heightReference={heightRef(mapStyle)}
            disableDepthTestDistance={Number.POSITIVE_INFINITY}
          />
          <LabelGraphics
            text={`Waste point: ${p.name}`}
            distanceDisplayCondition={p.id === focusPlaceId ? undefined : NEAR_LABEL}
            font="13px sans-serif"
            showBackground
            backgroundColor={Cesium.Color.WHITE.withAlpha(0.9)}
            fillColor={Cesium.Color.BLACK}
            pixelOffset={new Cesium.Cartesian2(0, -22)}
            heightReference={heightRef(mapStyle)}
            disableDepthTestDistance={Number.POSITIVE_INFINITY}
          />
        </Entity>
      ))}
    </>
  );
}
