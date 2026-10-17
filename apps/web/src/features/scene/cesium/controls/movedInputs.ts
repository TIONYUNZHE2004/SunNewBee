import type * as Cesium from "cesium";

/** Every input that moves the camera (Cesium keys handlers by type + modifier). */
export function movedInputs(C: typeof Cesium): [Cesium.ScreenSpaceEventType, number | undefined][] {
  const T = C.ScreenSpaceEventType;
  return [
    [T.LEFT_DOWN, undefined],
    [T.RIGHT_DOWN, undefined],
    [T.MIDDLE_DOWN, undefined],
    [T.WHEEL, undefined],
    [T.PINCH_START, undefined],
    [T.LEFT_DOWN, C.KeyboardEventModifier.CTRL],
    [T.WHEEL, C.KeyboardEventModifier.SHIFT],
    [T.LEFT_DOUBLE_CLICK, undefined],
  ];
}
