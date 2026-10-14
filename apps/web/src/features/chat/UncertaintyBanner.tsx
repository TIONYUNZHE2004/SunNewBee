import type { Uncertainty } from "./chatReducer";
import { describeUncertainty } from "./uncertainty";

export function UncertaintyBanner({ u }: { u: Uncertainty }) {
  if (u.level === "none") return null;
  const items = describeUncertainty(u.items);
  return (
    <div role="note" className="rounded-md border border-[#B7791F] bg-warn-tint px-3 py-2 text-sm">
      <span aria-hidden="true">◐ </span>
      <strong>Not checked yet</strong>
      {items.length > 0 ? `: ${items.join("; ")}` : "."}
    </div>
  );
}
