import type { CameraDriver, Engine } from "./engine";

/**
 * A mount's cleanup: drops its own camera driver and decorative clock only (an engine without the
 * release methods, e.g. a test fake, falls back to clearing the slot).
 */
export function releaseSlots(
  engine: Pick<
    Engine,
    "setCameraDriver" | "releaseCameraDriver" | "setDecorClock" | "releaseDecorClock"
  >,
  own: { driver?: CameraDriver | null; clock?: (() => number | null) | null },
): void {
  if (own.driver) {
    if (engine.releaseCameraDriver) engine.releaseCameraDriver(own.driver);
    else engine.setCameraDriver?.(null);
  }
  if (own.clock) {
    if (engine.releaseDecorClock) engine.releaseDecorClock(own.clock);
    else engine.setDecorClock?.(null);
  }
}
