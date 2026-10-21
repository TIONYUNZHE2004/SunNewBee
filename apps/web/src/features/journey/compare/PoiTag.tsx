import type { ScreenPoint } from "../compareStore";
import type { TagCopy } from "./copy";

/** Key colours (index.css `--c-cmp-*`, the same hues as the 3D ribbons). */
export const TONE: Record<TagCopy["tone"], string> = {
  ok: "var(--c-cmp-recommended)",
  info: "var(--c-cmp-info)",
  unknown: "var(--c-cmp-unknown)",
  fail: "var(--c-cmp-fail)",
  route: "var(--c-cmp-fastest)",
};

const TINT: Partial<Record<TagCopy["tone"], string>> = {
  fail: "bg-cmp-fail-tint text-fg",
  unknown: "bg-cmp-unknown-tint text-fg",
};

/**
 * An anchored tag (prototype `.tag`): a coloured key, the fact, and a note line ("Demo value · not
 * surveyed" for placeholder evidence). With `at` it points at that screen point of the map slot;
 * without one (no renderer position yet, List-less fallback) it sits in its half's tag column.
 */
export function PoiTag({
  beat,
  copy,
  at,
}: {
  beat: string;
  copy: TagCopy;
  at: ScreenPoint | null;
}) {
  const placed = at
    ? "absolute -translate-x-1/2 -translate-y-[calc(100%+12px)] after:absolute after:-bottom-1.5 after:left-1/2 after:size-3 after:-translate-x-1/2 after:rotate-45 after:bg-inherit after:content-['']"
    : "relative";
  return (
    <div
      data-beat={beat}
      className={`${placed} whitespace-nowrap rounded-xl px-2.5 py-1.5 text-[12.5px] font-bold shadow-[0_3px_0_var(--c-edge),0_8px_20px_rgba(0,0,0,.15)] ${TINT[copy.tone] ?? "bg-surface text-fg"}`}
      style={at ? { left: at.x, top: at.y } : undefined}
    >
      <span
        className="mr-1.5 inline-block rounded-full px-1.5 py-px align-[1px] text-[10px] uppercase tracking-[.06em] text-cmp-on-tone"
        style={{ background: TONE[copy.tone] }}
      >
        {copy.key}
      </span>
      {copy.tone === "unknown" ? " · " : ""}
      {copy.text}
      {copy.note && (
        <span className="mt-0.5 block text-[10.5px] font-semibold text-cmp-demo-note">
          {copy.tone === "unknown" ? " · " : ""}
          {copy.note}
        </span>
      )}
    </div>
  );
}
