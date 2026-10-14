import { useEffect, useMemo } from "react";
import { ENV } from "../../lib/env";
import { PROFILE_IDS, PROFILE_LABELS } from "../../lib/profileStore";
import { ListView } from "./list/ListView";
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

export function SceneHost() {
  const { view, setView, profile, setProfile } = useScene();
  const webglOk = useMemo(webglSupported, []);
  const available = useMemo(() => availableViews(ENV, webglOk), [webglOk]);

  useEffect(() => {
    setView(selectView(ENV, webglOk));
  }, [webglOk, setView]);

  // Task 12 lazy-loads CesiumScene / MapboxLite here; until then every view renders the list.
  const effective: View = "list";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <fieldset className="m-0 inline-flex overflow-hidden rounded-lg border border-line bg-card p-0">
          <legend className="sr-only">View</legend>
          {VIEW_LABELS.map(([v, label]) => {
            const enabled = available.includes(v);
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

      {available.length === 1 && (
        <p role="note" className="rounded-lg border border-line bg-brand-tint px-4 py-3 text-sm">
          Add keys in .env to enable 3D. The list view works without them.
        </p>
      )}

      {effective === "list" && <ListView />}
    </div>
  );
}
