import { useDevsim } from "../../devsim/devsimStore";
import { DevsimListSection } from "./DevsimListSection";

/**
 * The Development Simulation text version as a panel over a map that cannot play it (Mapbox lite,
 * spec §5.3 "text version only"); nothing while no simulation is active.
 */
export function DevsimTextPanel() {
  const active = useDevsim((s) => s.status !== "idle");
  if (!active) return null;
  return (
    <div
      data-testid="devsim-text-panel"
      className="absolute bottom-2 left-2 z-10 max-h-[60%] w-96 max-w-[calc(100%-1rem)] overflow-y-auto"
    >
      <DevsimListSection />
    </div>
  );
}
