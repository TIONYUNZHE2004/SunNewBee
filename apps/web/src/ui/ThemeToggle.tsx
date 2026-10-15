import { useTheme } from "./theme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const next = theme === "night" ? "day" : "night";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      className="inline-flex size-11 items-center justify-center rounded-full border border-edge text-fg hover:bg-fg/10"
    >
      <span aria-hidden="true">{theme === "night" ? "☀" : "☾"}</span>
    </button>
  );
}
