import { forwardRef, type RefObject, useLayoutEffect, useRef } from "react";

/** "Resident feedback" with its counter (spec §4.2 Daily Life, AC-F5). */
export const FeedbackBadge = forwardRef<HTMLDivElement, { count: number }>(function FeedbackBadge(
  { count },
  ref,
) {
  return (
    <div
      ref={ref}
      role="status"
      aria-label={`Resident feedback: ${count}`}
      data-testid="devsim-feedback"
      className="glass inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold text-fg"
    >
      <span aria-hidden="true">✉️</span>
      Resident feedback
      <span
        data-testid="devsim-feedback-count"
        className={`grid min-w-6 place-items-center rounded-full bg-rose px-1.5 text-xs text-on-status transition-transform ${
          count > 0 ? "scale-110" : ""
        }`}
      >
        {count}
      </span>
    </div>
  );
});

const ease = (u: number) => {
  const v = Math.max(0, Math.min(1, u));
  return v * v * (3 - 2 * v);
};

/**
 * The envelope flying from the complaining resident to the feedback badge (prototype `ENVELOPE`).
 * `progress` is the timeline's (0..1, already eased); `from` the speaker point in stage px (null:
 * the bubble stack's corner). Positions are written in a layout effect, after the badge is laid out.
 */
export function Envelope({
  progress,
  from,
  stageRef,
  badgeRef,
}: {
  progress: number;
  from: { x: number; y: number } | null;
  stageRef: RefObject<HTMLElement | null>;
  badgeRef: RefObject<HTMLElement | null>;
}) {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const e = el.current;
    const stage = stageRef.current?.getBoundingClientRect();
    const badge = badgeRef.current?.getBoundingClientRect();
    if (!e || !stage || !badge) return;
    const src = from ?? { x: 160, y: stage.height / 2 };
    const tx = badge.right - stage.left - 14;
    const ty = badge.top - stage.top + badge.height / 2;
    const u = ease(progress);
    e.style.left = `${src.x + (tx - src.x) * progress}px`;
    e.style.top = `${src.y + (ty - src.y) * progress - Math.sin(u * Math.PI) * 60}px`;
  });
  return (
    <div
      ref={el}
      aria-hidden="true"
      data-testid="devsim-envelope"
      className="pointer-events-none absolute z-30 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[3px] border-rose bg-surface text-xl shadow-[var(--c-shadow)]"
    >
      ✉️
    </div>
  );
}
