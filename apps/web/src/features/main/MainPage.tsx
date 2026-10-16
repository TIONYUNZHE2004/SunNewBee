import { AssistantPanel } from "../assistant/AssistantPanel";
import { DayTag } from "../map-ui/DayTag";
import { FloodNote } from "../map-ui/FloodNote";
import { MapStage } from "../map-ui/MapStage";
import { PathOverlay } from "../map-ui/PathOverlay";
import { PlaceOverlay } from "../map-ui/PlaceOverlay";
import { RolloutTag } from "../map-ui/RolloutTag";
import { RouteTag } from "../map-ui/RouteTag";
import { SettingsPopover } from "../map-ui/SettingsPopover";
import { WhatIfTag } from "../map-ui/WhatIfTag";
import { useRolloutPlayback } from "../whatif/useRolloutPlayback";

/** Map on the left, assistant on the right; stacked (map first) below `lg`. */
export function MainPage() {
  useRolloutPlayback();
  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(340px,2fr)]">
      <section
        aria-label="3D map of City of Elmina"
        className="h-[56vh] min-h-72 lg:h-full lg:min-h-0"
      >
        <MapStage>
          <RouteTag />
          <WhatIfTag />
          <RolloutTag />
          <DayTag />
          <FloodNote />
          <SettingsPopover />
          <PlaceOverlay />
          <PathOverlay />
        </MapStage>
      </section>
      <div className="flex min-h-[60vh] min-w-0 flex-col lg:min-h-0">
        <AssistantPanel />
      </div>
    </div>
  );
}
