import { useScene } from "../scene/sceneStore";
import { ROUTE_STYLE } from "../scene/styles";

export function RouteTag() {
  const route = useScene((s) => s.route);
  const clearRoute = useScene((s) => s.clearRoute);
  if (!route) return null;
  return (
    <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full border border-edge bg-surface/95 py-1 pl-3 pr-1 text-sm text-fg shadow-md">
      <svg width="28" height="8" aria-hidden="true">
        <line x1="2" y1="4" x2="26" y2="4" stroke={ROUTE_STYLE.color} strokeWidth="6" />
      </svg>
      <span>{ROUTE_STYLE.label}</span>
      <button
        type="button"
        aria-label="Clear route from map"
        onClick={clearRoute}
        className="grid size-10 place-items-center rounded-full text-fg-soft hover:bg-raised"
      >
        ×
      </button>
    </div>
  );
}
