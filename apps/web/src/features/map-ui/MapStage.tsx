import { Component, lazy, type ReactNode, Suspense, useEffect, useMemo } from "react";
import { ENV } from "../../lib/env";
import { ListView } from "../scene/list/ListView";
import { useScene } from "../scene/sceneStore";
import { availableViews, effectiveView, selectView, webglSupported } from "../scene/selectView";
import { rendererFor, stylisedEngine } from "../scene/three/engineChoice";
import { useMapStyle } from "../scene/useMapStyle";
import { LoadingTownship } from "./LoadingTownship";
import { BottomStack, InSlot, TopStack } from "./mapSlots";

const CesiumScene = lazy(() => import("../scene/cesium/CesiumScene"));
const ThreeScene = lazy(() => import("../scene/three/ThreeScene"));
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

const LIST_FALLBACK_TEXT = "The map could not be shown on this device. Showing the list instead.";
const MAPBOX_FALLBACK_TEXT =
  "The 3D map could not be shown on this device. Showing the 2D map instead.";

function FailedAlert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-lg border border-rose bg-raised px-4 py-3 text-sm text-fg">
      {children}
    </p>
  );
}

/** The renderer area only; chrome (cards, notes, settings) arrives as children. */
export function MapStage({ children }: { children?: ReactNode }) {
  const { view, setView, rendererFailed, setRendererFailed } = useScene();
  const applyDefaultMapStyle = useScene((s) => s.applyDefaultMapStyle);
  const { style, hasBuildings, hasGoogle, settled } = useMapStyle();
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
  const effective = effectiveView(view, available, rendererFailed);
  const renderer = rendererFor(effective, style, stylisedEngine());
  const listFallback = (
    <div className="h-full space-y-3 overflow-auto p-4 pr-[calc(var(--panel-w,0px)+1rem)]">
      <FailedAlert>{LIST_FALLBACK_TEXT}</FailedAlert>
      <ListView />
    </div>
  );
  // After a crash `effective` changes, so the boundary remounts on the fallback renderer and its
  // own alert never shows: say why here (not when the user picked the list themselves).
  const crashed = rendererFailed && view !== "list";

  return (
    <div className="relative h-full min-h-72 overflow-hidden bg-surface">
      {waiting ? (
        <LoadingTownship />
      ) : effective === "list" ? (
        <div className="h-full space-y-3 overflow-auto p-4 pr-[calc(var(--panel-w,0px)+1rem)]">
          {crashed && <FailedAlert>{LIST_FALLBACK_TEXT}</FailedAlert>}
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
        <>
          {crashed && renderer === "mapbox" && (
            <InSlot name="hint">
              <FailedAlert>{MAPBOX_FALLBACK_TEXT}</FailedAlert>
            </InSlot>
          )}
          <RendererBoundary
            key={renderer}
            fallback={listFallback}
            onFail={() => setRendererFailed(true)}
          >
            <Suspense fallback={<LoadingTownship />}>
              {renderer === "three" ? (
                <ThreeScene />
              ) : renderer === "cesium" ? (
                <CesiumScene />
              ) : (
                <MapboxLite />
              )}
            </Suspense>
          </RendererBoundary>
        </>
      )}
      <TopStack />
      <BottomStack />
      {children}
    </div>
  );
}
