import { useScene } from "../scene/sceneStore";
import { ROUTE_STYLE, statusStyle } from "../scene/styles";
import { InSlot } from "./mapSlots";

/** The journey ribbon's legend (PASS solid, UNKNOWN dashes), as drawn by `journeyLayer.ts`. */
function RibbonLegend() {
  const ok = statusStyle("ok");
  const unknown = statusStyle("unknown");
  return (
    <span data-testid="ribbon-legend" className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="flex items-center gap-1.5">
        <svg width="24" height="10" aria-hidden="true">
          <line x1="2" y1="5" x2="22" y2="5" stroke="#fff" strokeWidth="8" strokeLinecap="round" />
          <line
            x1="2"
            y1="5"
            x2="22"
            y2="5"
            stroke={ok.color}
            strokeWidth="5"
            strokeLinecap="round"
          />
        </svg>
        {ok.label}
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="24" height="10" aria-hidden="true">
          <line x1="2" y1="5" x2="22" y2="5" stroke="#fff" strokeWidth="8" strokeLinecap="round" />
          <line
            x1="2"
            y1="5"
            x2="22"
            y2="5"
            stroke={unknown.color}
            strokeWidth="5"
            strokeDasharray="6 3"
          />
        </svg>
        {unknown.label}
      </span>
    </span>
  );
}

export function RouteTag() {
  const route = useScene((s) => s.route);
  const journey = useScene((s) => s.journey);
  const clearRoute = useScene((s) => s.clearRoute);
  if (!route && !journey) return null;
  return (
    <InSlot name="route">
      <div className="flex items-center gap-2 glass rounded-2xl py-1 pl-3 pr-1 text-sm text-fg motion-safe:animate-[fadeIn_200ms_ease-out]">
        {journey ? (
          // While a trip is loaded the route is drawn as the trip ribbon, coloured by status.
          <RibbonLegend />
        ) : (
          <>
            <svg width="28" height="8" aria-hidden="true">
              <line x1="2" y1="4" x2="26" y2="4" stroke={ROUTE_STYLE.color} strokeWidth="6" />
            </svg>
            <span>{ROUTE_STYLE.label}</span>
          </>
        )}
        <button
          type="button"
          aria-label="Clear route from map"
          onClick={clearRoute}
          className="grid size-11 place-items-center rounded-full text-fg-soft hover:bg-raised"
        >
          ×
        </button>
      </div>
    </InSlot>
  );
}
