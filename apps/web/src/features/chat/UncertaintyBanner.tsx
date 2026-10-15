import type { Uncertainty } from "./chatReducer";
import { bannerParts } from "./uncertainty";

export function UncertaintyBanner({ u }: { u: Uncertainty }) {
  if (u.level === "none") return null;
  const { heading, unchecked, notes } = bannerParts(u.items);
  const lead = unchecked.length > 0 ? unchecked : notes;
  const also = unchecked.length > 0 ? notes : [];
  return (
    <div role="note" className="rounded-md border border-[#B7791F] bg-warn-tint px-3 py-2 text-sm">
      <span aria-hidden="true">◐ </span>
      <strong>{heading}</strong>: {lead.join("; ")}
      {also.length > 0 && (
        <>
          . <strong>Also note</strong>: {also.join("; ")}
        </>
      )}
    </div>
  );
}
