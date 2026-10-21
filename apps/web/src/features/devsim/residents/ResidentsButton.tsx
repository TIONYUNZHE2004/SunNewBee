import { forwardRef } from "react";
import { RESIDENTS_BUTTON } from "../copy";
import { Avatar } from "./Avatar";

/**
 * "Simulated residents · 40" (prototype `#resBtn`; spec D10, §6.2): a pulsing pill on the map from
 * 33 s that opens the residents panel.
 */
export const ResidentsButton = forwardRef<
  HTMLButtonElement,
  {
    count: number;
    /** The first three residents' colours, for the avatar stack. */
    colours: readonly string[];
    expanded: boolean;
    controls: string;
    onClick: () => void;
  }
>(function ResidentsButton({ count, colours, expanded, controls, onClick }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      data-testid="devsim-residents-button"
      data-beat="residents-button"
      aria-haspopup="dialog"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onClick}
      className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-fg py-2 pr-4 pl-2 text-sm font-bold text-bg shadow-[0_6px_20px_rgba(44,42,58,.3)] animate-[tl-pulse_1.6s_ease-in-out_infinite] focus-visible:outline-2"
    >
      <span aria-hidden="true" className="mr-2 flex">
        {colours.slice(0, 3).map((c) => (
          <Avatar key={c} colour={c} size="xs" />
        ))}
      </span>
      {RESIDENTS_BUTTON(count)}
    </button>
  );
});
