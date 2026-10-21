import type { Ref } from "react";
import { TICKETS_CHIP } from "./copy";

/**
 * The Tickets chip at the top right (prototype `#tickets`); `bump` while the counter just went up.
 * `countRef` is the counter badge, where the ticket flight lands.
 */
export function TicketsChip({
  count,
  bump,
  countRef,
}: {
  count: number;
  bump: boolean;
  countRef?: Ref<HTMLSpanElement>;
}) {
  return (
    <div
      data-beat="tickets-chip"
      className="absolute right-[calc(var(--panel-w,0px)+1rem)] top-4 flex items-center gap-2 rounded-full bg-surface py-1.5 pl-2 pr-3 text-[13px] font-extrabold text-fg shadow-[0_3px_0_var(--c-edge)]"
    >
      <span
        aria-hidden="true"
        className="grid size-[26px] place-items-center rounded-lg bg-cmp-unknown text-sm text-cmp-on-tone"
      >
        ✓
      </span>
      {TICKETS_CHIP}
      <span
        ref={countRef}
        data-testid="tickets-count"
        aria-live="polite"
        className={`grid h-[22px] min-w-[22px] place-items-center rounded-[11px] text-xs transition-transform duration-200 ${bump ? "scale-125 bg-cmp-unknown text-cmp-on-tone" : "bg-accent text-on-accent"}`}
      >
        {count}
      </span>
    </div>
  );
}
