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

/** Gap between a tag's box and the point it hangs above (the arrow), CSS px. */
const TAG_OFFSET = 12;
/** Gap kept between two stacked tags, CSS px. */
const TAG_STACK_GAP = 6;

/**
 * Pure: an anchored tag's box before it is measured (12.5 px bold text, a 10 px uppercase key,
 * an optional 10.5 px note line), on the generous side so a stack never touches.
 */
export function tagSizeEstimate(copy: TagCopy): { w: number; h: number } {
  const key = 12 + 6 + copy.key.length * 7.2;
  const text = (copy.tone === "unknown" ? 3 : 0) + copy.text.length * 7.6;
  const note = copy.note ? copy.note.length * 6.6 + (copy.tone === "unknown" ? 3 : 0) : 0;
  const w = 20 + Math.max(key + text, note);
  return { w: Math.ceil(w * 1.05), h: copy.note ? 46 : 30 };
}

/**
 * Pure: how far (px) each anchored tag is lifted above its point so no two overlap (R28:
 * the clamped kerb tag and the covered-walkway tag at 4.5–7 s). Tags keep their order: the first
 * stays on its point, a later one that would cover an earlier one stacks above it (below it when
 * there is no room above `minTop`, a negative lift). Overlay layout only; a lifted tag keeps a
 * leader to its point.
 */
export function stackTags(
  tags: readonly { id: string; at: ScreenPoint; size: { w: number; h: number } }[],
  minTop = 0,
): Record<string, number> {
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const out: Record<string, number> = {};
  const hits = (b: { x: number; y: number; w: number; h: number }) =>
    placed.filter(
      (o) =>
        b.x < o.x + o.w + TAG_STACK_GAP &&
        o.x < b.x + b.w + TAG_STACK_GAP &&
        b.y < o.y + o.h + TAG_STACK_GAP &&
        o.y < b.y + b.h + TAG_STACK_GAP,
    );
  for (const t of tags) {
    const base = { x: t.at.x - t.size.w / 2, y: t.at.y - TAG_OFFSET - t.size.h, ...t.size };
    const box = { ...base };
    for (let i = 0; i <= placed.length; i++) {
      const hit = hits(box);
      if (!hit.length) break;
      box.y = Math.min(...hit.map((o) => o.y)) - TAG_STACK_GAP - box.h;
    }
    if (box.y < minTop) {
      // no room above: under the lowest tag it would cover (its leader still reaches the point)
      box.y = base.y;
      for (let i = 0; i <= placed.length; i++) {
        const hit = hits(box);
        if (!hit.length) break;
        box.y = Math.max(...hit.map((o) => o.y + o.h)) + TAG_STACK_GAP;
      }
    }
    placed.push(box);
    out[t.id] = base.y - box.y;
  }
  return out;
}

/**
 * An anchored tag (prototype `.tag`): a coloured key, the fact, and a note line ("Demo value · not
 * surveyed" for placeholder evidence). With `at` it points at that screen point of the map slot;
 * without one (no renderer position yet, List-less fallback) it sits in its half's tag column.
 */
export function PoiTag({
  beat,
  copy,
  at,
  lift = 0,
}: {
  beat: string;
  copy: TagCopy;
  at: ScreenPoint | null;
  /** Px the tag is raised above `at` to clear another tag (`stackTags`; negative: lowered). */
  lift?: number;
}) {
  const placed = at
    ? "absolute -translate-x-1/2 -translate-y-[calc(100%+12px)] after:absolute after:-bottom-1.5 after:left-1/2 after:size-3 after:-translate-x-1/2 after:rotate-45 after:bg-inherit after:content-['']"
    : "relative";
  return (
    <div
      data-beat={beat}
      className={`${placed} whitespace-nowrap rounded-xl px-2.5 py-1.5 text-[12.5px] font-bold shadow-[0_3px_0_var(--c-edge),0_8px_20px_rgba(0,0,0,.15)] ${TINT[copy.tone] ?? "bg-surface text-fg"}`}
      style={at ? { left: at.x, top: at.y - lift } : undefined}
      data-lift={at && lift !== 0 ? Math.round(lift) : undefined}
    >
      {at && lift > 0 && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-full left-1/2 w-0.5 -translate-x-1/2 bg-edge"
          style={{ height: lift + TAG_OFFSET }}
        />
      )}
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
