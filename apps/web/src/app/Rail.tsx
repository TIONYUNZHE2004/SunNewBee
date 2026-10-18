import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { usePanel } from "../features/main/panelStore";
import { useOpenTicketCount } from "../features/tickets/useTickets";
import { Icon, type IconName } from "../ui/icons";
import { LogoMark } from "../ui/Logo";
import { ThemeMenu } from "../ui/ThemeMenu";
import { useMode } from "./modeStore";

const item =
  "group relative grid size-11 place-items-center rounded-2xl transition-colors focus-visible:outline-2";
const on = "bg-accent text-on-accent shadow-sm";
const off = "text-fg-soft hover:bg-fg/5 hover:text-fg";

/** Hover/focus label to the right of a rail item (the item also has an accessible name). */
function Tip({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-full z-40 ml-3 whitespace-nowrap rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-on-accent opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      {children}
    </span>
  );
}

function RailIcon({ name, active }: { name: IconName; active: boolean }) {
  return <Icon name={name} className={`size-5 ${active ? "" : "opacity-90"}`} />;
}

/** Wide-screen navigation: logo, Map, Assistant, Tickets (Management only), theme at the bottom.
 * Only features that exist get an item. */
export function Rail() {
  const path = useLocation().pathname;
  const onMap = path === "/";
  const onTickets = path.startsWith("/tickets");
  const mode = useMode((s) => s.mode);
  const open = usePanel((s) => s.open);
  const setOpen = usePanel((s) => s.setOpen);
  const tickets = useOpenTicketCount();
  return (
    <nav
      aria-label="Main"
      className="flex w-16 shrink-0 flex-col items-center gap-2 rounded-3xl border border-edge bg-surface py-3 shadow-[var(--c-shadow)]"
    >
      <Link to="/" aria-label="TownshipLens home" className="mb-3 grid size-11 place-items-center">
        <LogoMark />
      </Link>
      <Link to="/" aria-label="Map" className={`${item} ${onMap ? on : off}`}>
        <RailIcon name="map" active={onMap} />
        <Tip>Map</Tip>
      </Link>
      {onMap && (
        <button
          type="button"
          aria-label="Assistant"
          aria-pressed={open}
          onClick={() => setOpen(!open)}
          className={`${item} ${open ? "bg-fg/8 text-fg" : off}`}
        >
          <RailIcon name="chat" active={open} />
          <Tip>{open ? "Hide assistant" : "Show assistant"}</Tip>
        </button>
      )}
      {mode === "management" && (
        <Link
          to="/tickets"
          aria-label={`Tickets, ${tickets} open`}
          className={`${item} ${onTickets ? on : off}`}
        >
          <RailIcon name="ticket" active={onTickets} />
          {tickets > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-1 -top-1 min-w-5 rounded-full border-2 border-surface bg-fg px-1 text-center text-[0.65rem] font-semibold leading-4 text-surface tabular-nums"
            >
              {tickets}
            </span>
          )}
          <Tip>Tickets</Tip>
        </Link>
      )}
      <div className="mt-auto">
        <ThemeMenu placement="rail" />
      </div>
    </nav>
  );
}
