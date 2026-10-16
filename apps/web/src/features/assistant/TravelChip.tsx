import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "../../ui/icons";
import { TRAVEL_LABELS, TRAVEL_ORDER } from "../map-ui/TravelLabels";
import { type Profile, useScene } from "../scene/sceneStore";

const ICON: Record<Profile, IconName> = {
  default: "walk",
  stroller: "stroller",
  wheelchair: "wheelchair",
  older_adult_rest: "older",
  drive: "car",
};

export function TravelChip() {
  const { profile, setProfile } = useScene();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const opts = () =>
    Array.from(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
  const openList = () => {
    setActive(Math.max(0, TRAVEL_ORDER.indexOf(profile)));
    setOpen(true);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus the active option once, on open
  useEffect(() => {
    if (!open) return;
    opts()[active]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);
  const choose = (p: Profile) => {
    setProfile(p);
    setOpen(false);
    btn.current?.focus();
  };
  const move = (i: number) => {
    setActive(i);
    opts()[i]?.focus();
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: focusout bubbling to close the popup; no interaction of its own
    <div
      ref={root}
      className="relative"
      onBlur={(e) => {
        if (open && !root.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={btn}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Travelling as: ${TRAVEL_LABELS[profile]}`}
        onClick={() => (open ? setOpen(false) : openList())}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-edge bg-raised px-3 text-xs font-semibold text-fg hover:border-accent"
      >
        <Icon name={ICON[profile]} className="size-4" />
        Travelling as: {TRAVEL_LABELS[profile]}
        <Icon name="chevron" className="size-3.5 rotate-90" />
      </button>
      {open && (
        <div
          ref={list}
          role="listbox"
          aria-label="Travelling as"
          className="glass absolute bottom-12 left-0 z-30 w-56 rounded-xl p-1"
        >
          {TRAVEL_ORDER.map((p, i) => (
            <div
              key={p}
              role="option"
              aria-selected={profile === p}
              tabIndex={i === active ? 0 : -1}
              onClick={() => choose(p)}
              onKeyDown={(e) => {
                const n = TRAVEL_ORDER.length;
                const go: Record<string, number> = {
                  ArrowDown: (i + 1) % n,
                  ArrowUp: (i - 1 + n) % n,
                  Home: 0,
                  End: n - 1,
                };
                if (e.key in go) {
                  e.preventDefault();
                  move(go[e.key] as number);
                } else if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  choose(p);
                }
              }}
              className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm ${
                profile === p ? "bg-accent text-on-accent" : "text-fg hover:bg-fg/10"
              }`}
            >
              <Icon name={ICON[p]} className="size-4" />
              {TRAVEL_LABELS[p]}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
