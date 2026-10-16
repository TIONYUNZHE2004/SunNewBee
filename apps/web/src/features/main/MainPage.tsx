import { useEffect, useState } from "react";
import { Icon } from "../../ui/icons";
import { AssistantPanel } from "../assistant/AssistantPanel";
import { FloodNote } from "../map-ui/FloodNote";
import { MapStage } from "../map-ui/MapStage";
import { PathOverlay } from "../map-ui/PathOverlay";
import { PlaceOverlay } from "../map-ui/PlaceOverlay";
import { RouteTag } from "../map-ui/RouteTag";
import { SettingsPopover } from "../map-ui/SettingsPopover";
import { usePanel } from "./panelStore";
import { PANEL_INSET_PX, panelWidthPx } from "./viewport";

const useWide = () => {
  const q = "(min-width: 1024px)";
  const [wide, setWide] = useState(() => typeof matchMedia === "function" && matchMedia(q).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const m = matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
};

/** Full-bleed map; the assistant floats over it on the right (bottom sheet on phones, Task 8). */
export function MainPage() {
  const { open, setOpen } = usePanel();
  const wide = useWide();
  const [vw, setVw] = useState(() => (typeof innerWidth === "number" ? innerWidth : 1440));
  useEffect(() => {
    const on = () => setVw(innerWidth);
    addEventListener("resize", on);
    return () => removeEventListener("resize", on);
  }, []);
  const panelW = panelWidthPx(vw);
  const reserved = wide && open ? panelW + PANEL_INSET_PX * 2 : 0;

  return (
    <div className="relative h-full min-h-0" style={{ ["--panel-w" as string]: `${reserved}px` }}>
      <section aria-label="3D map of City of Elmina" className="absolute inset-0">
        <MapStage>
          <RouteTag />
          <FloodNote />
          <SettingsPopover />
          <PlaceOverlay />
          <PathOverlay />
        </MapStage>
      </section>
      <div
        className={`absolute bottom-4 right-4 top-4 z-20 flex flex-col transition-transform duration-200 ease-[cubic-bezier(.2,.7,.2,1)] ${
          open ? "translate-x-0" : "translate-x-[calc(100%+2rem)]"
        }`}
        style={{ width: wide ? panelW : "calc(100% - 2rem)" }}
        aria-hidden={!open}
        inert={!open}
      >
        <AssistantPanel />
        <button
          type="button"
          aria-label="Hide assistant"
          onClick={() => setOpen(false)}
          className="glass absolute -left-11 top-4 grid size-11 place-items-center rounded-l-xl text-fg"
        >
          <Icon name="chevron" />
        </button>
      </div>
      {!open && (
        <button
          type="button"
          aria-label="Show assistant"
          onClick={() => setOpen(true)}
          className="glass absolute right-4 top-4 z-20 flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-fg"
        >
          <Icon name="chevron" className="size-5 rotate-180" />
          Assistant
        </button>
      )}
    </div>
  );
}
