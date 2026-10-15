import { Component, lazy, type ReactNode, Suspense, useEffect, useMemo } from "react";
import { ENV } from "../../lib/env";
import { PROFILE_IDS, PROFILE_LABELS } from "../../lib/profileStore";
import { GapLegendPanel } from "../gaps/GapLegend";
import { gapsActive } from "../gaps/gapModel";
import { ListView } from "./list/ListView";
import { StatusLegend } from "./StatusLegend";
import { type Profile, useScene } from "./sceneStore";
import { availableViews, selectView, type View } from "./selectView";

const webglSupported = () => {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
};

const VIEW_LABELS: [View, string][] = [
  ["cesium", "3D"],
  ["mapbox", "Lite map"],
  ["list", "List"],
];

const CesiumScene = lazy(() => import("./cesium/CesiumScene"));
const MapboxLite = lazy(() => import("./mapbox/MapboxLite"));

const RENDERERS_READY = true;
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

const noKeys = !ENV.googleKey && !ENV.cesiumToken && !ENV.mapboxToken;

export function SceneHost() {
  const { view, setView, profile, setProfile, gapsVisible } = useScene();
  const webglOk = useMemo(webglSupported, []);
  const available = useMemo(() => availableViews(ENV, webglOk), [webglOk]);

  // Auto-select once per page load; never overwrite a view the user chose before a remount.
  useEffect(() => {
    if (!RENDERERS_READY || autoSelected) return;
    autoSelected = true;
    setView(selectView(ENV, webglOk));
  }, [webglOk, setView]);

  const effective: View = available.includes(view) ? view : "list";
  const listFallback = (
    <div className="space-y-3">
      <p role="alert" className="rounded-lg border border-line bg-danger-tint px-4 py-3 text-sm">
        The map could not be shown on this device. Showing the list instead.
      </p>
      <ListView />
    </div>
  );

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <fieldset className="m-0 inline-flex overflow-hidden rounded-lg border border-line bg-card p-0">
          <legend className="sr-only">View</legend>
          {VIEW_LABELS.map(([v, label]) => {
            const enabled = RENDERERS_READY ? available.includes(v) : v === "list";
            const active = view === v;
            return (
              <button
                key={v}
                type="button"
                disabled={!enabled}
                aria-pressed={active}
                onClick={() => setView(v)}
                className={`min-h-11 px-4 text-sm font-medium transition-colors ${
                  active ? "bg-brand text-white" : "text-brand hover:bg-brand-tint"
                } disabled:cursor-not-allowed disabled:text-ink-soft disabled:opacity-60 disabled:hover:bg-transparent`}
              >
                {label}
              </button>
            );
          })}
        </fieldset>
        <div>
          <label htmlFor="profile" className="block text-sm font-medium">
            Travelling as
          </label>
          <select
            id="profile"
            value={profile}
            onChange={(e) => setProfile(e.target.value as Profile)}
            className="mt-1 min-h-11 rounded-lg border border-line bg-card px-3 text-sm"
          >
            {PROFILE_IDS.map((p) => (
              <option key={p} value={p}>
                {PROFILE_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {noKeys && (
        <p role="note" className="rounded-lg border border-line bg-brand-tint px-4 py-3 text-sm">
          Add keys in .env to enable 3D. The list view works without them.
        </p>
      )}

      {effective === "list" ? (
        <ListView />
      ) : (
        <div className="relative h-[55vh] min-h-72 overflow-hidden rounded-lg border border-line bg-brand-tint lg:h-[68vh]">
          <RendererBoundary key={effective} fallback={listFallback}>
            <Suspense
              fallback={
                <p role="status" className="p-4 text-ink-soft">
                  Loading map…
                </p>
              }
            >
              {effective === "cesium" ? <CesiumScene /> : <MapboxLite />}
            </Suspense>
          </RendererBoundary>
          {gapsActive(gapsVisible, profile) ? (
            <GapLegendPanel className="pointer-events-none absolute left-2 top-2 z-10 max-w-[70%]" />
          ) : (
            <StatusLegend className="pointer-events-none absolute left-2 top-2 z-10 max-w-[70%]" />
          )}
        </div>
      )}
    </div>
  );
}
