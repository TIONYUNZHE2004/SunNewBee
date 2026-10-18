import { useEffect, useRef } from "react";
import { ModeSwitch } from "../../app/ModeSwitch";
import { useSite } from "../../lib/api";
import { Icon } from "../../ui/icons";
import { AssistantPanel } from "../assistant/AssistantPanel";
import { useChatDraft } from "../chat/chatDraftStore";
import { useDayPlayback } from "../day/useDayPlayback";
import { BuildingCard } from "../map-ui/BuildingCard";
import { DayTag } from "../map-ui/DayTag";
import { FloodNote } from "../map-ui/FloodNote";
import { MapStage } from "../map-ui/MapStage";
import { InSlot } from "../map-ui/mapSlots";
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

/** Top-left of the map card: wordmark and site on one line, then the perspective switch. */
function MapPill() {
  const site = useSite();
  return (
    <div className="glass flex items-center gap-3 rounded-full py-1 pl-4 pr-1">
      <p className="m-0 whitespace-nowrap text-sm">
        <span className="font-semibold tracking-tight">TownshipLens</span>
        {site.data && <span className="text-fg-soft"> · {site.data.name}</span>}
      </p>
      <ModeSwitch size="sm" />
    </div>
  );
}

/**
 * Wide screens: the map is a rounded card and the assistant docks beside it as its own card (it
 * never covers the map). Phones: full-bleed map with the assistant in a bottom sheet (Task 8).
 */
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
      <div className={`flex h-full ${wide ? "gap-3" : ""}`}>
        <section
          aria-label="3D map of City of Elmina"
          className={`relative min-w-0 flex-1 overflow-hidden ${
            wide ? "rounded-3xl border border-edge bg-surface shadow-[var(--c-shadow)]" : ""
          }`}
        >
          <MapStage>
            {wide && (
              <InSlot name="brand">
                <MapPill />
              </InSlot>
            )}
            <RouteTag />
            <WhatIfTag />
            <RolloutTag />
            <DayTag />
            <FloodNote />
            <SettingsPopover />
            <PlaceOverlay />
            <PathOverlay />
            <SignCard />
            <BuildingCard />
          </MapStage>
          {wide && !open && (
            <button
              type="button"
              aria-label="Show assistant"
              ref={showRef}
              onClick={() => toggle(true)}
              className="glass absolute right-3 top-3 z-20 flex min-h-11 items-center gap-2 rounded-full pl-3 pr-4 text-sm font-medium text-fg"
            >
              <Icon name="chat" className="size-5" />
              Assistant
            </button>
          )}
        </section>
        {wide && (
          <div
            className={`relative flex shrink-0 flex-col overflow-hidden transition-[width,opacity] duration-200 ease-[cubic-bezier(.2,.7,.2,1)] motion-reduce:transition-none ${
              open ? "opacity-100" : "opacity-0"
            }`}
            style={{ width: open ? panelW : 0 }}
            aria-hidden={!open}
            inert={!open}
          >
            <div className="flex h-full min-h-0 flex-col" style={{ width: panelW }}>
              <AssistantPanel />
            </div>
            <button
              type="button"
              aria-label="Hide assistant"
              ref={hideRef}
              onClick={() => toggle(false)}
              className="absolute right-3 top-3 grid size-9 place-items-center rounded-full text-fg-soft transition-colors hover:bg-fg/5 hover:text-fg"
            >
              <Icon name="close" className="size-4" />
            </button>
          </div>
        )}
      </div>
      {!wide && (
        <BottomSheet attribution={attribution}>
          <AssistantPanel compact={sheet === "peek"} flat />
        </BottomSheet>
      )}
    </div>
  );
}
