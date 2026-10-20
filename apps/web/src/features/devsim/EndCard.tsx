import type { EndCardBadge, EndCard as EndCardData } from "./types";

/** Source chip colours: fixed pairs, readable in both skins (≥ 4.5:1, see contrast test). */
export const BADGE_STYLE: Record<EndCardBadge, { bg: string; fg: string }> = {
  "ROUTE ENGINE": { bg: "#dcebfb", fg: "#1d4f86" },
  SIMULATED: { bg: "#f1e7ff", fg: "#5b3a8c" },
};

export function SourceBadge({ badge }: { badge: EndCardBadge }) {
  const s = BADGE_STYLE[badge];
  return (
    <span
      data-testid="devsim-source-badge"
      className="ml-1 inline-block rounded-md px-1.5 align-[1px] text-[10px] font-bold tracking-wide"
      style={{ background: s.bg, color: s.fg }}
    >
      {badge}
    </span>
  );
}

/**
 * "What residents raised" (spec §4.5): the plan's end card, verbatim, with each item's sources.
 * `inline` lays it out in the flow (the List text version) instead of over the map.
 */
export function EndCard({ card, inline = false }: { card: EndCardData; inline?: boolean }) {
  return (
    <section
      aria-label={card.title}
      data-testid="devsim-end-card"
      className={`rounded-3xl border border-edge bg-surface p-5 text-fg shadow-[var(--c-shadow)] ${
        inline ? "" : "w-[min(28rem,calc(100%-2rem))]"
      }`}
    >
      <h2 className="m-0 text-xl font-semibold tracking-tight">{card.title}</h2>
      <p className="mt-1 mb-3 text-xs font-semibold text-fg-soft">{card.subtitle}</p>
      <ol className="m-0 space-y-2 pl-5">
        {card.items.map((it) => (
          <li key={it.text} data-testid="devsim-end-item" className="text-[15px] leading-snug">
            {it.text}
            {it.badges.map((b) => (
              <SourceBadge key={b} badge={b} />
            ))}
          </li>
        ))}
      </ol>
      <p className="mt-3 mb-0 text-[11px] text-fg-soft">{card.legend}</p>
    </section>
  );
}
