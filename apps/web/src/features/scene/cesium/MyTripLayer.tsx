import * as Cesium from "cesium";
import { useEffect, useMemo } from "react";
import { Entity, LabelGraphics, PointGraphics, PolylineGraphics, useCesium } from "resium";
import { type ParsedTrip, parseTrip, TRIP_STYLE, tripPositionAt } from "../../day/tripModel";
import { useScene } from "../sceneStore";

const flat = (coords: number[][]) => coords.flatMap((c) => [c[0] as number, c[1] as number]);
const toCartesians = (coords: number[][]) => Cesium.Cartesian3.fromDegreesArray(flat(coords));

/** A resident's own rehearsed trip on the 3D map (Cycle 20): the usual route on a normal day
 * (white dashes), the pieces flooded when they leave (red glow), the trip the engine rehearsed
 * (yellow) and "You" at the rehearsal clock. Every line comes from the engine; display only.
 * The lines are built once per trip; only "You" follows the clock (review C20: rebuilding the
 * ground polylines every tick was costly). */
export function MyTripLayer() {
  const { viewer } = useCesium();
  const myTrip = useScene((s) => s.myTrip);
  const trip = useMemo(() => parseTrip(myTrip?.geojson), [myTrip]);
  const lines = useMemo(
    () =>
      trip
        ? {
            normal: trip.normal && trip.normal.length >= 2 ? toCartesians(trip.normal) : null,
            segs: trip.segs.filter((s) => s.coords.length >= 2).map((s) => toCartesians(s.coords)),
            cut: trip.cut.filter((c) => c.length >= 2).map(toCartesians),
          }
        : null,
    [trip],
  );
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: render trigger (requestRenderMode)
  useEffect(() => {
    if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender();
  }, [viewer, lines]);

  if (!trip || !lines) return null;
  const line = (
    positions: Cesium.Cartesian3[],
    width: number,
    material: Cesium.MaterialProperty | Cesium.Color,
  ) => (
    <PolylineGraphics
      positions={positions}
      width={width}
      clampToGround
      classificationType={Cesium.ClassificationType.BOTH}
      material={material}
    />
  );
  return (
    <>
      {lines.normal && <Entity>{line(lines.normal, TRIP_STYLE.normal.width, mats.normal)}</Entity>}
      {lines.segs.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the segments are fixed per trip
        <Entity key={`trip-${i}`}>{line(p, TRIP_STYLE.trip.width, mats.trip)}</Entity>
      ))}
      {lines.cut.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the cut pieces are fixed per trip
        <Entity key={`cut-${i}`}>{line(p, TRIP_STYLE.cut.width, mats.cut)}</Entity>
      ))}
      <You trip={trip} />
    </>
  );
}

/** "You" at the rehearsal clock: the only part that re-renders as the clock runs. */
function You({ trip }: { trip: ParsedTrip }) {
  const { viewer } = useCesium();
  const t = useScene((s) => s.day.t);
  const on = useScene((s) => s.day.on);
  // with no way at all the trip never moved: "you" stand at the start of the usual route
  const start = trip.normal?.[0];
  const here = on
    ? (tripPositionAt(trip.segs, t) ??
      (start
        ? { lon: start[0] as number, lat: start[1] as number, state: "no_way" as const }
        : null))
    : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: render triggers (requestRenderMode)
  useEffect(() => {
    if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender();
  }, [viewer, here?.lon, here?.lat, here?.state]);
  if (!here) return null;
  const alarm = here.state === "waiting" || here.state === "no_way";
  const label =
    here.state === "waiting"
      ? "You · waiting"
      : here.state === "no_way"
        ? "You · no way through"
        : "You";
  return (
    <Entity position={Cesium.Cartesian3.fromDegrees(here.lon, here.lat, 4)} name="You">
      <PointGraphics
        pixelSize={here.state === "moving" ? 18 : 16}
        color={Cesium.Color.WHITE}
        outlineColor={Cesium.Color.fromCssColorString(
          alarm ? TRIP_STYLE.cut.color : TRIP_STYLE.trip.color,
        )}
        outlineWidth={4}
        disableDepthTestDistance={Number.POSITIVE_INFINITY}
      />
      <LabelGraphics
        text={label}
        font="600 13px sans-serif"
        fillColor={Cesium.Color.WHITE}
        outlineColor={Cesium.Color.BLACK}
        outlineWidth={3}
        style={Cesium.LabelStyle.FILL_AND_OUTLINE}
        pixelOffset={new Cesium.Cartesian2(0, -24)}
        disableDepthTestDistance={Number.POSITIVE_INFINITY}
      />
    </Entity>
  );
}
