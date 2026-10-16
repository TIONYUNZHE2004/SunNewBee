import { useEffect, useState } from "react";
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

/** Width of the floating assistant panel and the map width it covers (0 when closed or narrow). */
export function usePanelReserve() {
  const open = usePanel((s) => s.open);
  const wide = useWide();
  const [vw, setVw] = useState(() => (typeof innerWidth === "number" ? innerWidth : 1440));
  useEffect(() => {
    const on = () => setVw(innerWidth);
    addEventListener("resize", on);
    return () => removeEventListener("resize", on);
  }, []);
  const panelW = panelWidthPx(vw);
  return { wide, panelW, reserved: wide && open ? panelW + PANEL_INSET_PX * 2 : 0 };
}
