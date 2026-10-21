import "mapbox-gl/dist/mapbox-gl.css";
import { useCallback, useEffect, useMemo, useRef } from "react";
import MapGL, { Layer, type MapMouseEvent, type MapRef, Source } from "react-map-gl/mapbox";
import { useDay, useGaps, useLayer, useScenarioWater, useSite } from "../../../lib/api";
import { ENV } from "../../../lib/env";
import { useTheme } from "../../../ui/theme";
import { DAY_STYLE, dotsAt, prepare, type Tracks } from "../../day/dayModel";
import {
  parseTrip,
  TRIP_STYLE,
  tripCoords,
  tripIdentity,
  tripPositionAt,
} from "../../day/tripModel";
import { useTripPick } from "../../day/tripPickStore";
import { GAP_BAND_ORDER, GAP_BANDS, gapLines, gapsActive } from "../../gaps/gapModel";
import { useJourney } from "../../journey/journeyStore";
import { WHATIF_STYLE } from "../../whatif/whatifModel";
import { homeView, shouldReframe } from "../cesium/home";
import { mapboxLightPreset } from "../cesium/timeOfDay";
import { accessLineData, clickedPlaceId, normalizeLayer, pointFeatures } from "../geo";
import { DevsimTextPanel } from "../list/DevsimTextPanel";
import { JourneyStepList } from "../list/JourneyStepList";
import { useSceneSettings } from "../sceneSettingsStore";
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
  "verified",
  statusStyle("verified").color,
  "likely_ok",
  statusStyle("likely_ok").color,
  "not_a_road",
  statusStyle("not_a_road").color,
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
    "verified",
    statusStyle("verified").width + extra,
    "likely_ok",
    statusStyle("likely_ok").width + extra,
    "not_a_road",
    statusStyle("not_a_road").width + extra,
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
  { id: "solid", statuses: ["ok", "verified", "not_a_road", "flooded_likely"], paint: {} },
  { id: "estimated", statuses: ["likely_ok"], paint: { "line-dasharray": [1, 1] } },
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
            layout={(pt.layout ?? {}) as never}
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

const GAP_DASH = { dashed: [2, 1], dotted: [0, 2] } as const;

/** Gap bands: one layer per band so each gets its own pattern as well as colour. */
function GapLines({ data }: { data: GeoJSON.FeatureCollection }) {
  return (
    <Source id="gaps" type="geojson" data={data}>
      {GAP_BAND_ORDER.map((b) => {
        const st = GAP_BANDS[b];
        return (
          <Layer
            key={b}
            id={`gaps-${b}`}
            type="line"
            slot="middle"
            filter={["==", ["get", "gap_band"], b] as never}
            layout={(st.pattern === "dotted" ? { "line-cap": "round" } : {}) as never}
            paint={
              {
                "line-color": st.color,
                "line-width": st.width,
                "line-opacity": st.alpha,
                ...(st.pattern === "solid" ? {} : { "line-dasharray": GAP_DASH[st.pattern] }),
              } as never
            }
          />
        );
      })}
    </Source>
  );
}

export default function MapboxLite() {
  const mapRef = useRef<MapRef>(null);
  const theme = useTheme((s) => s.theme);
  // Mapbox Standard light preset; other styles have no "basemap" import, so ignore failures.
  const lastPreset = useRef<string | undefined>(undefined);
  const applyLight = useCallback(() => {
    const preset = mapboxLightPreset(theme);
    if (lastPreset.current === preset) return;
    try {
      mapRef.current?.getMap().setConfigProperty("basemap", "lightPreset", preset);
      lastPreset.current = preset;
    } catch {
      /* not a Standard style, or style not ready */
    }
  }, [theme]);
  useEffect(() => {
    applyLight();
  }, [applyLight]);
  const profile = useScene((s) => s.profile);
  const scenarioId = useScene((s) => s.scenarioId);
  const lensVisible = useScene((s) => s.lensVisible);
  const route = useScene((s) => s.route);
  const journey = useJourney((s) => s.plan); // the trip being shown (see JourneyMount)
  const whatIf = useScene((s) => s.whatIf);
  const dayOn = useScene((s) => s.day.on);
  const dayScenario = useScene((s) => s.day.scenario);
  const dayFocus = useScene((s) => s.day.focus);
  // about 5 updates a second at most: the lite map redraws its source on every change
  const dayStep = useScene((s) => Math.floor(s.day.t / 3));
  const dayQ = useDay(dayScenario, dayOn);
  const dayPrepared = useMemo(
    () => prepare((dayQ.data as { tracks?: Tracks } | undefined)?.tracks),
    [dayQ.data],
  );
  const dayDots = useMemo(
    () =>
      dayOn
        ? {
            type: "FeatureCollection",
            features: dotsAt(dayPrepared, dayStep * 3).map((d) => ({
              type: "Feature",
              geometry: { type: "Point", coordinates: [d.lon, d.lat] },
              properties: { state: d.state, focus: d.r === dayFocus },
            })),
          }
        : null,
    [dayOn, dayStep, dayFocus, dayPrepared],
  );
  // a resident's own rehearsed trip (Cycle 20): lines from the engine, "you" at the clock
  const myTrip = useScene((s) => s.myTrip);
  const tripParsed = useMemo(() => parseTrip(myTrip?.geojson), [myTrip]);
  const you = useMemo(() => {
    if (!tripParsed || !dayOn) return null;
    const here = tripPositionAt(tripParsed.segs, dayStep * 3);
    const at = here ? [here.lon, here.lat] : tripParsed.normal?.[0];
    return at
      ? {
          type: "FeatureCollection",
          features: [
            { type: "Feature", geometry: { type: "Point", coordinates: at }, properties: {} },
          ],
        }
      : null;
  }, [tripParsed, dayOn, dayStep]);
  const focusPlaceId = useScene((s) => s.focusPlaceId);
  const camera = useScene((s) => s.camera);
  const selectPlace = useScene((s) => s.selectPlace);
  const gapsOn = useScene((s) => gapsActive(s.gapsVisible, s.profile));
  const pathStatus = useSceneSettings((s) => s.pathStatus);
  const access = useLayer("access", profile, scenarioId);
  const gaps = useGaps(profile, gapsOn);
  const gapData = useMemo(() => gapLines(gaps.data), [gaps.data]);
  const water = useScenarioWater(scenarioId);
  const flood = useLayer("flood", profile, scenarioId);
  const waste = useLayer("waste", profile, scenarioId, lensVisible.waste);
  const accessData = useMemo(() => normalizeLayer(access.data), [access.data]);
  const floodData = useMemo(() => normalizeLayer(flood.data), [flood.data]);
  const places = useMemo(() => pointFeatures(access.data), [access.data]);
  const wasteData = useMemo(() => normalizeLayer(waste.data), [waste.data]);

  // Start where the site says (scene.home, else its centre), once, unless the user already moved.
  const site = useSite().data;
  const framing = useRef({ moved: false, reframed: false });
  useEffect(() => {
    const map = mapRef.current;
    if (!site || !map || !shouldReframe(framing.current)) return;
    framing.current.reframed = true;
    const h = homeView(site);
    map.jumpTo({ center: [h.lon, h.lat] });
  }, [site]);

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

  // frame a resident's own rehearsed trip when a new trip arrives (not on every departure)
  const tripId = tripIdentity(myTrip?.geojson);
  // biome-ignore lint/correctness/useExhaustiveDependencies: frame once per trip identity
  useEffect(() => {
    const map = mapRef.current;
    const c = tripCoords(tripParsed);
    if (!map || !c.length) return;
    const lons = c.map((x) => x[0] as number);
    const lats = c.map((x) => x[1] as number);
    const box: [[number, number], [number, number]] = [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ];
    map.fitBounds(box, { padding: 80, pitch: 55, duration: prefersReducedMotion() ? 0 : 1600 });
  }, [tripId]);

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
    <section className="relative h-full w-full" aria-label="Lite map of Elmina">
      <MapGL
        ref={mapRef}
        mapboxAccessToken={ENV.mapboxToken}
        mapStyle="mapbox://styles/mapbox/standard"
        initialViewState={{
          longitude: homeView(site).lon,
          latitude: homeView(site).lat,
          zoom: 15,
          pitch: 55,
        }}
        onMoveStart={(e) => {
          if ((e as { originalEvent?: unknown }).originalEvent) framing.current.moved = true;
        }}
        style={{ width: "100%", height: "100%" }}
        reuseMaps
        onLoad={() => {
          lastPreset.current = undefined; // fresh style: re-apply
          applyLight();
        }}
        interactiveLayerIds={clickable}
        cursor="auto"
        onClick={(e: MapMouseEvent) => {
          const picking = useTripPick.getState().picking;
          if (picking) {
            useTripPick.getState().setPoint(picking, [e.lngLat.lng, e.lngLat.lat]);
            return;
          }
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
        {showAccess && (
          <StatusLines
            id="access"
            data={accessLineData(accessData, gapsOn, pathStatus)}
            withPlaces
          />
        )}
        {gapsOn && showAccess && <GapLines data={gapData} />}
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
        {whatIf && (
          <Source id="whatif" type="geojson" data={whatIf.geojson as never}>
            {(["before", "after", "touched"] as const).map((side) => (
              <Layer
                key={side}
                id={`whatif-${side}`}
                type="line"
                slot="top"
                // Only features the engine tagged as imagined: a real route is never drawn here.
                filter={["all", ["==", ["get", "whatif"], true], ["==", ["get", "side"], side]]}
                paint={{
                  "line-color": WHATIF_STYLE[side].color,
                  "line-width": WHATIF_STYLE[side].width,
                  "line-opacity": side === "before" ? 0.7 : 0.95,
                  ...(side === "before" ? { "line-dasharray": [2, 1.5] } : {}),
                }}
              />
            ))}
          </Source>
        )}
        {dayDots && (
          <Source id="day" type="geojson" data={dayDots as never}>
            <Layer
              id="day-residents"
              type="circle"
              slot="top"
              paint={{
                "circle-radius": ["case", ["get", "focus"], 8, 4],
                "circle-color": [
                  "match",
                  ["get", "state"],
                  "drive",
                  DAY_STYLE.drive.color,
                  "wait",
                  DAY_STYLE.wait.color,
                  DAY_STYLE.walk.color,
                ],
                "circle-stroke-color": ["case", ["get", "focus"], "#ffffff", "#000000"],
                "circle-stroke-width": ["case", ["get", "focus"], 2, 0.5],
              }}
            />
          </Source>
        )}
        {myTrip && (
          <Source id="my-trip" type="geojson" data={myTrip.geojson as never}>
            <Layer
              id="my-trip-normal-casing"
              type="line"
              slot="top"
              filter={[
                "all",
                ["==", ["geometry-type"], "LineString"],
                ["==", ["get", "kind"], "normal"],
              ]}
              layout={{ "line-cap": "round" }}
              paint={{ "line-color": TRIP_STYLE.normal.gap, "line-width": TRIP_STYLE.normal.width }}
            />
            {(["normal", "trip", "cut"] as const).map((kind) => (
              <Layer
                key={kind}
                id={`my-trip-${kind}`}
                type="line"
                slot="top"
                filter={[
                  "all",
                  ["==", ["geometry-type"], "LineString"],
                  ["==", ["get", "kind"], kind],
                ]}
                layout={{ "line-cap": "round" }}
                paint={{
                  "line-color": TRIP_STYLE[kind].color,
                  "line-width": TRIP_STYLE[kind].width * (kind === "cut" ? 0.6 : 0.8),
                  ...(kind === "normal" ? { "line-dasharray": [1.5, 1.2] } : {}),
                }}
              />
            ))}
          </Source>
        )}
        {you && (
          <Source id="my-trip-you" type="geojson" data={you as never}>
            <Layer
              id="my-trip-you"
              type="circle"
              slot="top"
              paint={{
                "circle-radius": 9,
                "circle-color": "#ffffff",
                "circle-stroke-color": TRIP_STYLE.trip.color,
                "circle-stroke-width": 4,
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
      {journey && (
        <div className="absolute bottom-2 left-2 max-h-[45%] w-80 max-w-[calc(100%-1rem)] overflow-y-auto">
          <JourneyStepList
            plan={journey}
            className="rounded-lg border border-line bg-card p-3 shadow"
          />
        </div>
      )}
      {/* Development Simulation: text version only on the lite map (spec §5.3) */}
      <DevsimTextPanel />
    </section>
  );
}
