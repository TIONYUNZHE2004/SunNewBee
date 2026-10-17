import { useEffect, useState } from "react";
import { SHEET_HEIGHTS } from "./BottomSheet";
import { usePanel } from "./panelStore";
import { PANEL_INSET_PX, panelWidthPx } from "./viewport";

const Q = "(min-width: 1024px)";

export const isWide = () => typeof matchMedia === "function" && matchMedia(Q).matches;

export function useWide() {
  const [wide, setWide] = useState(isWide);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const m = matchMedia(Q);
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

/**
 * Going narrow (rotation, window resize) starts the phone sheet at peek. A sheet left at `full`
 * would hide the map controls at once and drop focus from an open settings popover to the body.
 * Reset in the media listener itself, not in an effect: a MainPage effect would run after the
 * child SettingsPopover's close-on-hidden effect. Here the reset is queued in the same task as the
 * width change, so React normally commits them together (verified under act() batching only).
 */
export function useSheetPeekOnNarrow() {
  const setSheet = usePanel((s) => s.setSheet);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const m = matchMedia(Q);
    const on = () => {
      if (!m.matches) setSheet("peek");
    };
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [setSheet]);
}

/** Width of the floating assistant panel and the map width it covers (0 when closed or narrow). */
export function usePanelReserve() {
  const open = usePanel((s) => s.open);
  const sheet = usePanel((s) => s.sheet);
  const wide = useWide();
  const [vw, setVw] = useState(() => (typeof innerWidth === "number" ? innerWidth : 1440));
  useEffect(() => {
    const on = () => setVw(innerWidth);
    addEventListener("resize", on);
    return () => removeEventListener("resize", on);
  }, []);
  const panelW = panelWidthPx(vw);
  return {
    wide,
    panelW,
    reserved: wide && open ? panelW + PANEL_INSET_PX * 2 : 0,
    /** Height the phone bottom sheet covers (CSS length); "0px" on wide screens. */
    sheetH: wide ? "0px" : SHEET_HEIGHTS[sheet],
  };
}

/**
 * Phones with the sheet at `full`: map controls (settings gear, camera cluster) would sit off-screen
 * or under the sheet, so they hide (`invisible` also drops them from the tab order, WCAG 2.4.11).
 */
export function useBehindFullSheet() {
  const wide = useWide();
  const sheet = usePanel((s) => s.sheet);
  return !wide && sheet === "full";
}
