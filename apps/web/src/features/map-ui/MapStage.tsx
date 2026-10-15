import { Component, lazy, type ReactNode, Suspense, useEffect, useMemo } from "react";
import { ENV } from "../../lib/env";
import { ListView } from "../scene/list/ListView";
import { useScene } from "../scene/sceneStore";
import { availableViews, selectView, type View } from "../scene/selectView";

const webglSupported = () => {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
};

const CesiumScene = lazy(() => import("../scene/cesium/CesiumScene"));
const MapboxLite = lazy(() => import("../scene/mapbox/MapboxLite"));

let autoSelected = false;

/** A renderer that fails to load or crashes (WebGL, chunk, bad key) falls back to the list. */
class RendererBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** The renderer area only; chrome (cards, notes, settings) arrives as children. */
export function MapStage({ children }: { children?: ReactNode }) {
  const { view, setView } = useScene();
  const webglOk = useMemo(webglSupported, []);
  const available = useMemo(() => availableViews(ENV, webglOk), [webglOk]);

  // Auto-select once per page load; never overwrite a view the user chose before a remount.
  useEffect(() => {
    if (autoSelected) return;
    autoSelected = true;
    setView(selectView(ENV, webglOk));
  }, [webglOk, setView]);

  const has3d = available.some((v) => v !== "list");
  const effective: View = available.includes(view) ? view : "list";
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
      {effective === "list" ? (
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
        <RendererBoundary key={effective} fallback={listFallback}>
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
