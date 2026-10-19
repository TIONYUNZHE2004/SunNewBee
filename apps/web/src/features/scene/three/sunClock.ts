/**
 * Pinned sun time (B-T4 fix round 1, coordinator ruling): acceptance runs and the demo recording
 * light the scene at one fixed moment, 10:30 MYT on a fixed date, so day shadows and shade sides
 * do not change with the hour a run happens. Normal users keep the real clock.
 *
 * The time feeds the existing `clock` mood source (`useMood`: `moodSource({ now })` and the key
 * light date in `moodKeyDir`). A pinned theme (Day / Dusk / Night) still wins over the clock for the
 * mood; the sun direction for Day comes from this time.
 *
 * Pinned when the page URL has `?sun=pinned` (the acceptance harness, `acceptance/support/
 * bookmarks.ts` `bookmarkUrl`) or by the demo preset (`?demo=1`, `features/demo/preset.ts`).
 */

/** 10:30 MYT (UTC+8) on the March 2026 equinox: a high morning sun from the east. */
export const PINNED_SUN_ISO = "2026-03-20T02:30:00Z";

let pinned: Date | null = null;

/** Pins the sun clock to `when` (null restores the real clock). */
export function pinSunClock(when: Date | null): void {
  pinned = when ? new Date(when.getTime()) : null;
}

/** The pinned time, else `real` (default: now). */
export function sunNow(real: Date = new Date()): Date {
  return pinned ? new Date(pinned.getTime()) : real;
}

export function sunClockPinned(): boolean {
  return pinned !== null;
}

/** True when the URL asks for the pinned sun (`?sun=pinned`). */
export function sunPinRequested(
  search: string = typeof location === "undefined" ? "" : location.search,
): boolean {
  return new URLSearchParams(search).get("sun") === "pinned";
}

/** Pins the sun at PINNED_SUN_ISO when the URL asks for it; returns whether it did. */
export function applySunPin(search?: string): boolean {
  if (!sunPinRequested(search)) return false;
  pinSunClock(new Date(PINNED_SUN_ISO));
  return true;
}
