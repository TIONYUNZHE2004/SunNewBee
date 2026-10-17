import * as Cesium from "cesium";
import { useEffect, useMemo } from "react";
import { Entity, LabelGraphics, PointGraphics, PolylineGraphics, useCesium } from "resium";
import { parseTrip, TRIP_STYLE, tripPositionAt } from "../../day/tripModel";
import { useScene } from "../sceneStore";

const flat = (coords: number[][]) => coords.flatMap((c) => [c[0] as number, c[1] as number]);

/** A resident's own rehearsed trip on the 3D map (Cycle 20): the usual route on a normal day
 * (grey, dashed), the pieces flooded when they leave (red), the trip the engine rehearsed
 * (yellow) and "You" at the rehearsal clock. Every line comes from the engine; display only. */
export function MyTripLayer() {
  const { viewer } = useCesium();
  const myTrip = useScene((s) => s.myTrip);
  const t = useScene((s) => s.day.t);
  const on = useScene((s) => s.day.on);
  const trip = useMemo(() => parseTrip(myTrip?.geojson), [myTrip]);
  const mats = useMemo(
    () => ({
      normal: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.fromCssColorString(TRIP_STYLE.normal.color),
        gapColor: Cesium.Color.fromCssColorString(TRIP_STYLE.normal.gap),
        dashLength: 18,
      }),
      // a glow, so the cut stands out from the flat flood layer underneath
      cut: new Cesium.PolylineGlowMaterialProperty({
        color: Cesium.Color.fromCssColorString(TRIP_STYLE.cut.color),
        glowPower: 0.35,
        taperPower: 1,
      }),
      // ground-clamped lines take a plain colour (an outline material is not drawn on them)
      trip: Cesium.Color.fromCssColorString(TRIP_STYLE.trip.color),
    }),
    [],
  );
  // with no way at all the trip never moved: "you" stand at the start of the usual route
  const start = trip?.normal?.[0];
  const here =
    trip && on
      ? (tripPositionAt(trip.segs, t) ??
        (start
          ? { lon: start[0] as number, lat: start[1] as number, state: "no_way" as const }
          : null))
      : null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: render triggers (requestRenderMode)
  useEffect(() => {
    if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender();
  }, [viewer, trip, here?.lon, here?.lat, here?.state]);

  if (!trip) return null;
  const line = (
    coords: number[][],
    width: number,
    material: Cesium.MaterialProperty | Cesium.Color,
  ) =>
    coords.length >= 2 ? (
      <PolylineGraphics
        positions={Cesium.Cartesian3.fromDegreesArray(flat(coords))}
        width={width}
        clampToGround
        classificationType={Cesium.ClassificationType.BOTH}
        material={material}
      />
    ) : null;
  return (
    <>
      {trip.normal && <Entity>{line(trip.normal, TRIP_STYLE.normal.width, mats.normal)}</Entity>}
      {trip.segs.map((s) => (
        <Entity key={`trip-${s.t0}`}>{line(s.coords, TRIP_STYLE.trip.width, mats.trip)}</Entity>
      ))}
      {trip.cut.map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the cut pieces are fixed per trip
        <Entity key={`cut-${i}`}>{line(c, TRIP_STYLE.cut.width, mats.cut)}</Entity>
      ))}
      {here && (
        <Entity position={Cesium.Cartesian3.fromDegrees(here.lon, here.lat, 4)} name="You">
          <PointGraphics
            pixelSize={here.state === "moving" ? 18 : 16}
            color={Cesium.Color.WHITE}
            outlineColor={Cesium.Color.fromCssColorString(
              here.state === "waiting" || here.state === "no_way"
                ? TRIP_STYLE.cut.color
                : TRIP_STYLE.trip.color,
            )}
            outlineWidth={4}
            disableDepthTestDistance={Number.POSITIVE_INFINITY}
          />
          <LabelGraphics
            text={
              here.state === "waiting"
                ? "You · waiting"
                : here.state === "no_way"
                  ? "You · no way through"
                  : "You"
            }
            font="600 13px sans-serif"
            fillColor={Cesium.Color.WHITE}
            outlineColor={Cesium.Color.BLACK}
            outlineWidth={3}
            style={Cesium.LabelStyle.FILL_AND_OUTLINE}
            pixelOffset={new Cesium.Cartesian2(0, -24)}
            disableDepthTestDistance={Number.POSITIVE_INFINITY}
          />
        </Entity>
      )}
    </>
  );
}
