import { useEffect, useRef, useState } from "react";
import { useMode } from "../../app/modeStore";
import { useScenarios } from "../../lib/api";
import { Icon, type IconName } from "../../ui/icons";
import { useTheme } from "../../ui/theme";
import { useCameraUi } from "../scene/cesium/controls/cameraUiStore";
import { StatusLegend } from "../scene/StatusLegend";
import { useSceneSettings } from "../scene/sceneSettingsStore";
import { type MapStyle, useScene } from "../scene/sceneStore";
import type { View } from "../scene/selectView";
import { useEffectiveView, useMapStyle } from "../scene/useMapStyle";
import { TRAVEL_LABELS, TRAVEL_ORDER } from "./TravelLabels";

export function levelOptions(scenarios: { id: string; label: string; stage_m?: number | null }[]) {
  const stages = scenarios
    .filter((s) => typeof s.stage_m === "number" && s.stage_m > 0)
    .sort((a, b) => (a.stage_m as number) - (b.stage_m as number))
    .map((s) => ({ id: s.id as string | null, label: `+${s.stage_m} m` }));
  return [{ id: null as string | null, label: "Normal" }, ...stages];
}

/** Map style options with the reason an option cannot be used (shown, and read as its description). */
export function mapStyleOptions(
  hasBuildings: boolean,
  hasGoogle: boolean,
  view: View,
  settled = true,
) {
  // Map styles only exist in the 3D renderer: with Mapbox/List active (no WebGL, or a crash into
  // the list fallback) none is selectable and none claims to be shown.
  const device = view === "cesium" ? null : "Needs a 3D-capable device";
  return [
    {
      style: "stylised" as MapStyle,
      label: "Stylised",
      reason: !settled ? "Loading…" : !hasBuildings ? "Needs building data" : device,
    },
    {
      style: "realistic" as MapStyle,
      label: "Realistic photos (Google)",
      reason: device ?? (hasGoogle ? null : "Needs a Google Maps key"),
    },
  ];
}

function Radio({
  checked,
  onClick,
  children,
  disabled,
  describedBy,
}: {
  checked: boolean;
  onClick: () => void;
  children: string;
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a styled toggle button in a radiogroup, per the brief
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onClick}
      disabled={disabled}
      aria-describedby={describedBy}
      className={`min-h-11 rounded-lg border px-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "border-accent bg-accent text-on-accent" : "border-edge bg-raised text-fg"
      }`}
    >
      {children}
    </button>
  );
}

function Heading({ icon, children }: { icon: IconName; children: string }) {
  return (
    <h3 className="m-0 mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-fg-soft">
      <Icon name={icon} className="size-4" />
      {children}
    </h3>
  );
}

export function SettingsPopover() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const mode = useMode((s) => s.mode);
  const { scenarioId, profile, setScenario, setProfile, setMapStyle } = useScene();
  const { style, hasBuildings, hasGoogle, settled } = useMapStyle();
  const effective = useEffectiveView();
  const { choice, setChoice } = useTheme();
  const { alwaysShow, setAlwaysShow } = useCameraUi();
  const { motion, quality, setMotion, setQuality } = useSceneSettings();
  const scenarios = useScenarios();
  const levels = levelOptions(scenarios.data ?? []);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.querySelector<HTMLElement>('[role="radio"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      setOpen(false);
      btnRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {open && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-label="Map settings"
          id="map-settings"
          className="glass absolute bottom-[calc(var(--sheet-h,0px)+5rem)] right-[calc(var(--panel-w,0px)+1rem)] z-20 max-h-[min(70%,calc(100%-var(--sheet-h,0px)-6rem))] w-80 max-w-[calc(100%-var(--panel-w,0px)-2rem)] space-y-4 overflow-auto rounded-2xl p-4 text-fg"
        >
          <div>
            <Heading icon="compass">Theme</Heading>
            <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-2">
              {(["auto", "day", "dusk", "night"] as const).map((c) => (
                <Radio key={c} checked={choice === c} onClick={() => setChoice(c)}>
                  {c === "auto" ? "Auto (clock)" : c[0]!.toUpperCase() + c.slice(1)}
                </Radio>
              ))}
            </div>
          </div>
          <div>
            <Heading icon="pin">Map style</Heading>
            <div role="radiogroup" aria-label="Map style" className="grid grid-cols-2 gap-2">
              {mapStyleOptions(hasBuildings, hasGoogle, effective, settled).map((o) => (
                <div key={o.style} className="flex flex-col gap-1">
                  <Radio
                    checked={style === o.style && !o.reason}
                    disabled={!!o.reason}
                    describedBy={o.reason ? `map-style-${o.style}-reason` : undefined}
                    onClick={() => setMapStyle(o.style)}
                  >
                    {o.label}
                  </Radio>
                  {o.reason && (
                    <span id={`map-style-${o.style}-reason`} className="text-xs text-fg-soft">
                      {o.reason}
                    </span>
                  )}
                </div>
              ))}
            </div>
            {effective === "cesium" && style === "stylised" && hasBuildings && (
              // Honesty: trees, parked cars and base water in the stylised city are decorative.
              <p className="m-0 mt-1 text-xs text-fg-soft">Decorative details are illustrative.</p>
            )}
          </div>
          {effective === "cesium" && (
            <>
              <div>
                <Heading icon="walk">Motion</Heading>
                <div role="radiogroup" aria-label="Motion" className="grid grid-cols-2 gap-2">
                  <Radio checked={motion} onClick={() => setMotion(true)}>
                    On
                  </Radio>
                  <Radio checked={!motion} onClick={() => setMotion(false)}>
                    Off
                  </Radio>
                </div>
              </div>
            </>
          )}
          {effective === "cesium" && (
            <>
              <div>
                <Heading icon="check">Quality</Heading>
                <div role="radiogroup" aria-label="Quality" className="grid grid-cols-4 gap-2">
                  {(["auto", "high", "medium", "low"] as const).map((q) => (
                    <Radio key={q} checked={quality === q} onClick={() => setQuality(q)}>
                      {q[0]!.toUpperCase() + q.slice(1)}
                    </Radio>
                  ))}
                </div>
              </div>
            </>
          )}
          {effective === "cesium" && (
            <div>
              <Heading icon="camera">Camera controls</Heading>
              <div
                role="radiogroup"
                aria-label="Camera controls"
                className="grid grid-cols-2 gap-2"
              >
                <Radio checked={!alwaysShow} onClick={() => setAlwaysShow(false)}>
                  Compass only
                </Radio>
                <Radio checked={alwaysShow} onClick={() => setAlwaysShow(true)}>
                  Always show
                </Radio>
              </div>
            </div>
          )}
          {mode === "resident" && (
            <div>
              <Heading icon="walk">Travelling as</Heading>
              <div role="radiogroup" aria-label="Travelling as" className="grid grid-cols-2 gap-2">
                {TRAVEL_ORDER.map((p) => (
                  <Radio key={p} checked={profile === p} onClick={() => setProfile(p)}>
                    {TRAVEL_LABELS[p]}
                  </Radio>
                ))}
              </div>
            </div>
          )}
          <div>
            <Heading icon="flood">River level</Heading>
            <div role="radiogroup" aria-label="River level" className="grid grid-cols-3 gap-2">
              {levels.map((o) => (
                <Radio
                  key={o.id ?? "normal"}
                  checked={scenarioId === o.id || (o.id === null && scenarioId === "baseline")}
                  onClick={() => setScenario(o.id)}
                >
                  {o.label}
                </Radio>
              ))}
            </div>
            <p className="m-0 mt-1 text-xs text-fg-soft">Indicative scenarios, not forecasts.</p>
          </div>
          <div>
            <Heading icon="route">Legend</Heading>
            <StatusLegend />
          </div>
        </div>
      )}
      <button
        ref={btnRef}
        type="button"
        aria-label="Map settings"
        aria-expanded={open}
        aria-controls={open ? "map-settings" : undefined}
        onClick={() => setOpen((o) => !o)}
        className="absolute bottom-[calc(var(--sheet-h,0px)+1rem)] right-[calc(var(--panel-w,0px)+1rem)] z-20 grid size-11 place-items-center rounded-full border border-edge bg-surface text-fg shadow-md hover:bg-raised"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
          <circle cx="16" cy="6" r="2" />
          <circle cx="10" cy="12" r="2" />
          <circle cx="18" cy="18" r="2" />
        </svg>
      </button>
    </>
  );
}
