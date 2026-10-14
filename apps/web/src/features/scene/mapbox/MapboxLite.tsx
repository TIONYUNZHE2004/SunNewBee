import "mapbox-gl/dist/mapbox-gl.css";
import { useCallback, useEffect, useMemo, useRef } from "react";
import MapGL, { Layer, type MapRef, Source } from "react-map-gl/mapbox";
import { useLayer, useScenarioWater } from "../../../lib/api";
import { ENV } from "../../../lib/env";
import { pointFeatures } from "../geo";
import { useScene } from "../sceneStore";
import { ROUTE_STYLE, statusStyle, WATER_COLOR } from "../styles";

const prefersReducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const statusColor = [
  "match",
  ["get", "status_for_profile"],
  "ok",
  statusStyle("ok").color,
  "unknown",
  statusStyle("unknown").color,
  "blocked",
  statusStyle("blocked").color,
  "flooded_likely",
  statusStyle("flooded_likely").color,
  "flooded_possible",
  statusStyle("flooded_possible").color,
  statusStyle("unknown").color,
] as never;

const isLine = ["==", ["geometry-type"], "LineString"];
// Unverified or missing status is rendered as "unknown" (dashed), never as checked.
const dashedStatuses = ["unknown", "flooded_possible"];
const isDashed = [
  "any",
  ["in", ["get", "status_for_profile"], ["literal", dashedStatuses]],
  ["!", ["has", "status_for_profile"]],
];

export default function MapboxLite() {
  const mapRef = useRef<MapRef>(null);
  const { profile, scenarioId, lensVisible, route, focusPlaceId, camera } = useScene();
  const access = useLayer("access", profile, scenarioId);
  const water = useScenarioWater(scenarioId);
  const places = useMemo(() => pointFeatures(access.data), [access.data]);

  const fly = useCallback((center: [number, number], zoom?: number) => {
    const map = mapRef.current;
    if (!map) return;
    const opts = { center, ...(zoom ? { zoom } : {}), pitch: 55 };
    if (prefersReducedMotion()) map.jumpTo(opts);
    else map.flyTo({ ...opts, duration: 1600 });
  }, []);

  useEffect(() => {
    const c = route?.geojson.coordinates;
    if (!c?.length) return;
    const mid = c[Math.floor(c.length / 2)] as number[];
    fly([mid[0] as number, mid[1] as number], 16.5);
  }, [route, fly]);

  useEffect(() => {
    const p = places.find((x) => x.id === focusPlaceId);
    if (p) fly(p.coord, 17);
  }, [focusPlaceId, places, fly]);

  useEffect(() => {
    if (camera) fly(camera.center);
  }, [camera, fly]);

  if (!ENV.mapboxToken)
    return (
      <p role="note" className="p-4 text-sm">
        Add a Mapbox token in .env to enable the lite map.
      </p>
    );

  const showAccess = lensVisible.access && access.data;
  const showWater = !!scenarioId && lensVisible.flood && water.data;

  return (
    <section className="h-full w-full" aria-label="Lite map of Elmina">
      <MapGL
        ref={mapRef}
        mapboxAccessToken={ENV.mapboxToken}
        mapStyle="mapbox://styles/mapbox/standard"
        initialViewState={{ longitude: 101.5099, latitude: 3.1813, zoom: 15, pitch: 55 }}
        style={{ width: "100%", height: "100%" }}
        reuseMaps
      >
        {showAccess && (
          <Source id="access" type="geojson" data={access.data as never}>
            {/* Solid for checked/blocked/flooded-likely; dashed for unknown/possible: status is never colour alone. */}
            <Layer
              id="access-solid"
              type="line"
              slot="middle"
              filter={["all", isLine, ["!", isDashed]] as never}
              paint={{ "line-color": statusColor, "line-width": 4 }}
            />
            <Layer
              id="access-dashed"
              type="line"
              slot="middle"
              filter={["all", isLine, isDashed] as never}
              paint={{ "line-color": statusColor, "line-width": 4, "line-dasharray": [2, 1] }}
            />
            <Layer
              id="access-places"
              type="circle"
              slot="top"
              filter={["==", ["geometry-type"], "Point"]}
              paint={{
                "circle-radius": 6,
                "circle-color": "#0f5c63",
                "circle-stroke-color": "#fff",
                "circle-stroke-width": 2,
              }}
            />
          </Source>
        )}
        {showWater && (
          <Source id="water" type="geojson" data={water.data as never}>
            <Layer
              id="water"
              type="fill"
              slot="middle"
              paint={{ "fill-color": WATER_COLOR, "fill-opacity": 0.45 }}
            />
          </Source>
        )}
        {route && (
          <Source id="route" type="geojson" data={route.geojson as never}>
            <Layer
              id="route"
              type="line"
              slot="top"
              paint={{ "line-color": ROUTE_STYLE.color, "line-width": ROUTE_STYLE.width }}
            />
          </Source>
        )}
      </MapGL>
    </section>
  );
}
