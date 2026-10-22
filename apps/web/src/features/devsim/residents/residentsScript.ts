/**
 * Simulated residents beats (spec §6.3, AC-W7): the button appears at 33 s; while playing, a
 * scripted "tap" opens the panel at 39 s and the scripted resident (Mei Ling) at 41 s, unless the
 * user has already opened or closed it themselves. Pure: the layer applies the actions.
 */

export const RES_BUTTON_AT = 33;
export const RES_PANEL_AT = 39;
export const RES_DETAIL_AT = 41;
/** The resident the scripted tap opens (a cast id from `devsim_residents`). */
export const SCRIPTED_RESIDENT = "meiling";

export type ScriptAction =
  | { kind: "open-panel" }
  | { kind: "open-detail"; id: string }
  | { kind: "close" }
  | { kind: "reset" };

export const buttonVisible = (t: number) => t >= RES_BUTTON_AT;

/**
 * Actions for moving the playhead from `prevT` to `t`.
 * - Before 33 s: close and reset (the button is hidden; a replay runs the script again).
 * - Seeking back below 39 s closes a panel the script opened.
 * - Crossing 39 s / 41 s while playing, without a user touch: open the panel / the resident.
 */
export function scriptStep(
  prevT: number,
  t: number,
  playing: boolean,
  userTouched: boolean,
  scriptedId: string = SCRIPTED_RESIDENT,
): ScriptAction[] {
  if (t < RES_BUTTON_AT) return [{ kind: "close" }, { kind: "reset" }];
  if (userTouched) return [];
  if (t < RES_PANEL_AT && prevT >= RES_PANEL_AT) return [{ kind: "close" }];
  if (!playing) return [];
  const out: ScriptAction[] = [];
  if (prevT < RES_PANEL_AT && t >= RES_PANEL_AT) out.push({ kind: "open-panel" });
  if (prevT < RES_DETAIL_AT && t >= RES_DETAIL_AT)
    out.push({ kind: "open-detail", id: scriptedId });
  return out;
}
