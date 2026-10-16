import { useEffect, useRef } from "react";
import { Icon } from "../../ui/icons";
import { AssistantPanel } from "../assistant/AssistantPanel";
import { useChatDraft } from "../chat/chatDraftStore";
import { FloodNote } from "../map-ui/FloodNote";
import { MapStage } from "../map-ui/MapStage";
import { PathOverlay } from "../map-ui/PathOverlay";
import { PlaceOverlay } from "../map-ui/PlaceOverlay";
import { RouteTag } from "../map-ui/RouteTag";
import { SettingsPopover } from "../map-ui/SettingsPopover";
import { BottomSheet } from "./BottomSheet";
import { usePanel } from "./panelStore";
import { usePanelReserve } from "./usePanelReserve";

/** Full-bleed map; the assistant floats over it on the right (bottom sheet on phones, Task 8). */
export function MainPage() {
  const { open, setOpen, sheet, setSheet } = usePanel();
  const { wide, panelW, reserved, sheetH } = usePanelReserve();
  const streaming = useChatDraft((s) => s.streaming);
  const hideRef = useRef<HTMLButtonElement>(null);
  const showRef = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (open ? hideRef : showRef).current?.focus();
  }, [open]);
  // A question asked from the peeking sheet would otherwise answer out of sight.
  useEffect(() => {
    if (!wide && streaming && usePanel.getState().sheet === "peek") setSheet("half");
  }, [wide, streaming, setSheet]);
  const toggle = (v: boolean) => {
    moveFocus.current = true;
    setOpen(v);
  };

  return (
    <div
      className="relative h-full min-h-0"
      style={{ ["--panel-w" as string]: `${reserved}px`, ["--sheet-h" as string]: sheetH }}
    >
      <section aria-label="3D map of City of Elmina" className="absolute inset-0">
        <MapStage>
          <RouteTag />
          <FloodNote />
          <SettingsPopover />
          <PlaceOverlay />
          <PathOverlay />
        </MapStage>
      </section>
      {wide ? (
        <>
          <div
            className={`absolute bottom-4 right-4 top-4 z-20 flex flex-col transition-transform duration-200 ease-[cubic-bezier(.2,.7,.2,1)] ${
              open ? "translate-x-0" : "translate-x-[calc(100%+2rem)]"
            }`}
            style={{ width: panelW }}
            aria-hidden={!open}
            inert={!open}
          >
            <AssistantPanel />
            <button
              type="button"
              aria-label="Hide assistant"
              ref={hideRef}
              onClick={() => toggle(false)}
              className="glass absolute -left-11 top-4 grid size-11 place-items-center rounded-l-xl text-fg"
            >
              <Icon name="chevron" />
            </button>
          </div>
          {!open && (
            <button
              type="button"
              aria-label="Show assistant"
              ref={showRef}
              onClick={() => toggle(true)}
              className="glass absolute right-4 top-4 z-20 flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-fg"
            >
              <Icon name="chevron" className="size-5 rotate-180" />
              Assistant
            </button>
          )}
        </>
      ) : (
        <BottomSheet>
          <AssistantPanel compact={sheet === "peek"} flat />
        </BottomSheet>
      )}
    </div>
  );
}
