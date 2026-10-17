const RAD = Math.PI / 180;

/** NOAA general solar position. Azimuth is from north, clockwise (east = 90 degrees). */
export function sunPosition(
  date: Date,
  lat: number,
  lon: number,
): { azimuthRad: number; elevationRad: number } {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((date.getTime() - startOfYear) / 86_400_000) + 1;
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hours - 12) / 24);

  const eqTimeMin =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  // True solar time in minutes, from UTC and longitude (east positive).
  const solarMin = hours * 60 + eqTimeMin + 4 * lon;
  const ha = (solarMin / 4 - 180) * RAD;
  const latR = lat * RAD;

  const sinEl = Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(ha);
  const elevationRad = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  // Azimuth from north, clockwise: east component and north component of the sun direction.
  const east = -Math.cos(decl) * Math.sin(ha);
  const north = Math.sin(decl) * Math.cos(latR) - Math.cos(decl) * Math.cos(ha) * Math.sin(latR);
  const azimuthRad = (Math.atan2(east, north) + 2 * Math.PI) % (2 * Math.PI);
  return { azimuthRad, elevationRad };
}

/** Unit vector toward the sun in the local frame (x east, y up, z = -north). */
export function sunVector(azimuthRad: number, elevationRad: number): [number, number, number] {
  const c = Math.cos(elevationRad);
  return [c * Math.sin(azimuthRad), Math.sin(elevationRad), -c * Math.cos(azimuthRad)];
}
