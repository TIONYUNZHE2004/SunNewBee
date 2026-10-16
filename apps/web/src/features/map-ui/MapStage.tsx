import { Component, lazy, type ReactNode, Suspense, useEffect, useMemo } from "react";
import { ENV } from "../../lib/env";
import { ListView } from "../scene/list/ListView";
import { useScene } from "../scene/sceneStore";
import { availableViews, effectiveView, selectView, webglSupported } from "../scene/selectView";
import { useMapStyle } from "../scene/useMapStyle";

const CesiumScene = lazy(() => import("../scene/cesium/CesiumScene"));
const MapboxLite = lazy(() => import("../scene/mapbox/MapboxLite"));

let autoSelected = false;

/** A renderer that fails to load or crashes (WebGL, chunk, bad key) falls back to the list. */
class RendererBoundary extends Component<
  { fallback: ReactNode; children: ReactNode; onFail?: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail?.();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** The renderer area only; chrome (cards, notes, settings) arrives as children. */
export function MapStage({ children }: { children?: ReactNode }) {
  const { view, setView, setRendererFailed } = useScene();
  const applyDefaultMapStyle = useScene((s) => s.applyDefaultMapStyle);
  const { hasBuildings, hasGoogle, settled } = useMapStyle();
  const webglOk = useMemo(webglSupported, []);
  const available = useMemo(
    () => availableViews(ENV, webglOk, hasBuildings),
    [webglOk, hasBuildings],
  );
  // Keyless worlds can still get the 3D (stylised) city once buildings data arrives: wait for it.
  const waiting = !autoSelected && !settled && webglOk && !available.includes("cesium");

  // Auto-select once per page load; never overwrite a view the user chose before a remount.
  useEffect(() => {
    if (autoSelected || waiting) return;
    autoSelected = true;
    setView(selectView(ENV, webglOk, undefined, hasBuildings));
  }, [webglOk, setView, waiting, hasBuildings]);

  // Stylised by default when the world has buildings, unless the user picked a style.
  useEffect(() => {
    if (settled) applyDefaultMapStyle(hasBuildings, hasGoogle);
  }, [settled, hasBuildings, hasGoogle, applyDefaultMapStyle]);

  const has3d = available.some((v) => v !== "list");
  const effective = effectiveView(view, available, false);
  const listFallback = (
    <div className="h-full space-y-3 overflow-auto p-4">
      <p role="alert" className="rounded-lg border border-rose bg-raised px-4 py-3 text-sm text-fg">
        The map could not be shown on this device. Showing the list instead.
      </p>
      <ListView />
    </div>
  );

  return (
    <div className="relative h-full min-h-72 overflow-hidden bg-surface">
      {waiting ? (
        <p role="status" className="p-4 text-fg-soft">
          Loading the township
        </p>
      ) : effective === "list" ? (
        <div className="h-full space-y-3 overflow-auto p-4">
          {!has3d && (
            <p
              role="status"
              className="rounded-lg border border-edge bg-raised px-4 py-3 text-sm text-fg"
            >
              3D map couldn't load. Showing the list view instead. Everything the assistant does
              still works here.
            </p>
          )}
          <ListView />
        </div>
      ) : (
        <RendererBoundary
          key={effective}
          fallback={listFallback}
          onFail={() => setRendererFailed(true)}
        >
          <Suspense
            fallback={
              <p role="status" className="p-4 text-fg-soft">
                Loading the township
              </p>
            }
          >
            {effective === "cesium" ? <CesiumScene /> : <MapboxLite />}
          </Suspense>
        </RendererBoundary>
      )}
      {children}
    </div>
  );
}
