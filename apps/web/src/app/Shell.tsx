import { useRef } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { useAttribution } from "../features/main/useAttribution";
import { useElementHeight } from "../features/main/useElementHeight";
import { useBehindFullSheet, usePanelReserve, useWide } from "../features/main/usePanelReserve";
import { useOpenTicketCount } from "../features/tickets/useTickets";
import { useSite } from "../lib/api";
import { LogoMark } from "../ui/Logo";
import { ThemeMenu } from "../ui/ThemeMenu";
import { ModeSwitch } from "./ModeSwitch";
import { useMode } from "./modeStore";
import { Rail } from "./Rail";

const linkBtn =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-edge bg-surface px-4 text-sm font-medium text-fg transition-colors hover:bg-fg/5";

function TicketsLink() {
  const open = useOpenTicketCount();
  return (
    <Link to="/tickets" className={linkBtn}>
      Tickets
      <span
        role="img"
        aria-label={`${open} open`}
        className="rounded-full bg-accent px-2 py-0.5 text-xs text-on-accent tabular-nums"
      >
        {open}
      </span>
    </Link>
  );
}

/** Phones and small tablets: one compact bar above the map (the rail needs width). */
function CompactHeader({ onTickets }: { onTickets: boolean }) {
  const site = useSite();
  const mode = useMode((s) => s.mode);
  return (
    <header className="relative z-30 grid grid-cols-[1fr_auto] items-center gap-3 border-b border-edge bg-surface px-4 py-2 sm:grid-cols-[1fr_auto_1fr]">
      <div className="flex min-w-0 items-center gap-2">
        <LogoMark className="size-7 shrink-0" />
        <p className="m-0 truncate text-sm">
          <span className="font-semibold">TownshipLens</span>
          {site.data && <span className="text-fg-soft"> · {site.data.name}</span>}
        </p>
      </div>
      <div className="order-last col-span-2 text-center sm:order-none sm:col-span-1">
        {onTickets ? <p className="m-0 text-sm font-semibold">Tickets</p> : <ModeSwitch />}
      </div>
      <div className="flex items-center justify-end gap-2">
        {onTickets ? (
          <Link to="/" className={linkBtn}>
            Back to map
          </Link>
        ) : (
          mode === "management" && <TicketsLink />
        )}
        <ThemeMenu />
      </div>
    </header>
  );
}

/**
 * Wide screens: a stone frame holding the rail and the page (map card + assistant card, or
 * Tickets). Narrow screens: a compact header above a full-bleed page.
 */
export function Shell() {
  const wide = useWide();
  const onTickets = useLocation().pathname.startsWith("/tickets");
  const { docked, sheetH } = usePanelReserve();
  const strip = onTickets ? 0 : docked;
  const attribution = useAttribution();
  const sheetFull = useBehindFullSheet();
  const attrHidden = !onTickets && sheetFull;
  const attrRef = useRef<HTMLParagraphElement>(null);
  // Map controls (camera cluster, gear, card stack) sit above the strip: they read --attr-h.
  const attrH = useElementHeight(attrRef, attrHidden);
  return (
    <div
      className={`relative flex min-h-screen bg-bg text-fg lg:h-dvh ${
        wide ? "flex-row gap-3 p-3" : "flex-col"
      }`}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      {wide ? <Rail /> : <CompactHeader onTickets={onTickets} />}
      <main
        id="main"
        tabIndex={-1}
        className={`relative min-h-0 min-w-0 flex-1 ${onTickets ? "flex flex-col" : ""}`}
        style={{ ["--attr-h" as string]: `${attrH}px` }}
      >
        {wide && onTickets && (
          <div className="flex items-center justify-between gap-3 px-1 pb-3">
            <div>
              <p className="m-0 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-fg-soft">
                Management
              </p>
              <h1 className="m-0 text-2xl font-semibold tracking-tight">Tickets</h1>
            </div>
            <Link to="/" className={linkBtn}>
              Back to map
            </Link>
          </div>
        )}
        <Outlet />
        <p
          ref={attrRef}
          // At full the phone sheet carries the attribution on its own bottom edge.
          hidden={attrHidden}
          className={`pointer-events-auto absolute z-10 m-0 truncate rounded-full px-2.5 py-0.5 text-[0.65rem] text-fg-soft ${
            onTickets ? "bottom-0 left-1 bg-transparent" : "glass bottom-2 left-2"
          }`}
          style={{
            maxWidth: `calc(100% - ${strip}px - 1rem)`,
            // On phones the attribution rides just above the bottom sheet so it is never covered.
            bottom: onTickets ? undefined : `calc(${sheetH} + 0.5rem)`,
          }}
        >
          {attribution}
        </p>
      </main>
    </div>
  );
}
