import type { ScreenPoint } from "../compareStore";
import { SIMULATED_RESIDENT } from "./copy";

/** A simulated resident's greeting (D4, AC-N8): a fixed greeting, no facts, labelled. */
export function GreetingBubble({ text, at }: { text: string; at: ScreenPoint | null }) {
  return (
    <div
      data-beat="greeting"
      className={`${at ? "absolute -translate-x-1/2 -translate-y-[calc(100%+14px)] after:absolute after:-bottom-[7px] after:left-[22px] after:size-3.5 after:rotate-45 after:bg-surface after:content-['']" : "relative"} max-w-[220px] rounded-2xl bg-surface px-3 py-[7px] text-[13px] font-bold text-fg shadow-[0_3px_0_var(--c-edge)]`}
      style={at ? { left: at.x, top: at.y } : undefined}
    >
      {text}
      <span className="mt-0.5 block text-[10px] font-extrabold uppercase tracking-[.05em] text-cmp-resident">
        {SIMULATED_RESIDENT}
      </span>
    </div>
  );
}
