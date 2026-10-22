import type { CompareScreen } from "../compareStore";

type Viewports = NonNullable<CompareScreen["viewports"]>;

/**
 * The split screen's HTML part (spec §5.3, AC-N2): the divider and one pill at the top of each
 * half. Halves come from the renderer's `viewports`; without them, the two halves of the visible
 * map (left of the chat panel).
 */
export function ComparePills({
  left,
  right,
  viewports,
  top = 64,
}: {
  left: string;
  right: string;
  viewports: Viewports | null;
  /** The pills' top edge, CSS px of the stage: below the map's top stack (V2 fix N-a). */
  top?: number;
}) {
  const half = "calc((100% - var(--panel-w,0px)) / 2)";
  const l = viewports
    ? { left: viewports.left.x, width: viewports.left.w }
    : { left: 0, width: half };
  const r = viewports
    ? { left: viewports.right.x, width: viewports.right.w }
    : { left: half, width: half };
  const pill =
    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-surface px-3 py-1.5 text-[13px] font-extrabold text-fg shadow-[0_3px_0_var(--c-edge)]";
  return (
    <div data-beat="split" className="pointer-events-none absolute inset-0">
      <div
        data-beat="split-divider"
        aria-hidden="true"
        className="absolute bottom-0 top-0 -ml-px w-[3px] bg-surface shadow-[0_0_0_1px_var(--c-edge)]"
        style={{ left: r.left }}
      />
      <div className="absolute flex justify-center" style={{ ...l, top }}>
        <span data-beat="split-pill-fastest" className={pill}>
          <span aria-hidden="true" className="size-2.5 rounded-full bg-cmp-fastest" />
          {left}
        </span>
      </div>
      <div className="absolute flex justify-center" style={{ ...r, top }}>
        <span data-beat="split-pill-recommended" className={pill}>
          <span aria-hidden="true" className="size-2.5 rounded-full bg-cmp-recommended" />
          {right}
        </span>
      </div>
    </div>
  );
}
