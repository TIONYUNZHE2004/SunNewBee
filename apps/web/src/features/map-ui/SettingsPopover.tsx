import { useEffect, useRef, useState } from "react";
import { useMode } from "../../app/modeStore";
import { useScenarios } from "../../lib/api";
import { useTheme } from "../../ui/theme";
import { StatusLegend } from "../scene/StatusLegend";
import { useScene } from "../scene/sceneStore";
import { TRAVEL_LABELS, TRAVEL_ORDER } from "./TravelLabels";

export function levelOptions(scenarios: { id: string; label: string; stage_m?: number | null }[]) {
  const stages = scenarios
    .filter((s) => typeof s.stage_m === "number" && s.stage_m > 0)
    .sort((a, b) => (a.stage_m as number) - (b.stage_m as number))
    .map((s) => ({ id: s.id as string | null, label: `+${s.stage_m} m` }));
  return [{ id: null as string | null, label: "Normal" }, ...stages];
}

function Radio({
  checked,
  onClick,
  children,
}: {
  checked: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a styled toggle button in a radiogroup, per the brief
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onClick}
      className={`min-h-10 rounded-lg border px-2 text-sm font-medium ${
        checked ? "border-accent bg-accent text-on-accent" : "border-edge bg-raised text-fg"
      }`}
    >
      {children}
    </button>
  );
}

const H = "m-0 mb-1 text-xs font-semibold uppercase tracking-wide text-fg-soft";

export function SettingsPopover() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const mode = useMode((s) => s.mode);
  const { scenarioId, profile, setScenario, setProfile } = useScene();
  const { theme, setTheme } = useTheme();
  const scenarios = useScenarios();
  const levels = levelOptions(scenarios.data ?? []);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.querySelector<HTMLElement>('[role="radio"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
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
          className="absolute bottom-20 right-4 z-20 max-h-[70%] w-80 max-w-[calc(100%-2rem)] space-y-4 overflow-auto rounded-2xl border border-edge bg-surface p-4 text-fg shadow-lg"
        >
          <div>
            <h3 className={H}>Legend</h3>
            <StatusLegend />
          </div>
          <div>
            <h3 className={H}>River level</h3>
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
          {mode === "resident" && (
            <div>
              <h3 className={H}>Travelling as</h3>
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
            <h3 className={H}>Theme</h3>
            <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-2">
              <Radio checked={theme === "day"} onClick={() => setTheme("day")}>
                Day
              </Radio>
              <Radio checked={theme === "night"} onClick={() => setTheme("night")}>
                Night
              </Radio>
            </div>
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
        className="absolute bottom-4 right-4 z-20 grid size-11 place-items-center rounded-full border border-edge bg-surface text-fg shadow-md hover:bg-raised"
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
