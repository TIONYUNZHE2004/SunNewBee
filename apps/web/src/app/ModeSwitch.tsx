import { type Mode, useMode } from "./modeStore";

const OPTIONS: { value: Mode; label: string }[] = [
  { value: "resident", label: "Resident" },
  { value: "management", label: "Management" },
];

/** Resident / Management segmented control (radiogroup "Perspective"). */
export function ModeSwitch({ size = "md" }: { size?: "sm" | "md" }) {
  const { mode, setMode } = useMode();
  const h = size === "sm" ? "min-h-9 px-3" : "min-h-11 px-4";
  return (
    <div
      role="radiogroup"
      aria-label="Perspective"
      className="relative inline-grid grid-cols-2 rounded-full bg-raised p-0.5 ring-1 ring-edge ring-inset"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0.5 rounded-full bg-accent shadow-sm transition-transform duration-200 ease-[cubic-bezier(.2,.7,.2,1)] motion-reduce:transition-none"
        style={{
          left: "0.125rem",
          width: "calc(50% - 0.125rem)",
          transform: mode === "management" ? "translateX(100%)" : "none",
        }}
      />
      {OPTIONS.map((o) => {
        const on = mode === o.value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: segmented control per spec
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => setMode(o.value)}
            className={`relative z-10 whitespace-nowrap rounded-full text-sm font-medium transition-colors ${h} ${
              on ? "text-on-accent" : "text-fg-soft hover:text-fg"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
