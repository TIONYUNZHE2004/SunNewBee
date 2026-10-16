import { useEffect, useRef, useState } from "react";
import { type Theme, type ThemeChoice, useTheme } from "./theme";

const LABEL: Record<ThemeChoice, string> = {
  auto: "Auto",
  day: "Day",
  dusk: "Dusk",
  night: "Night",
};
const ICON: Record<Theme, string> = { day: "☀", dusk: "◐", night: "☾" };
const ORDER: ThemeChoice[] = ["auto", "day", "dusk", "night"];

export function ThemeMenu() {
  const { choice, theme, setChoice } = useTheme();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const name = choice === "auto" ? `Theme: Auto (${LABEL[theme]})` : `Theme: ${LABEL[choice]}`;

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      btn.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && e.target !== btn.current) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={btn}
        type="button"
        aria-label={name}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex size-11 items-center justify-center rounded-full border border-edge text-fg hover:bg-fg/10"
      >
        <span aria-hidden="true">{ICON[theme]}</span>
        {choice === "auto" && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 rounded-full bg-accent px-1 text-[0.6rem] font-bold text-on-accent"
          >
            A
          </span>
        )}
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="Theme"
          className="absolute right-0 z-30 mt-2 w-40 rounded-xl border border-edge bg-surface p-1 shadow-lg"
        >
          {ORDER.map((c) => (
            <button
              key={c}
              type="button"
              role="menuitemradio"
              aria-checked={choice === c}
              onClick={() => {
                setChoice(c);
                setOpen(false);
                btn.current?.focus();
              }}
              className={`flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm ${
                choice === c ? "bg-accent text-on-accent" : "text-fg hover:bg-fg/10"
              }`}
            >
              {LABEL[c]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
