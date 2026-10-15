import { Link, Outlet, useLocation } from "react-router";
import { useOpenTicketCount } from "../features/tickets/useTickets";
import { useSite } from "../lib/api";
import { ThemeToggle } from "../ui/ThemeToggle";
import { type Mode, useMode } from "./modeStore";

const FALLBACK_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)";
const linkBtn =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-fg/70 px-4 text-sm font-semibold uppercase tracking-wide text-fg hover:bg-fg/10";

function ModeSwitch() {
  const { mode, setMode } = useMode();
  const options: { value: Mode; label: string }[] = [
    { value: "resident", label: "Resident" },
    { value: "management", label: "Management" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Perspective"
      className="inline-flex rounded-full border border-edge p-0.5"
    >
      {options.map((o) => {
        const on = mode === o.value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: segmented control per spec
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => setMode(o.value)}
            className={`min-h-11 rounded-full px-4 text-sm font-semibold ${
              on ? "bg-accent text-on-accent" : "text-fg hover:bg-fg/10"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function TicketsLink() {
  const open = useOpenTicketCount();
  return (
    <Link to="/tickets" className={linkBtn}>
      Tickets
      <span
        role="img"
        aria-label={`${open} open`}
        className="rounded-full bg-accent px-2 py-0.5 text-xs text-on-accent"
      >
        {open}
      </span>
    </Link>
  );
}

export function Shell() {
  const site = useSite();
  const mode = useMode((s) => s.mode);
  const onTickets = useLocation().pathname.startsWith("/tickets");
  const attribution = site.data?.attribution?.join(" · ") ?? FALLBACK_ATTRIBUTION;
  return (
    <div className="flex min-h-screen flex-col lg:h-dvh bg-bg text-fg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-edge bg-surface px-4 py-2 sm:grid-cols-[1fr_auto_1fr]">
        <div>
          <p className="font-display text-lg tracking-[0.22em]">TOWNSHIPLENS</p>
          {site.data && <p className="text-xs text-fg-soft">{site.data.name}</p>}
        </div>
        <div className="order-last col-span-2 text-center sm:order-none sm:col-span-1">
          {onTickets ? (
            <p className="text-sm font-semibold tracking-wide">TICKETS · MANAGEMENT</p>
          ) : (
            <ModeSwitch />
          )}
        </div>
        <div className="flex items-center justify-end gap-2">
          {onTickets ? (
            <Link to="/" className={linkBtn}>
              Back to map
            </Link>
          ) : (
            mode === "management" && <TicketsLink />
          )}
          <ThemeToggle />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="min-h-0 flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-edge px-4 py-1 text-xs text-fg-soft">{attribution}</footer>
    </div>
  );
}
