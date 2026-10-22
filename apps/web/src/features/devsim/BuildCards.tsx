import { badgeTooltips, hoardingRows } from "./buildModel";
import { HOARDING_CARD } from "./copy";
import type { Banner, TimedTag } from "./planTypes";
import { SourceBadge } from "./SourceBadge";
import type { DevelopmentPlan } from "./types";

/**
 * A set-piece banner (prototype `#banner`; spec §6.2): Hari Raya, the monsoon stretch, handover.
 * Title, text and badges are the plan's, verbatim (the backend states the days actually lost).
 */
export function BuildBanner({ banner, plan }: { banner: Banner; plan: DevelopmentPlan }) {
  const tips = badgeTooltips(plan);
  return (
    <div
      role="status"
      data-testid="devsim-banner"
      data-beat={`banner-${banner.kind}`}
      data-kind={banner.kind}
      className="max-w-[min(30rem,calc(100vw-2rem))] rounded-2xl bg-fg px-4 py-2 text-center text-sm font-extrabold text-bg shadow-[0_10px_30px_rgba(44,42,58,.25)]"
    >
      <span className="block">
        {banner.title}
        {banner.badges.map((b) => (
          <SourceBadge key={b} badge={b} tooltip={tips[b]} />
        ))}
      </span>
      <small className="block text-[11.5px] font-semibold opacity-85">{banner.text}</small>
    </div>
  );
}

/** Hoarding impact card (prototype `#hoard`, 4–9.5 s): the brief's hoarding rows and their source. */
export function HoardingCard({ plan }: { plan: DevelopmentPlan }) {
  const tips = badgeTooltips(plan);
  return (
    <section
      aria-label={HOARDING_CARD.title}
      data-testid="devsim-hoarding-card"
      data-beat="hoarding-card"
      className="w-[min(19rem,calc(100vw-2rem))] rounded-[18px] border border-edge bg-surface px-3.5 py-3 text-[13px] leading-snug text-fg shadow-[var(--c-shadow)]"
    >
      <h3 className="m-0 mb-1.5 text-[15px] font-bold">
        {HOARDING_CARD.title}
        <SourceBadge badge="ROUTE" tooltip={tips.ROUTE} />
      </h3>
      {hoardingRows(plan).map((r) => (
        <div
          key={r.key}
          data-testid="devsim-hoarding-row"
          data-key={r.key}
          className="flex justify-between gap-3 border-b border-dashed border-edge py-0.5"
        >
          <span>{r.label}</span>
          <b className="text-right">{r.value}</b>
        </div>
      ))}
      <p className="m-0 mt-1.5 text-[11px] text-fg-soft">
        {HOARDING_CARD.source(plan.impact.provenance)}
      </p>
    </section>
  );
}

const TAG_EDGE: Record<TimedTag["kind"], string> = { detour: "#d2544f", lorry: "#e8931f" };

/**
 * A timed map tag (prototype `.tag`): the detour and the lorry route, with the plan's title and
 * text (the lorry tag names the first sensitive place the route passes; never a school unless it
 * is one, R16). Anchored at `at` (stage px) when the 3D view projects it, else in the stack.
 */
export function TimedTagCard({ tag, at }: { tag: TimedTag; at?: [number, number] | null }) {
  const style = {
    borderColor: TAG_EDGE[tag.kind],
    ...(at ? { left: `${at[0]}px`, top: `${at[1]}px`, transform: "translate(-50%, -100%)" } : {}),
  };
  return (
    <p
      role="note"
      data-testid="devsim-tag"
      data-beat={`${tag.kind}-tag`}
      data-kind={tag.kind}
      style={style}
      className={`m-0 max-w-[19rem] rounded-xl border-2 bg-surface px-2.5 py-1 text-xs font-semibold text-fg shadow-[var(--c-shadow)] ${
        at ? "pointer-events-none absolute z-20" : "inline-block"
      }`}
    >
      <span
        className="mr-1.5 inline-block rounded-md px-1.5 text-[10px] font-extrabold uppercase tracking-wide text-white"
        style={{ background: tag.kind === "detour" ? "#b8403b" : "#9a5a00" }}
      >
        {tag.title}
      </span>
      <span>{tag.text}</span>
    </p>
  );
}
