import { type ReactNode, useRef } from "react";
import { Icon } from "../../ui/icons";
import { usePanel } from "./panelStore";

const ORDER = ["peek", "half", "full"] as const;
type Sheet = (typeof ORDER)[number];

/** Heights are relative to the map area (the sheet's offset parent), so `full` clears the header. */
/** Map area kept clear above the full sheet: route tag + flood banner (TopStack) stay visible. */
export const SHEET_TOP_RESERVE = "6rem";
export const SHEET_HEIGHTS: Record<Sheet, string> = {
  peek: "9.5rem",
  half: "55dvh",
  full: `calc(100% - ${SHEET_TOP_RESERVE})`,
};

const stepBtn =
  "grid size-11 place-items-center rounded-full text-fg aria-disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** Phone assistant: stays mounted at every height; peek shows the composer only. */
export function BottomSheet({
  children,
  attribution,
}: {
  children: ReactNode;
  /** Shown on the sheet's bottom edge at `full`, where the map strip would otherwise be covered. */
  attribution?: string;
}) {
  const { sheet, setSheet } = usePanel();
  const i = ORDER.indexOf(sheet);
  const up = () => i < 2 && setSheet(ORDER[i + 1] as Sheet);
  const down = () => i > 0 && setSheet(ORDER[i - 1] as Sheet);
  const drag = useRef<{ y: number; i: number } | null>(null);
  return (
    <div
      className="glass absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-3xl transition-[height] duration-200 ease-[cubic-bezier(.2,.7,.2,1)] motion-reduce:transition-none"
      style={{ height: SHEET_HEIGHTS[sheet] }}
    >
      <div className="flex shrink-0 items-center justify-between px-3 pt-1">
        <button
          type="button"
          aria-label="Collapse assistant"
          onClick={down}
          aria-disabled={i === 0}
          className={stepBtn}
        >
          <Icon name="chevron" className="size-5 rotate-90" />
        </button>
        {/* biome-ignore lint/a11y/useSemanticElements: a draggable handle exposed as a slider */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Assistant height"
          aria-valuemin={0}
          aria-valuemax={2}
          aria-valuenow={i}
          aria-valuetext={sheet}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              e.preventDefault();
              up();
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              down();
            }
            if (e.key === "Home" || e.key === "Escape") {
              e.preventDefault();
              setSheet("peek");
            }
            if (e.key === "End") {
              e.preventDefault();
              setSheet("full");
            }
          }}
          onPointerDown={(e) => {
            drag.current = { y: e.clientY, i };
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            drag.current = null;
            if (!d) return;
            const dy = d.y - e.clientY;
            if (dy > 40) setSheet(ORDER[Math.min(2, d.i + 1)] as Sheet);
            else if (dy < -40) setSheet(ORDER[Math.max(0, d.i - 1)] as Sheet);
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          className="grid h-11 w-16 cursor-grab touch-none place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="block h-1.5 w-full rounded-full bg-fg/30" />
        </div>
        <button
          type="button"
          aria-label="Expand assistant"
          onClick={up}
          aria-disabled={i === 2}
          className={stepBtn}
        >
          <Icon name="chevron" className="size-5 -rotate-90" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      {sheet === "full" && attribution && (
        <p className="shrink-0 px-4 pb-1.5 pt-1 text-[0.68rem] text-fg-soft">{attribution}</p>
      )}
    </div>
  );
}
