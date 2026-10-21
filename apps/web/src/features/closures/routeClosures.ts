import type { Closure } from "../scene/list/closureModel";
import { SITE_TZ } from "../scene/list/closureModel";

type UncertaintyItem = { element_id?: string | null; attribute?: string | null };

/** "Works (Pipe repair)", "Event (Elmina Marathon)", "Accident": the reason, then its name. */
export function closureTitle(c: Pick<Closure, "reason" | "event_name">): string {
  const reason = `${c.reason.charAt(0).toUpperCase()}${c.reason.slice(1)}`;
  return c.event_name ? `${reason} (${c.event_name})` : reason;
}

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: SITE_TZ, ...opts }).format(new Date(iso));

/** "21 Oct, 07:00–11:00" in Malaysia time; "until further notice" without an end. */
export function closureWindow(c: Pick<Closure, "starts_at" | "ends_at">): string {
  const day = { day: "numeric", month: "short" } as const;
  const time = { hour: "2-digit", minute: "2-digit", hour12: false } as const;
  if (!c.ends_at) return `from ${fmt(c.starts_at, day)}, until further notice`;
  const sameDay = fmt(c.starts_at, day) === fmt(c.ends_at, day);
  return sameDay
    ? `${fmt(c.starts_at, day)}, ${fmt(c.starts_at, time)}–${fmt(c.ends_at, time)}`
    : `${fmt(c.starts_at, day)} ${fmt(c.starts_at, time)} – ${fmt(c.ends_at, day)} ${fmt(c.ends_at, time)}`;
}

/**
 * The active staff closures this route answer met (T-027 resident card): the turn's uncertainty
 * items name each closure's element ("closure" attribute); `/closures` gives its name and window.
 * Residents see the closure, never a detour pressure.
 */
export function routeClosures(
  items: readonly UncertaintyItem[] | undefined,
  closures: readonly Closure[] | undefined,
): Closure[] {
  const met = new Set(
    (items ?? []).filter((i) => i.attribute === "closure" && i.element_id).map((i) => i.element_id),
  );
  return (closures ?? []).filter((c) => c.active && met.has(c.element_id));
}
