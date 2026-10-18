import { useEffect, useRef } from "react";
import { Icon } from "../../ui/icons";
import { AssistantPanel } from "../assistant/AssistantPanel";
import { useChatDraft } from "../chat/chatDraftStore";
import { useDayPlayback } from "../day/useDayPlayback";
import { DayTag } from "../map-ui/DayTag";
import { FloodNote } from "../map-ui/FloodNote";
import { MapStage } from "../map-ui/MapStage";
import { PathOverlay } from "../map-ui/PathOverlay";
import { PlaceOverlay } from "../map-ui/PlaceOverlay";
import { RolloutTag } from "../map-ui/RolloutTag";
import { RouteTag } from "../map-ui/RouteTag";
import { SettingsPopover } from "../map-ui/SettingsPopover";
import { SignCard } from "../map-ui/SignCard";
import { WhatIfTag } from "../map-ui/WhatIfTag";
import { useRolloutPlayback } from "../whatif/useRolloutPlayback";
import { BottomSheet } from "./BottomSheet";
import { usePanel } from "./panelStore";
import { useAttribution } from "./useAttribution";
import { usePanelReserve, useSheetPeekOnNarrow } from "./usePanelReserve";
import { useTopStackHeight } from "./useTopStackHeight";

/** Full-bleed map; the assistant floats over it on the right (bottom sheet on phones, Task 8). */
export function MainPage() {
  const { open, setOpen, sheet, setSheet } = usePanel();
  const { wide, panelW, reserved, sheetH } = usePanelReserve();
  const attribution = useAttribution();
  const streaming = useChatDraft((s) => s.streaming);
  const pendingAsk = useChatDraft((s) => s.pendingAsk);
  const rootRef = useRef<HTMLDivElement>(null);
  const topH = useTopStackHeight(rootRef);
  useSheetPeekOnNarrow();
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
  // An ask from elsewhere (Tickets "Ask the question again") would otherwise stream into a
  // hidden, inert panel on wide screens.
  useEffect(() => {
    if (wide && (streaming || pendingAsk) && !usePanel.getState().open) setOpen(true);
  }, [wide, streaming, pendingAsk, setOpen]);
  const toggle = (v: boolean) => {
    moveFocus.current = true;
    setOpen(v);
  };

  useRolloutPlayback();
  useDayPlayback();
  return (
    // `absolute inset-0`, not `h-full`: below lg the Shell has no definite height, so `h-full`
    // would collapse to 0 px (all children are absolute) and push the sheet under the header.
    <div
      ref={rootRef}
      className="absolute inset-0"
      style={{
        ["--panel-w" as string]: `${reserved}px`,
        ["--sheet-h" as string]: sheetH,
        ...(topH === null ? {} : { ["--top-h" as string]: `${topH}px` }),
      }}
    >
      <section aria-label="3D map of City of Elmina" className="absolute inset-0">
        <MapStage>
          <RouteTag />
          <WhatIfTag />
          <RolloutTag />
          <DayTag />
          <FloodNote />
          <SettingsPopover />
          <PlaceOverlay />
          <PathOverlay />
          <SignCard />
        </MapStage>
      </section>
      {wide ? (
        <>
          <div
            className={`absolute bottom-4 right-4 top-4 z-20 flex flex-col transition-transform duration-200 ease-[cubic-bezier(.2,.7,.2,1)] motion-reduce:transition-none ${
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
        <BottomSheet attribution={attribution}>
          <AssistantPanel compact={sheet === "peek"} flat />
        </BottomSheet>
      )}
    </div>
  );
}
