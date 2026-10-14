import "mapbox-gl/dist/mapbox-gl.css";
import { useCallback, useEffect, useMemo, useRef } from "react";
import MapGL, { Layer, type MapMouseEvent, type MapRef, Source } from "react-map-gl/mapbox";
import { useLayer, useScenarioWater } from "../../../lib/api";
import { ENV } from "../../../lib/env";
import { clickedPlaceId, normalizeLayer, pointFeatures } from "../geo";
import { useScene } from "../sceneStore";
import { ROUTE_STYLE, statusStyle, WATER_COLOR } from "../styles";

const prefersReducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const CENTRE_LAYER = "evac-centres";
const WASTE_LAYER = "waste-points";

const COLOR = [
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

const WIDTH = (extra: number) =>
  [
    "match",
    ["get", "status_for_profile"],
    "ok",
    statusStyle("ok").width + extra,
    "unknown",
    statusStyle("unknown").width + extra,
    "blocked",
    statusStyle("blocked").width + extra,
    "flooded_likely",
    statusStyle("flooded_likely").width + extra,
    "flooded_possible",
    statusStyle("flooded_possible").width + extra,
    statusStyle("unknown").width + extra,
  ] as never;

// Pattern carries status so it is never colour alone: solid / dashed / dotted.
const PATTERNS: {
  id: string;
  statuses: string[];
  paint: Record<string, unknown>;
  layout?: Record<string, unknown>;
}[] = [
  { id: "solid", statuses: ["ok", "flooded_likely"], paint: {} },
  { id: "dashed", statuses: ["unknown", "flooded_possible"], paint: { "line-dasharray": [2, 1] } },
  {
    id: "dotted",
    statuses: ["blocked"],
    paint: { "line-dasharray": [0, 2] },
    layout: { "line-cap": "round" },
  },
];

/** Normalised line features split into three pattern layers by status. */
function StatusLines({
  id,
  data,
  only,
  extraWidth = 0,
  withPlaces = false,
}: {
  id: string;
  data: GeoJSON.FeatureCollection;
  only?: string[];
  extraWidth?: number;
  withPlaces?: boolean;
}) {
  return (
    <Source id={id} type="geojson" data={data}>
      {PATTERNS.map((pt) => {
        const statuses = only ? pt.statuses.filter((x) => only.includes(x)) : pt.statuses;
        if (statuses.length === 0) return null;
        return (
          <Layer
            key={pt.id}
            id={`${id}-${pt.id}`}
            type="line"
            slot="middle"
            filter={
              [
                "all",
                ["==", ["geometry-type"], "LineString"],
                ["in", ["get", "status_for_profile"], ["literal", statuses]],
              ] as never
            }
            layout={pt.layout as never}
            paint={{ "line-color": COLOR, "line-width": WIDTH(extraWidth), ...pt.paint } as never}
          />
        );
      })}
      {withPlaces && (
        <Layer
          id={`${id}-places`}
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
      )}
    </Source>
  );
}

export default function MapboxLite() {
  const mapRef = useRef<MapRef>(null);
  const profile = useScene((s) => s.profile);
  const scenarioId = useScene((s) => s.scenarioId);
  const lensVisible = useScene((s) => s.lensVisible);
  const route = useScene((s) => s.route);
  const focusPlaceId = useScene((s) => s.focusPlaceId);
  const camera = useScene((s) => s.camera);
  const selectPlace = useScene((s) => s.selectPlace);
  const access = useLayer("access", profile, scenarioId);
  const water = useScenarioWater(scenarioId);
  const flood = useLayer("flood", profile, scenarioId);
  const waste = useLayer("waste", profile, scenarioId);
  const accessData = useMemo(() => normalizeLayer(access.data), [access.data]);
  const floodData = useMemo(() => normalizeLayer(flood.data), [flood.data]);
  const places = useMemo(() => pointFeatures(access.data), [access.data]);
  const wasteData = useMemo(() => normalizeLayer(waste.data), [waste.data]);

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
  const showCentres = !!scenarioId && lensVisible.flood && flood.data;
  const showWaste = lensVisible.waste && waste.data;
  const clickable = [
    ...(showAccess ? ["access-places"] : []),
    ...(showCentres ? [CENTRE_LAYER] : []),
    ...(showWaste ? [WASTE_LAYER] : []),
  ];

  return (
    <section className="h-full w-full" aria-label="Lite map of Elmina">
      <MapGL
        ref={mapRef}
        mapboxAccessToken={ENV.mapboxToken}
        mapStyle="mapbox://styles/mapbox/standard"
        initialViewState={{ longitude: 101.5099, latitude: 3.1813, zoom: 15, pitch: 55 }}
        style={{ width: "100%", height: "100%" }}
        reuseMaps
        interactiveLayerIds={clickable}
        cursor="auto"
        onClick={(e: MapMouseEvent) => {
          const id = clickedPlaceId(e.features, clickable);
          if (id) selectPlace(id);
        }}
      >
        {showWater && (
          <Source id="water" type="geojson" data={water.data as never}>
            <Layer
              id="water"
              type="fill"
              slot="bottom"
              paint={{ "fill-color": WATER_COLOR, "fill-opacity": 0.45 }}
            />
          </Source>
        )}
        {showAccess && <StatusLines id="access" data={accessData} withPlaces />}
        {showWater && flood.data && (
          <StatusLines
            id="flood-lines"
            data={floodData}
            only={["flooded_likely", "flooded_possible"]}
            extraWidth={2}
          />
        )}
        {showCentres && (
          <Source id="centres" type="geojson" data={floodData}>
            <Layer
              id={CENTRE_LAYER}
              type="circle"
              slot="top"
              filter={["==", ["get", "kind"], "evac_centre"]}
              paint={{
                "circle-radius": 8,
                "circle-color": "#B7791F",
                "circle-stroke-color": "#fff",
                "circle-stroke-width": 2,
              }}
            />
          </Source>
        )}
        {showWaste && (
          <Source id="waste" type="geojson" data={wasteData}>
            <Layer
              id={WASTE_LAYER}
              type="circle"
              slot="top"
              paint={{
                "circle-radius": 7,
                "circle-color": "#6B46C1",
                "circle-stroke-color": "#fff",
                "circle-stroke-width": 2,
              }}
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
