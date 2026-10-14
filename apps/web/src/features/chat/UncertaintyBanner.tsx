import type { Uncertainty } from "./chatReducer";

export function UncertaintyBanner({ u }: { u: Uncertainty }) {
  if (u.level === "none") return null;
  const items = (u.items ?? []).map((i) => Object.values(i).join(": ")).filter(Boolean);
  return (
    <div role="note" className="rounded-md border border-[#B7791F] bg-warn-tint px-3 py-2 text-sm">
      <span aria-hidden="true">◐ </span>
      <strong>Not checked yet</strong>
      {items.length > 0 ? `: ${items.join("; ")}` : "."}
    </div>
  );
}
