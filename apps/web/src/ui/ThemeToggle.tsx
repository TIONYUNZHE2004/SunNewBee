import { useTheme } from "./theme";

export function ThemeToggle() {
  const { theme, setChoice } = useTheme();
  const next = theme === "night" ? "day" : "night";
  return (
    <button
      type="button"
      onClick={() => setChoice(next)}
      aria-label={`Switch to ${next} theme`}
      className="inline-flex size-11 items-center justify-center rounded-full border border-edge text-fg hover:bg-fg/10"
    >
      <span aria-hidden="true">{theme === "night" ? "☀" : "☾"}</span>
    </button>
  );
}
