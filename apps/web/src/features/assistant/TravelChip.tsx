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
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const choose = (p: Profile) => {
    setProfile(p);
    setOpen(false);
    btn.current?.focus();
  };
  return (
    <div className="relative">
      <button
        ref={btn}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Travelling as: ${TRAVEL_LABELS[profile]}`}
        onClick={() => setOpen((o) => !o)}
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
          {TRAVEL_ORDER.map((p) => (
            <div
              key={p}
              role="option"
              aria-selected={profile === p}
              tabIndex={0}
              onClick={() => choose(p)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                choose(p);
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
